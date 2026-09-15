import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

from services.vision_service import (
    camera_calibration_store,
    decode_image_data,
    encode_image_to_base64,
    order_corners,
    warp_perspective_region,
)

logger = logging.getLogger(__name__)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GPT4O_MODEL = "gpt-4o-mini"
_openai_client: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in backend/.env")
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


def standardize_label(label: str) -> str:
    """Ensure detected labels are always converted to professional, standardized English names."""
    if not label:
        return "Target Element"
    lbl = label.strip()
    lbl_lower = lbl.lower()

    # Normalize digits 0-9: e.g. "nút 1", "phím 1", "key 1", "button 1", "1"
    m = re.search(r'(?:nut|nút|phim|phím|key|button|số|so)?\s*([0-9])\b', lbl_lower)
    if m and not any(k in lbl_lower for k in ["nhap", "nhập", "amount", "tien", "tiền", "input"]):
        return f"Key {m.group(1)}"

    if any(k in lbl_lower for k in ["thanh toan", "thanh toán", "pay", "payment"]):
        return "Pay Button"
    if any(k in lbl_lower for k in ["huy", "hủy", "cancel"]):
        return "Cancel Button"
    if any(k in lbl_lower for k in ["enter", "ok", "xac nhan", "xác nhận"]):
        return "Enter / OK Key"
    if any(k in lbl_lower for k in ["so tien", "số tiền", "amount", "nhap", "nhập", "input"]):
        return "Amount Input Field"
    if any(k in lbl_lower for k in ["dang nhap", "đăng nhập", "login"]):
        return "Login Button"
    if any(k in lbl_lower for k in ["mat khau", "mật khẩu", "password"]):
        return "Password Field"
    if any(k in lbl_lower for k in ["email", "sdt", "sđt", "phone"]):
        return "Email / Phone Field"

    return lbl


class AIDetectorService:
    """Service for detecting objects, buttons, markings, or targets inside a calibrated ROI."""

    def _find_device_screen_region(self, image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        """
        Locates the illuminated display screen of a smartphone, POS terminal, or tablet
        placed inside the workspace. Returns (x, y, w, h) in image pixels.
        """
        if image is None:
            return None
        h, w = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Test adaptive binary thresholds for the bright illuminated display
        for thresh_val in [150, 140, 165, 130, 175]:
            _, thresh = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
            # Mask out outermost borders (15px)
            thresh[0:15, :] = 0
            thresh[-15:, :] = 0
            thresh[:, 0:15] = 0
            thresh[:, -15:] = 0

            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            candidates = []
            for c in contours:
                area = cv2.contourArea(c)
                # Device screen typically occupies between 3% and 70% of the workspace
                if (w * h * 0.03) < area < (w * h * 0.70):
                    bx, by, bw, bh = cv2.boundingRect(c)
                    aspect = float(bh) / max(1, bw)
                    # Screens are rectangular (portrait 1.15-2.6 or landscape 0.45-0.85)
                    if 1.15 <= aspect <= 2.6 or 0.45 <= aspect <= 0.85:
                        candidates.append((area, (bx, by, bw, bh)))
            if candidates:
                candidates.sort(key=lambda item: item[0], reverse=True)
                return candidates[0][1]
        return None

    def detect_in_region(
        self,
        frame: np.ndarray,
        work_area: Optional[List[List[float]]] = None,
        prompt: str = "all buttons, keys, or targets",
        model_type: str = "gpt4o",
        cnc_origin: Tuple[float, float] = (0.0, 0.0),
        cnc_span: Tuple[float, float] = (300.0, 300.0),
        camera_offset: Tuple[float, float] = (0.0, 0.0),
        invert_x: bool = False,
        invert_y: bool = True,
        swap_xy: bool = False,
        key1_ref: Optional[Tuple[float, float]] = None,
        key_spacing: Optional[Tuple[float, float]] = None,
    ) -> Dict[str, Any]:
        if frame is None:
            return {"success": False, "message": "No frame provided", "objects": []}

        h, w = frame.shape[:2]
        pts = work_area if work_area and len(work_area) == 4 else camera_calibration_store.points

        # If work area defined, warp to top-down view for superior AI recognition
        if pts and len(pts) == 4:
            ordered_pts = order_corners(pts)
            warped_w, warped_h = 800, 800
            warped, M = warp_perspective_region(frame, ordered_pts, (warped_w, warped_h))
            inv_M = np.linalg.inv(M)
            active_image = warped
            is_warped = True
        else:
            ordered_pts = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
            warped_w, warped_h = w, h
            active_image = frame
            inv_M = None
            is_warped = False

        # 1. Check if an electronic device screen (POS/phone/tablet) is resting inside the workspace
        screen_roi = self._find_device_screen_region(active_image)
        screen_crop = None
        if screen_roi is not None:
            sx, sy, sw, sh = screen_roi
            screen_crop = active_image[sy:sy + sh, sx:sx + sw]
            logger.info("Auto-detected device screen at x=%d, y=%d, w=%d, h=%d in workspace", sx, sy, sw, sh)

        # Run selected detection model
        try:
            if screen_crop is not None:
                if model_type.lower() == "opencv":
                    screen_objects = self._detect_opencv_shapes(screen_crop, prompt)
                else:
                    screen_objects = self._detect_openai_vision(screen_crop, prompt, is_cropped_screen=True)

                raw_objects = []
                for obj in screen_objects:
                    raw_objects.append({
                        **obj,
                        "center_x": float(sx + obj["center_x"]),
                        "center_y": float(sy + obj["center_y"]),
                        "width": float(obj.get("width", 30)),
                        "height": float(obj.get("height", 30)),
                    })
            else:
                if model_type.lower() == "opencv":
                    raw_objects = self._detect_opencv_shapes(active_image, prompt)
                else:
                    raw_objects = self._detect_openai_vision(active_image, prompt, is_cropped_screen=False)
        except Exception as exc:
            logger.exception("Detection failed: %s", exc)
            return {"success": False, "message": str(exc), "objects": []}

        x1, y1 = cnc_origin
        span_x, span_y = cnc_span
        off_x, off_y = camera_offset

        # Keypad grid map for direct physical step anchoring from Key 1
        keypad_grid = {
            "1": (0, 0), "key 1": (0, 0), "button 1": (0, 0), "nút 1": (0, 0), "phím 1": (0, 0),
            "2": (1, 0), "key 2": (1, 0), "button 2": (1, 0), "nút 2": (1, 0), "phím 2": (1, 0),
            "3": (2, 0), "key 3": (2, 0), "button 3": (2, 0), "nút 3": (2, 0), "phím 3": (2, 0),
            "4": (0, 1), "key 4": (0, 1), "button 4": (0, 1), "nút 4": (0, 1), "phím 4": (0, 1),
            "5": (1, 1), "key 5": (1, 1), "button 5": (1, 1), "nút 5": (1, 1), "phím 5": (1, 1),
            "6": (2, 1), "key 6": (2, 1), "button 6": (2, 1), "nút 6": (2, 1), "phím 6": (2, 1),
            "7": (0, 2), "key 7": (0, 2), "button 7": (0, 2), "nút 7": (0, 2), "phím 7": (0, 2),
            "8": (1, 2), "key 8": (1, 2), "button 8": (1, 2), "nút 8": (1, 2), "phím 8": (1, 2),
            "9": (2, 2), "key 9": (2, 2), "button 9": (2, 2), "nút 9": (2, 2), "phím 9": (2, 2),
            "0": (1, 3), "key 0": (1, 3), "button 0": (1, 3), "nút 0": (1, 3), "phím 0": (1, 3),
            "cancel": (0, 3), "cancel button": (0, 3), "hủy": (0, 3), "nút hủy": (0, 3),
            "pay": (2, 3), "pay button": (2, 3), "enter": (2, 3), "ok": (2, 3), "enter / ok key": (2, 3), "thanh toán": (2, 3), "nút thanh toán": (2, 3),
        }

        # Locate reference keys in raw_objects if available
        key1_item = next((it for it in raw_objects if it.get("label", "").strip().lower() in ("key 1", "button 1", "nút 1", "phím 1", "1")), None)
        key2_item = next((it for it in raw_objects if it.get("label", "").strip().lower() in ("key 2", "button 2", "nút 2", "phím 2", "2")), None)
        key5_item = next((it for it in raw_objects if it.get("label", "").strip().lower() in ("key 5", "button 5", "nút 5", "phím 5", "5")), None)

        px_per_step_x = None
        px_per_step_y = None
        if key1_item and key2_item and key_spacing:
            dx_px = abs(float(key2_item["center_x"]) - float(key1_item["center_x"]))
            if dx_px > 5:
                px_per_step_x = abs(key_spacing[0]) / dx_px
        if key2_item and key5_item and key_spacing:
            dy_px = abs(float(key5_item["center_y"]) - float(key2_item["center_y"]))
            if dy_px > 5:
                px_per_step_y = key_spacing[1] / dy_px
        if px_per_step_x is None and key_spacing:
            px_per_step_x = abs(key_spacing[0]) / 21.3
        if px_per_step_y is None and key_spacing:
            px_per_step_y = key_spacing[1] / 29.2

        processed_objects = []
        for idx, item in enumerate(raw_objects):
            rx = float(item["center_x"])
            ry = float(item["center_y"])
            norm_x = max(0.0, min(1.0, rx / warped_w))
            norm_y = max(0.0, min(1.0, ry / warped_h))

            # Calculate original camera image pixel coordinates
            if is_warped and inv_M is not None:
                pt_warped = np.array([[[rx, ry]]], dtype=np.float32)
                orig_pt = cv2.perspectiveTransform(pt_warped, inv_M)
                orig_x = float(orig_pt[0, 0, 0])
                orig_y = float(orig_pt[0, 0, 1])

                # Convert bounding box to original frame polygon
                bw = float(item.get("width", 40))
                bh = float(item.get("height", 40))
                box_pts = np.array([
                    [[rx - bw / 2, ry - bh / 2]],
                    [[rx + bw / 2, ry - bh / 2]],
                    [[rx + bw / 2, ry + bh / 2]],
                    [[rx - bw / 2, ry + bh / 2]],
                ], dtype=np.float32)
                orig_box_pts = cv2.perspectiveTransform(box_pts, inv_M)
                box_polygon = [[float(p[0, 0]), float(p[0, 1])] for p in orig_box_pts]
            else:
                orig_x = rx
                orig_y = ry
                bw = float(item.get("width", 40))
                bh = float(item.get("height", 40))
                box_polygon = [
                    [orig_x - bw / 2, orig_y - bh / 2],
                    [orig_x + bw / 2, orig_y - bh / 2],
                    [orig_x + bw / 2, orig_y + bh / 2],
                    [orig_x - bw / 2, orig_y + bh / 2],
                ]

            # Physical coordinates calculation (prioritize physical keypad anchoring)
            clean_lbl = item.get("label", "").strip().lower()
            if screen_roi is not None:
                # Screen was automatically localized inside the calibrated workspace
                eff_norm_x = (1.0 - norm_x) if invert_x else norm_x
                eff_norm_y = (1.0 - norm_y) if invert_y else norm_y
                if swap_xy:
                    eff_norm_x, eff_norm_y = eff_norm_y, eff_norm_x
                cnc_x = x1 + eff_norm_x * span_x + off_x
                cnc_y = y1 + eff_norm_y * span_y + off_y
            elif key1_ref and key_spacing and clean_lbl in keypad_grid:
                col, row = keypad_grid[clean_lbl]
                k1_x, k1_y = key1_ref
                sp_x, sp_y = key_spacing
                cnc_x = k1_x + col * sp_x
                cnc_y = k1_y + row * sp_y
            elif key1_ref and key_spacing and key1_item:
                k1_x, k1_y = key1_ref
                dx_from_k1 = float(item["center_x"]) - float(key1_item["center_x"])
                dy_from_k1 = float(item["center_y"]) - float(key1_item["center_y"])
                cnc_x = k1_x + dx_from_k1 * (px_per_step_x or 4.69)
                cnc_y = k1_y + dy_from_k1 * (px_per_step_y or -3.42)
            else:
                # Calculate CNC physical coordinates with axis inversion / swapping
                eff_norm_x = (1.0 - norm_x) if invert_x else norm_x
                eff_norm_y = (1.0 - norm_y) if invert_y else norm_y

                if swap_xy:
                    eff_norm_x, eff_norm_y = eff_norm_y, eff_norm_x

                cnc_x = x1 + eff_norm_x * span_x + off_x
                cnc_y = y1 + eff_norm_y * span_y + off_y

            processed_objects.append({
                "id": idx + 1,
                "label": standardize_label(item.get("label", f"Target {idx + 1}")),
                "confidence": round(float(item.get("confidence", 0.9)), 2),
                "pixel_x": round(orig_x, 1),
                "pixel_y": round(orig_y, 1),
                "rectified_x": round(rx, 1),
                "rectified_y": round(ry, 1),
                "cnc_x": round(cnc_x, 2),
                "cnc_y": round(cnc_y, 2),
                "width": round(bw, 1),
                "height": round(bh, 1),
                "box_polygon": box_polygon,
            })

        warped_base64 = encode_image_to_base64(active_image) if is_warped else None

        return {
            "success": True,
            "count": len(processed_objects),
            "objects": processed_objects,
            "warped_preview": warped_base64,
            "work_area": [[float(p[0]), float(p[1])] for p in ordered_pts],
            "cnc_bounds": {"x1": x1, "y1": y1, "span_x": span_x, "span_y": span_y},
        }

    def _detect_openai_vision(self, image: np.ndarray, prompt: str, is_cropped_screen: bool = False) -> List[Dict[str, Any]]:
        client = get_openai_client()
        h, w = image.shape[:2]
        base64_img = encode_image_to_base64(image)
        raw_b64 = base64_img.split(",", 1)[1] if "," in base64_img else base64_img

        if is_cropped_screen:
            system_instruction = (
                "You are an industrial precision computer vision and UI touch localization assistant for a robotic CNC stylus tester.\n"
                "The image provided is a tightly CROPPED TOUCHSCREEN display of an electronic device (such as a POS payment terminal or smartphone).\n"
                "The entire image corresponds strictly to the active touchscreen display area.\n\n"
                "UI ELEMENTS TO LOCATE:\n"
                "1. If an amount input field or display header is visible (e.g. '$0.00', 'Purchase', header text), detect it.\n"
                "2. Detect numeric keys: 1, 2, 3, 4, 5, 6, 7, 8, 9, 0 strictly inside the keypad grid.\n"
                "3. Detect action buttons (e.g. Cancel Button, Pay Button, Enter / OK Key, Back).\n"
                f"User target prompt: '{prompt}'.\n\n"
                "Return JSON ONLY with this exact schema:\n"
                "{\n"
                '  "targets": [\n'
                '    {\n'
                '      "label": "Professional English name (e.g. Amount Input Field, Key 1, Key 2, Key 3, Key 4, Key 5, Key 6, Key 7, Key 8, Key 9, Key 0, Cancel Button, Pay Button, Enter / OK Key)",\n'
                '      "confidence": 0.98,\n'
                '      "center_x_norm": 0.50,\n'
                '      "center_y_norm": 0.55,\n'
                '      "width_norm": 0.25,\n'
                '      "height_norm": 0.12\n'
                '    }\n'
                '  ]\n'
                "}\n"
                "Note: center_x_norm and center_y_norm MUST be normalized between 0.0 and 1.0 within this screen image. Do NOT include explanation text."
            )
            user_text = (
                f"Identify and locate all requested UI targets inside this touchscreen display. Prompt: '{prompt}'.\n"
                "Make sure to detect every numeric key (1, 2, 3, 4, 5, 6, 7, 8, 9, 0), "
                "Cancel button, Pay/Confirm button, and amount display field on the screen."
            )
        else:
            system_instruction = (
                "You are an industrial precision computer vision and UI automation alignment assistant for a robotic CNC stylus tester.\n"
                "The image provided is a top-down workspace view. Resting on the table is an electronic device (such as a POS payment terminal, smartphone, or tablet).\n\n"
                "CRITICAL SPATIAL CONSTRAINTS:\n"
                "1. First detect the bounding box of the electronic device's illuminated display screen:\n"
                "   screen_bbox: [xmin, ymin, xmax, ymax] normalized [0.0 to 1.0]. "
                "If the image already tightly frames the screen, screen_bbox is [0.0, 0.0, 1.0, 1.0].\n"
                "2. ALL touchable UI elements (buttons, keys 1-9, 0, Cancel, OK, Enter, amount field, input boxes) "
                "reside STRICTLY INSIDE THE SCREEN of the device. "
                "Do NOT place targets on the wooden table, scissors, paper roll, or surrounding table edges!\n"
                "3. For keypad / POS screens:\n"
                "   - Detect the amount display / header at top of the app.\n"
                "   - Detect numeric keys 1, 2, 3, 4, 5, 6, 7, 8, 9, 0 strictly inside the keypad grid on screen.\n"
                "   - Detect action buttons (e.g. 'Cancel Button', 'Pay Button', 'Enter / OK Key').\n"
                f"User target prompt: '{prompt}'.\n\n"
                "Return JSON ONLY with this exact schema:\n"
                "{\n"
                '  "screen_bbox": [xmin, ymin, xmax, ymax],\n'
                '  "targets": [\n'
                '    {\n'
                '      "label": "Professional English name (e.g. Amount Input Field, Key 1, Key 2, Key 3, Key 4, Cancel Button, Pay Button, Enter / OK Key)",\n'
                '      "confidence": 0.98,\n'
                '      "center_x_norm": 0.50,\n'
                '      "center_y_norm": 0.55,\n'
                '      "width_norm": 0.08,\n'
                '      "height_norm": 0.05\n'
                '    }\n'
                '  ]\n'
                "}\n"
                "Note: center_x_norm and center_y_norm MUST be normalized between 0.0 and 1.0. "
                "Every target MUST lie strictly inside screen_bbox! Do NOT include explanation text."
            )
            user_text = (
                f"Identify and locate all requested UI targets inside the device screen. Target prompt: '{prompt}'.\n"
                "Make sure to detect every numeric key (1, 2, 3, 4, 5, 6, 7, 8, 9, 0), "
                "Cancel button, Pay/Confirm button, and amount display field on the screen."
            )

        try:
            response = client.chat.completions.create(
                model=GPT4O_MODEL,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": user_text,
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{raw_b64}",
                                    "detail": "high",
                                },
                            },
                        ],
                    },
                ],
            )
            raw_text = (response.choices[0].message.content or "").strip()
            cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
            data = json.loads(cleaned)
            targets = data.get("targets", [])
            screen_bbox = data.get("screen_bbox")

            # Validate and clamp targets within screen_bbox if full workspace image
            min_x, min_y, max_x, max_y = 0.0, 0.0, 1.0, 1.0
            if not is_cropped_screen and screen_bbox and len(screen_bbox) == 4:
                try:
                    s_xmin, s_ymin, s_xmax, s_ymax = [float(v) for v in screen_bbox]
                    if 0.0 <= s_xmin < s_xmax <= 1.0 and 0.0 <= s_ymin < s_ymax <= 1.0:
                        min_x, min_y, max_x, max_y = s_xmin, s_ymin, s_xmax, s_ymax
                except Exception:
                    pass

            results = []
            for t in targets:
                cx_norm = float(t.get("center_x_norm", 0.5))
                cy_norm = float(t.get("center_y_norm", 0.5))
                w_norm = float(t.get("width_norm", 0.08))
                h_norm = float(t.get("height_norm", 0.08))

                # Clamp coordinates strictly inside boundaries
                cx_norm = max(min_x, min(max_x, cx_norm))
                cy_norm = max(min_y, min(max_y, cy_norm))

                results.append({
                    "label": str(t.get("label", "Target")),
                    "confidence": float(t.get("confidence", 0.9)),
                    "center_x": cx_norm * w,
                    "center_y": cy_norm * h,
                    "width": max(15.0, w_norm * w),
                    "height": max(15.0, h_norm * h),
                })
            return results
        except Exception as exc:
            logger.exception("OpenAI vision target detection failed: %s", exc)
            # If network error or API error, inform user clearly instead of returning whole-device box
            raise RuntimeError(f"Lỗi OpenAI Vision ({exc}). Vui lòng kiểm tra lại mạng hoặc thử lại!") from exc

        if not results:
            logger.warning("OpenAI vision found 0 targets with prompt '%s'", prompt)
            raise RuntimeError("OpenAI không tìm thấy phím nào trên màn hình. Hãy kiểm tra lại góc chụp camera hoặc thử lại!")

        return results

    def _detect_opencv_shapes(self, image: np.ndarray, prompt: str = "") -> List[Dict[str, Any]]:
        """
        Robust detector for foreground physical objects, devices, packages, and components
        placed on the work area table. Eliminates false detections on wood grain or textured backgrounds.
        """
        h, w = image.shape[:2]
        total_area = float(w * h)

        # 1. Background Estimation from borders
        margin_x, margin_y = max(6, int(w * 0.06)), max(6, int(h * 0.06))
        border_mask = np.ones((h, w), dtype=np.uint8) * 255
        border_mask[margin_y:h - margin_y, margin_x:w - margin_x] = 0

        # Convert to LAB color space for perceptual color difference
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        bg_mean = cv2.mean(lab, mask=border_mask)[:3]

        # Calculate color distance from background plate
        diff = np.linalg.norm(lab.astype(np.float32) - np.array(bg_mean, dtype=np.float32), axis=2).astype(np.uint8)
        diff_blur = cv2.GaussianBlur(diff, (7, 7), 0)
        _, thresh = cv2.threshold(diff_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Morphological opening removes small wood grain streaks, noise, wires
        kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel_open, iterations=2)

        # Morphological closing bridges internal textures/text within the object
        kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13))
        closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel_close, iterations=2)

        # Exclude outermost borders to avoid detecting edge shadows or boundary tape
        inner_mask = np.zeros((h, w), dtype=np.uint8)
        inner_mask[margin_y:h - margin_y, margin_x:w - margin_x] = 255
        cleaned_mask = cv2.bitwise_and(closed, inner_mask)

        contours, _ = cv2.findContours(cleaned_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Filter contours by size and aspect ratio
        min_area = total_area * 0.015  # At least 1.5% of work area
        max_area = total_area * 0.85   # At most 85% of work area

        detected_candidates = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if min_area < area < max_area:
                bx, by, bw, bh = cv2.boundingRect(cnt)
                aspect = max(bw, bh) / max(1, min(bw, bh))
                # Reject thin wires or long strips
                if aspect < 6.0:
                    detected_candidates.append({
                        "center_x": float(bx + bw / 2.0),
                        "center_y": float(by + bh / 2.0),
                        "width": float(bw),
                        "height": float(bh),
                        "area": float(area),
                    })

        # Sort by area descending so largest/most prominent objects are first
        detected_candidates = sorted(detected_candidates, key=lambda x: x["area"], reverse=True)[:8]

        # If user explicitly asks for UI inputs, buttons or login form
        prompt_lower = (prompt or "").lower()
        search_form = any(k in prompt_lower for k in ["input", "nhập", "form", "login", "button", "nút", "facebook", "fb", "text"])
        search_circles = any(k in prompt_lower for k in ["circle", "tròn"])

        results = []
        if search_form and len(detected_candidates) > 0:
            for cand in detected_candidates:
                bx = max(0, int(cand["center_x"] - cand["width"] / 2))
                by = max(0, int(cand["center_y"] - cand["height"] / 2))
                bw, bh = int(cand["width"]), int(cand["height"])
                roi = image[by:by + bh, bx:bx + bw]
                if roi.shape[0] > 40 and roi.shape[1] > 40:
                    gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                    edges = cv2.Canny(gray_roi, 35, 110)
                    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
                    edges_h = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_h)
                    sub_cnts, _ = cv2.findContours(edges_h, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    boxes = []
                    for sc in sub_cnts:
                        sbx, sby, sbw, sbh = cv2.boundingRect(sc)
                        if sbw > bw * 0.30 and sbw < bw * 0.98 and sbh >= 14 and sbh < bh * 0.35:
                            # Avoid duplicates
                            if not any(abs(sbx - b[0]) < 15 and abs(sby - b[1]) < 15 for b in boxes):
                                boxes.append((sbx, sby, sbw, sbh))
                    
                    boxes = sorted(boxes, key=lambda b: b[1])
                    for b_idx, (sbx, sby, sbw, sbh) in enumerate(boxes[:6]):
                        lbl = "Button" if b_idx >= len(boxes) - 1 else f"Input Field {b_idx + 1}"
                        results.append({
                            "label": f"{lbl} ({sbw}x{sbh}px)",
                            "confidence": 0.88,
                            "center_x": float(bx + sbx + sbw / 2),
                            "center_y": float(by + sby + sbh / 2),
                            "width": float(sbw),
                            "height": float(sbh),
                        })

        if search_circles and len(detected_candidates) > 0:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            for cand in detected_candidates:
                bx = max(0, int(cand["center_x"] - cand["width"] / 2))
                by = max(0, int(cand["center_y"] - cand["height"] / 2))
                bw, bh = int(cand["width"]), int(cand["height"])
                roi_gray = blurred[by:by + bh, bx:bx + bw]
                if roi_gray.shape[0] > 20 and roi_gray.shape[1] > 20:
                    circles = cv2.HoughCircles(
                        roi_gray,
                        cv2.HOUGH_GRADIENT,
                        dp=1.2,
                        minDist=25,
                        param1=60,
                        param2=45,
                        minRadius=8,
                        maxRadius=int(min(bw, bh) * 0.4),
                    )
                    if circles is not None:
                        circles = np.uint16(np.around(circles))
                        for c in circles[0, :][:6]:
                            results.append({
                                "label": f"Circular Button ({int(c[2]) * 2}px)",
                                "confidence": 0.90,
                                "center_x": float(bx + c[0]),
                                "center_y": float(by + c[1]),
                                "width": float(c[2] * 2),
                                "height": float(c[2] * 2),
                            })

        # If no internal buttons found or user placed object(s), return the detected foreground objects
        if not results:
            for idx, cand in enumerate(detected_candidates):
                results.append({
                    "label": f"Target {idx + 1} ({int(cand['width'])}x{int(cand['height'])}px)",
                    "confidence": 0.92,
                    "center_x": cand["center_x"],
                    "center_y": cand["center_y"],
                    "width": cand["width"],
                    "height": cand["height"],
                })

        return results

    def detect_workspace_corners(self, frame: np.ndarray) -> Optional[List[List[float]]]:
        """
        Detect the 4 corners of the working mat / test board on the table.
        Uses OpenAI Vision (GPT-4o-mini) to accurately locate the 4 corners of the working board.
        Falls back to color segmentation and geometric heuristics if offline.
        """
        if frame is None:
            return None
        h, w = frame.shape[:2]

        # 1. Try AI Vision (GPT-4o-mini)
        try:
            client = get_openai_client()
            base64_img = encode_image_to_base64(frame)
            raw_b64 = base64_img.split(",", 1)[1] if "," in base64_img else base64_img

            system_instruction = (
                "You are an industrial computer vision alignment system for a CNC robotic testing station. "
                "The camera captures a top-angled view of a table with a testing device (e.g. a POS payment terminal or smartphone). "
                "Notice there is a central rectangular working board / mat / pad placed on the table where the device rests "
                "(the rectangular wooden or grey board in the middle, between the side table edges). "
                "Find the 4 corner points of this central rectangular working board / mat: "
                "1. top_left, 2. top_right, 3. bottom_right, 4. bottom_left. "
                "Return JSON ONLY with this format:\n"
                "{\n"
                '  "corners": [\n'
                '    {"corner": "top_left", "x_norm": 0.32, "y_norm": 0.49},\n'
                '    {"corner": "top_right", "x_norm": 0.74, "y_norm": 0.49},\n'
                '    {"corner": "bottom_right", "x_norm": 0.77, "y_norm": 0.81},\n'
                '    {"corner": "bottom_left", "x_norm": 0.30, "y_norm": 0.81}\n'
                '  ]\n'
                "}\n"
                "Note: x_norm and y_norm must be floating point numbers between 0.0 and 1.0. "
                "Do NOT output markdown or explanation, only raw JSON."
            )

            response = client.chat.completions.create(
                model=GPT4O_MODEL,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Locate the 4 corners of the central rectangular working board/mat where the POS terminal rests."},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{raw_b64}",
                                    "detail": "high",
                                },
                            },
                        ],
                    },
                ],
            )
            raw_text = (response.choices[0].message.content or "").strip()
            cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
            data = json.loads(cleaned)
            corners_list = data.get("corners", [])
            if len(corners_list) == 4:
                pts = [[float(c["x_norm"] * w), float(c["y_norm"] * h)] for c in corners_list]
                ordered = order_corners(pts)
                return [[float(round(p[0], 1)), float(round(p[1], 1))] for p in ordered]
        except Exception as exc:
            logger.warning("AI 4-corner detection failed, falling back to CV/heuristics: %s", exc)

        # 2. Advanced Computer Vision (Color Segmentation between Board & Table)
        try:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            sat = hsv[:, :, 1]
            blur_sat = cv2.GaussianBlur(sat, (9, 9), 0)
            _, thresh = cv2.threshold(blur_sat, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

            # Focus on central ROI
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.rectangle(mask, (int(w * 0.15), int(h * 0.25)), (int(w * 0.85), int(h * 0.95)), 255, -1)
            thresh = cv2.bitwise_and(thresh, mask)

            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
            closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)

            contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            best_c = None
            best_area = 0
            for c in contours:
                area = cv2.contourArea(c)
                if (w * h * 0.08) < area < (w * h * 0.7):
                    if area > best_area:
                        best_area = area
                        best_c = c

            if best_c is not None:
                peri = cv2.arcLength(best_c, True)
                approx = cv2.approxPolyDP(best_c, 0.04 * peri, True)
                if len(approx) == 4:
                    ordered = order_corners(approx.reshape(4, 2))
                    return [[float(round(p[0], 1)), float(round(p[1], 1))] for p in ordered]
                rect = cv2.minAreaRect(best_c)
                box = cv2.boxPoints(rect)
                ordered = order_corners(box)
                return [[float(round(p[0], 1)), float(round(p[1], 1))] for p in ordered]
        except Exception as cv_exc:
            logger.warning("CV 4-corner segmentation fallback failed: %s", cv_exc)

        # 3. Geometric Calibrated Default for this Camera Rig
        return [
            [float(round(w * 0.318, 1)), float(round(h * 0.492, 1))],
            [float(round(w * 0.738, 1)), float(round(h * 0.492, 1))],
            [float(round(w * 0.768, 1)), float(round(h * 0.812, 1))],
            [float(round(w * 0.300, 1)), float(round(h * 0.812, 1))],
        ]


ai_detector_service = AIDetectorService()
