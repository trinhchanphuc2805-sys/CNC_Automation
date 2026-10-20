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

from services.vision_service import camera_calibration_store, encode_image_to_base64

logger = logging.getLogger(__name__)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

_openai_client = None


def get_openai_client(api_key: Optional[str] = None) -> OpenAI:
    if api_key and api_key.strip():
        return OpenAI(api_key=api_key.strip())

    # Reload from .env to ensure fresh keys without server restart
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)

    env_key = os.environ.get("OPENAI_API_KEY")
    if not env_key or not env_key.strip():
        raise RuntimeError("OPENAI_API_KEY chưa được cấu hình. Vui lòng nhập API Key trong giao diện hoặc cấu hình file backend/.env")
    return OpenAI(api_key=env_key.strip())


YOLO_MODEL_PATH = Path(__file__).resolve().parents[2] / "model" / "phone.pt"
_yolo_model = None


def get_yolo_model():
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
        except ImportError:
            raise RuntimeError("ultralytics is not installed. Vui lòng cài đặt: pip install ultralytics")
        if not YOLO_MODEL_PATH.exists():
            raise RuntimeError(f"Không tìm thấy model YOLO tại {YOLO_MODEL_PATH}")
        _yolo_model = YOLO(str(YOLO_MODEL_PATH))
    return _yolo_model


YOLO_ELEMENT_MODEL_PATH = Path(__file__).resolve().parents[2] / "model" / "best.pt"
_yolo_element_model = None
YOLO_PHONE_IMGSZ = 640    # kích thước ảnh đầu vào cho phone.pt
YOLO_ELEMENT_IMGSZ = 640  # tăng (vd 800/960) nếu cần bắt phím nhỏ hơn, đổi lại chậm hơn
DEVICE_CACHE_TTL = 2.0    # giây: dùng lại vị trí thiết bị, bỏ qua phone.pt giữa các lần quét liên tiếp
YOLO_USE_DEVICE_CROP = False  # False: best.pt chạy trên toàn khung hình (giống notebook). True: cắt theo phone.pt trước


def _infer_kwargs() -> Dict[str, Any]:
    """Dùng GPU + FP16 nếu có CUDA, ngược lại chạy CPU."""
    try:
        import torch
        if torch.cuda.is_available():
            return {"device": 0, "half": True}
    except Exception:
        pass
    return {"device": "cpu"}


def get_yolo_element_model():
    global _yolo_element_model
    if _yolo_element_model is None:
        try:
            from ultralytics import YOLO
        except ImportError:
            raise RuntimeError("ultralytics is not installed. Vui lòng cài đặt: pip install ultralytics")
        if not YOLO_ELEMENT_MODEL_PATH.exists():
            raise RuntimeError(f"Không tìm thấy model YOLO tại {YOLO_ELEMENT_MODEL_PATH}")
        _yolo_element_model = YOLO(str(YOLO_ELEMENT_MODEL_PATH))
    return _yolo_element_model


def warmup_models() -> Dict[str, Any]:
    """Preload YOLO models into memory and pre-warm OpenAI connection so first detect is instant."""
    res = {
        "yolo_element": False,
        "phone": False,
        "openai": False,
        "openai_model": None,
        "device": "cpu",
        "error": None,
    }
    try:
        elem_model = get_yolo_element_model()
        if elem_model is not None:
            dummy = np.zeros((320, 320, 3), dtype=np.uint8)
            elem_model.predict(dummy, verbose=False, **_infer_kwargs())
            res["yolo_element"] = True
            res["device"] = _infer_kwargs().get("device", "cpu")
            logger.info("YOLO element model (best.pt) warmed up successfully.")
    except Exception as e:
        logger.warning(f"Failed to warmup yolo element model: {e}")
        res["error"] = str(e)

    try:
        if YOLO_MODEL_PATH.exists():
            phone_model = get_yolo_model()
            if phone_model is not None:
                dummy = np.zeros((320, 320, 3), dtype=np.uint8)
                phone_model.predict(dummy, verbose=False, **_infer_kwargs())
                res["phone"] = True
                logger.info("YOLO phone model (phone.pt) warmed up successfully.")
    except Exception as e:
        logger.warning(f"Failed to warmup phone model: {e}")

    # Pre-warm OpenAI API HTTP session and model gpt-4o
    try:
        client = get_openai_client()
        if client is not None:
            try:
                # Fast model ping to warm TCP/TLS connection & verify key
                client.models.retrieve("gpt-4o")
                res["openai"] = True
                res["openai_model"] = "gpt-4o"
                logger.info("OpenAI API client (GPT-4o) warmed up & verified successfully.")
            except Exception as e_ping:
                logger.warning(f"OpenAI retrieve gpt-4o warning: {e_ping}")
                res["openai"] = True
                res["openai_model"] = "gpt-4o (unverified ping)"
    except Exception as e:
        logger.info(f"OpenAI warmup skipped (no key or offline): {e}")

    return res


def get_model_status() -> Dict[str, Any]:
    openai_ready = False
    try:
        openai_ready = bool(os.environ.get("OPENAI_API_KEY"))
    except Exception:
        pass

    return {
        "yolo_element_loaded": _yolo_element_model is not None,
        "yolo_element_path": str(YOLO_ELEMENT_MODEL_PATH),
        "yolo_element_exists": YOLO_ELEMENT_MODEL_PATH.exists(),
        "phone_loaded": _yolo_model is not None,
        "openai_ready": openai_ready,
        "hybrid_ready": (_yolo_element_model is not None and openai_ready),
        "device": _infer_kwargs().get("device", "cpu"),
        "classes": _yolo_element_model.names if _yolo_element_model is not None else {0: "button", 1: "icon_app"},
    }



class AIDetectorService:
    def warmup_models(self) -> Dict[str, Any]:
        return warmup_models()

    def get_model_status(self) -> Dict[str, Any]:
        return get_model_status()

    def detect_yolo_fast(
        self,
        frame: np.ndarray,
        work_area: Optional[List[List[float]]] = None,
        cnc_origin: Tuple[float, float] = (0.0, 0.0),
        cnc_span: Tuple[float, float] = (300.0, 300.0),
        camera_offset: Tuple[float, float] = (0.0, 0.0),
        scale: float = 1.0,
    ) -> List[Dict[str, Any]]:
        """Realtime YOLO running best.pt directly on full frame (identical to user's Python snippet)."""
        infer_kw = _infer_kwargs()
        elem_model = get_yolo_element_model()
        res_el = elem_model.predict(frame, conf=0.25, verbose=False, **infer_kw)[0]

        objects: List[Dict[str, Any]] = []
        for box in sorted(res_el.boxes, key=lambda b: -float(b.conf[0])):
            ex1, ey1, ex2, ey2 = box.xyxy[0].tolist()
            ex1, ex2, ey1, ey2 = ex1 * scale, ex2 * scale, ey1 * scale, ey2 * scale
            label = elem_model.names[int(box.cls[0])]
            cx, cy = (ex1 + ex2) / 2.0, (ey1 + ey2) / 2.0
            cnc_x, cnc_y = self._map_to_cnc(cx, cy, cnc_origin, cnc_span, work_area)
            objects.append({
                "id": len(objects) + 1,
                "label": label,
                "confidence": round(float(box.conf[0]), 2),
                "pixel_x": round(cx, 1),
                "pixel_y": round(cy, 1),
                "cnc_x": round(cnc_x + camera_offset[0], 1),
                "cnc_y": round(cnc_y + camera_offset[1], 1),
                "width": round(ex2 - ex1, 1),
                "height": round(ey2 - ey1, 1),
                "box_polygon": [
                    [round(ex1, 1), round(ey1, 1)], [round(ex2, 1), round(ey1, 1)],
                    [round(ex2, 1), round(ey2, 1)], [round(ex1, 1), round(ey2, 1)],
                ],
            })
        return objects

    def detect_in_region(
        self,
        frame: np.ndarray,
        work_area: Optional[List[List[float]]] = None,
        prompt: str = "",
        model_type: str = "gpt4o",
        cnc_origin: Tuple[float, float] = (0.0, 0.0),
        cnc_span: Tuple[float, float] = (300.0, 300.0),
        camera_offset: Tuple[float, float] = (0.0, 0.0),
        invert_x: bool = False,
        invert_y: bool = True,
        swap_xy: bool = False,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        if frame is None:
            return {"success": False, "message": "No frame provided", "image": None, "warped_preview": None, "objects": []}

        h, w = frame.shape[:2]
        processed_objects = []
        annotated_frame = frame.copy()
        warped_annotated = None

        try:
            m_type = (model_type or "hybrid").lower().strip()
            if m_type in ("hybrid", "yolo_gpt4o", "yolo+gpt4o", "yolo_gpt"):
                # --- HYBRID PIPELINE: YOLO (Toạ độ vật lý chuẩn 100%) + GPT-4o (Tên nhãn nút bấm) ---
                elem_model = get_yolo_element_model()
                infer_kw = _infer_kwargs()
                results_yolo = elem_model.predict(frame, conf=0.18, verbose=False, **infer_kw)

                yolo_raw_boxes = []
                for box in results_yolo[0].boxes:
                    ex1, ey1, ex2, ey2 = box.xyxy[0].tolist()
                    bw, bh = ex2 - ex1, ey2 - ey1
                    if bw < 10 or bh < 10:
                        continue
                    cx, cy = ex1 + bw / 2.0, ey1 + bh / 2.0
                    yolo_raw_boxes.append({
                        "x1": ex1, "y1": ey1, "x2": ex2, "y2": ey2,
                        "center_x": cx, "center_y": cy,
                        "width": bw, "height": bh,
                        "confidence": float(box.conf[0]),
                        "label": elem_model.names.get(int(box.cls[0]), "Button"),
                    })

                # 1b. Locate device bounds for spatial zone classification (Header vs Content vs Navigation Bar)
                try:
                    p_res = get_yolo_model()(frame, conf=0.25, verbose=False)[0]
                    if len(p_res.boxes) > 0:
                        pbx = p_res.boxes[0].xyxy[0].tolist()
                        px1, py1, px2, py2 = pbx
                        ph = max(50.0, py2 - py1)
                        pw = max(50.0, px2 - px1)
                    else:
                        px1, py1, px2, py2 = 0, 0, w, h
                        ph, pw = float(h), float(w)
                except Exception:
                    px1, py1, px2, py2 = 0, 0, w, h
                    ph, pw = float(h), float(w)

                for b in yolo_raw_boxes:
                    rel_y = (b["center_y"] - py1) / ph
                    b["is_header"] = (rel_y < 0.22)
                    b["is_nav_bar"] = (rel_y > 0.88 and b["height"] < 35)

                # 2. Run OpenAI GPT-4o to read semantic button names on screen
                has_work_area = work_area is not None and len(work_area) == 4
                inv_M = None
                warped_img = None
                is_cropped = False

                if has_work_area:
                    try:
                        from services.vision_service import warp_perspective_region, order_corners
                        ordered = order_corners(work_area)
                        side_w = max(float(np.linalg.norm(ordered[1] - ordered[0])), float(np.linalg.norm(ordered[2] - ordered[3])))
                        side_h = max(float(np.linalg.norm(ordered[3] - ordered[0])), float(np.linalg.norm(ordered[2] - ordered[1])))
                        long_side = max(side_w, side_h, 1.0)
                        s = 1024.0 / long_side
                        out_w, out_h = max(64, int(side_w * s)), max(64, int(side_h * s))
                        warped_img, M = warp_perspective_region(frame, ordered, (out_w, out_h))
                        inv_M = np.linalg.inv(M)
                        input_img = warped_img
                        is_cropped = True
                    except Exception as e:
                        logger.warning("Failed to warp work area in hybrid, fallback to frame: %s", e)
                        input_img = frame
                        is_cropped = False
                else:
                    input_img = frame
                    is_cropped = False

                gpt_targets = []
                try:
                    gpt_raw = self._detect_chatgpt_vision(
                        image=input_img,
                        prompt=prompt or "ALL buttons, keypad keys 0-9, Cancel, Pay, Purchase, and icons on device screen",
                        model_name="gpt4o",
                        api_key=api_key,
                        is_cropped_screen=is_cropped,
                    )
                    for gt in gpt_raw:
                        xw1, yw1 = gt["x1"], gt["y1"]
                        xw2, yw2 = gt["x2"], gt["y2"]
                        if is_cropped and inv_M is not None:
                            cx_w, cy_w = (xw1 + xw2) / 2.0, (yw1 + yw2) / 2.0
                            pt_w = np.array([[[cx_w, cy_w]]], dtype=np.float32)
                            pt_orig = cv2.perspectiveTransform(pt_w, inv_M)[0, 0]
                            box_w = np.array([[[xw1, yw1]], [[xw2, yw1]], [[xw2, yw2]], [[xw1, yw2]]], dtype=np.float32)
                            box_orig = cv2.perspectiveTransform(box_w, inv_M)[:, 0]
                            w_orig = float(np.linalg.norm(box_orig[1] - box_orig[0]))
                            h_orig = float(np.linalg.norm(box_orig[3] - box_orig[0]))
                            gpt_targets.append({
                                "label": gt["label"],
                                "confidence": gt.get("confidence", 0.95),
                                "center_x": float(pt_orig[0]),
                                "center_y": float(pt_orig[1]),
                                "width": max(10.0, w_orig),
                                "height": max(10.0, h_orig),
                            })
                        else:
                            gpt_targets.append({
                                "label": gt["label"],
                                "confidence": gt.get("confidence", 0.95),
                                "center_x": float(gt["center_x"]),
                                "center_y": float(gt["center_y"]),
                                "width": float(gt.get("width", xw2 - xw1)),
                                "height": float(gt.get("height", yw2 - yw1)),
                            })
                except Exception as gpt_err:
                    logger.warning("Hybrid GPT-4o pass warning: %s", gpt_err)

                # 3. Spatial Bipartite Matching: Map each YOLO physical box to the nearest GPT-4o semantic target
                # Uses size-aware distance: a large wide button (Pay/Cancel) will not accidentally bind to a tiny icon.
                matched_yolo = set()
                matched_gpt = set()
                pairs = []
                for yi, y_box in enumerate(yolo_raw_boxes):
                    ycx, ycy = y_box["center_x"], y_box["center_y"]
                    yw, yh = y_box["width"], y_box["height"]
                    for gi, g_target in enumerate(gpt_targets):
                        glbl = str(g_target.get("label", "")).lower()

                        # Rule 1: Numeric keys (0-9, Key 1-9) cannot match header elements
                        is_num_key = any(k in glbl for k in ["key", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "backspace"]) and not any(w in glbl for w in ["pay", "cancel", "refund", "purchase"])
                        if is_num_key and y_box.get("is_header"):
                            continue

                        # Rule 2: App buttons (Payments, Home, Pay, Cancel, Refund) cannot match bottom nav bar
                        is_app_btn = any(w in glbl for w in ["pay", "cancel", "refund", "purchase", "home", "continue", "confirm", "next", "icon_app"])
                        if is_app_btn and y_box.get("is_nav_bar"):
                            continue

                        raw_dist = float(np.hypot(ycx - g_target["center_x"], ycy - g_target["center_y"]))
                        gw = g_target.get("width", 0)
                        gh = g_target.get("height", 0)

                        # Size compatibility penalty: prevent a wide rectangular button from matching a tiny square icon
                        size_penalty = 1.0
                        if gw > 0 and yw > 0:
                            w_ratio = max(gw, yw) / max(1.0, min(gw, yw))
                            if w_ratio > 1.8:
                                size_penalty *= (w_ratio ** 1.6)

                        effective_dist = raw_dist * size_penalty
                        pairs.append((effective_dist, raw_dist, yi, gi))

                pairs.sort(key=lambda p: p[0])

                for eff_dist, raw_dist, yi, gi in pairs:
                    if yi in matched_yolo or gi in matched_gpt:
                        continue
                    y_box = yolo_raw_boxes[yi]
                    max_allowed = max(130.0, 2.0 * max(y_box["width"], y_box["height"]))
                    if raw_dist <= max_allowed:
                        matched_yolo.add(yi)
                        matched_gpt.add(gi)
                        y_box["label"] = gpt_targets[gi]["label"]
                        y_box["confidence"] = max(y_box["confidence"], gpt_targets[gi]["confidence"])

                # Assign intuitive fallback labels for unmatched system elements
                for yi, y_box in enumerate(yolo_raw_boxes):
                    if yi not in matched_yolo:
                        if y_box.get("is_header"):
                            y_box["label"] = "Back Button"
                        elif y_box.get("is_nav_bar"):
                            rel_x = (y_box["center_x"] - px1) / pw
                            if rel_x < 0.35:
                                y_box["label"] = "Nav Back"
                            elif rel_x < 0.65:
                                y_box["label"] = "Nav Home"
                            else:
                                y_box["label"] = "Nav Recents"

                # If YOLO detected boxes, sort them neatly top-down left-right
                if yolo_raw_boxes:
                    # Sort row by row (tolerance ~35px in Y)
                    yolo_raw_boxes.sort(key=lambda b: (round(b["center_y"] / 35.0), b["center_x"]))
                    candidate_elements = yolo_raw_boxes
                else:
                    # Fallback to GPT-4o targets if YOLO model detected nothing
                    candidate_elements = []
                    for gi, gt in enumerate(gpt_targets):
                        candidate_elements.append({
                            "x1": gt["center_x"] - 25, "y1": gt["center_y"] - 25,
                            "x2": gt["center_x"] + 25, "y2": gt["center_y"] + 25,
                            "center_x": gt["center_x"], "center_y": gt["center_y"],
                            "width": 50, "height": 50,
                            "confidence": gt["confidence"],
                            "label": gt["label"],
                        })

                # 4. Annotate image & calculate exact CNC coordinates
                for idx, elem in enumerate(candidate_elements, start=1):
                    ex1, ey1, ex2, ey2 = elem["x1"], elem["y1"], elem["x2"], elem["y2"]
                    cx, cy = elem["center_x"], elem["center_y"]
                    bw, bh = elem["width"], elem["height"]
                    lbl = elem["label"]
                    conf = elem["confidence"]

                    cnc_x, cnc_y = self._map_to_cnc(cx, cy, cnc_origin, cnc_span, work_area)
                    cnc_x += camera_offset[0]
                    cnc_y += camera_offset[1]

                    box_polygon = [
                        [round(ex1, 1), round(ey1, 1)],
                        [round(ex2, 1), round(ey1, 1)],
                        [round(ex2, 1), round(ey2, 1)],
                        [round(ex1, 1), round(ey2, 1)],
                    ]

                    # Draw stylish green bounding box & label badge on frame
                    cv2.rectangle(annotated_frame, (int(ex1), int(ey1)), (int(ex2), int(ey2)), (16, 185, 129), 2)
                    cv2.circle(annotated_frame, (int(cx), int(cy)), 4, (0, 255, 255), -1)
                    tag_text = f"#{idx} {lbl}"
                    (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                    tag_y = max(th + 6, int(ey1) - 4)
                    cv2.rectangle(annotated_frame, (int(ex1), tag_y - th - 5), (int(ex1) + tw + 6, tag_y + 3), (16, 185, 129), -1)
                    cv2.putText(annotated_frame, tag_text, (int(ex1) + 3, tag_y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

                    processed_objects.append({
                        "id": idx,
                        "label": lbl,
                        "confidence": round(conf, 2),
                        "pixel_x": round(cx, 1),
                        "pixel_y": round(cy, 1),
                        "cnc_x": round(cnc_x, 1),
                        "cnc_y": round(cnc_y, 1),
                        "width": round(bw, 1),
                        "height": round(bh, 1),
                        "box_polygon": box_polygon,
                    })

                warped_annotated = warped_img.copy() if warped_img is not None else None
            elif m_type == "yolo":
                # --- Chạy best.pt trực tiếp trên ảnh gốc (Full Frame, y hệt snippet) ---
                elem_model = get_yolo_element_model()
                infer_kw = _infer_kwargs()
                results_yolo = elem_model.predict(frame, conf=0.25, verbose=False, **infer_kw)
                annotated_frame = results_yolo[0].plot()

                for idx, box in enumerate(results_yolo[0].boxes, start=1):
                    ex1, ey1, ex2, ey2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    label = elem_model.names[int(box.cls[0])]

                    width = ex2 - ex1
                    height = ey2 - ey1
                    center_x = ex1 + width / 2.0
                    center_y = ey1 + height / 2.0

                    cnc_x, cnc_y = self._map_to_cnc(center_x, center_y, cnc_origin, cnc_span, work_area)
                    cnc_x += camera_offset[0]
                    cnc_y += camera_offset[1]

                    processed_objects.append({
                        "id": idx,
                        "label": label,
                        "confidence": round(conf, 2),
                        "pixel_x": round(center_x, 1),
                        "pixel_y": round(center_y, 1),
                        "cnc_x": round(cnc_x, 1),
                        "cnc_y": round(cnc_y, 1),
                        "width": round(width, 1),
                        "height": round(height, 1),
                        "box_polygon": [
                            [round(ex1, 1), round(ey1, 1)],
                            [round(ex2, 1), round(ey1, 1)],
                            [round(ex2, 1), round(ey2, 1)],
                            [round(ex1, 1), round(ey2, 1)],
                        ],
                    })
            elif m_type == "opencv":
                raw_targets = self._detect_opencv_shapes(frame)
                for idx, t in enumerate(raw_targets):
                    x1, y1 = t["x1"], t["y1"]
                    x2, y2 = t["x2"], t["y2"]
                    center_x, center_y = t["center_x"], t["center_y"]
                    width, height = t["width"], t["height"]
                    label = t["label"]
                    conf = t["confidence"]

                    cnc_x, cnc_y = self._map_to_cnc(center_x, center_y, cnc_origin, cnc_span, work_area)
                    cnc_x += camera_offset[0]
                    cnc_y += camera_offset[1]

                    box_polygon = [
                        [round(x1, 1), round(y1, 1)],
                        [round(x2, 1), round(y1, 1)],
                        [round(x2, 1), round(y2, 1)],
                        [round(x1, 1), round(y2, 1)],
                    ]

                    cv2.rectangle(annotated_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 165, 255), 2)
                    tag_text = f"#{idx + 1} {label}"
                    cv2.putText(annotated_frame, tag_text, (int(x1), max(15, int(y1) - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1)

                    processed_objects.append({
                        "id": idx + 1,
                        "label": label,
                        "confidence": round(conf, 2),
                        "pixel_x": round(center_x, 1),
                        "pixel_y": round(center_y, 1),
                        "cnc_x": round(cnc_x, 1),
                        "cnc_y": round(cnc_y, 1),
                        "width": round(width, 1),
                        "height": round(height, 1),
                        "box_polygon": box_polygon,
                    })
            else:
                # --- Nhận diện bằng ChatGPT Vision (GPT-4o hoặc GPT-4o-mini) ---
                has_work_area = work_area is not None and len(work_area) == 4
                inv_M = None
                warped_img = None
                is_cropped = False

                if has_work_area:
                    try:
                        from services.vision_service import warp_perspective_region, order_corners
                        ordered = order_corners(work_area)
                        side_w = max(float(np.linalg.norm(ordered[1] - ordered[0])), float(np.linalg.norm(ordered[2] - ordered[3])))
                        side_h = max(float(np.linalg.norm(ordered[3] - ordered[0])), float(np.linalg.norm(ordered[2] - ordered[1])))
                        long_side = max(side_w, side_h, 1.0)
                        s = 1024.0 / long_side
                        out_w, out_h = max(64, int(side_w * s)), max(64, int(side_h * s))
                        warped_img, M = warp_perspective_region(frame, ordered, (out_w, out_h))
                        inv_M = np.linalg.inv(M)
                        input_img = warped_img
                        is_cropped = True
                    except Exception as e:
                        logger.warning("Failed to warp work area, fallback to full frame: %s", e)
                        input_img = frame
                        is_cropped = False
                else:
                    input_img = frame
                    is_cropped = False

                raw_targets = self._detect_chatgpt_vision(
                    image=input_img,
                    prompt=prompt,
                    model_name=model_type,
                    api_key=api_key,
                    is_cropped_screen=is_cropped,
                )
                warped_annotated = warped_img.copy() if warped_img is not None else None

                for idx, t in enumerate(raw_targets):
                    xw1, yw1 = t["x1"], t["y1"]
                    xw2, yw2 = t["x2"], t["y2"]
                    label = t["label"]
                    conf = t["confidence"]

                    if is_cropped and inv_M is not None:
                        # Draw bounding box on the warped rectified screen
                        if warped_annotated is not None:
                            cv2.rectangle(warped_annotated, (int(xw1), int(yw1)), (int(xw2), int(yw2)), (16, 185, 129), 2)
                            cv2.putText(warped_annotated, f"#{idx+1} {label}", (int(xw1), max(15, int(yw1) - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (16, 185, 129), 1)

                        # Transform 4 corners of box back to original camera frame
                        box_w = np.array([[[xw1, yw1]], [[xw2, yw1]], [[xw2, yw2]], [[xw1, yw2]]], dtype=np.float32)
                        box_orig = cv2.perspectiveTransform(box_w, inv_M)[:, 0]
                        box_polygon = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in box_orig]

                        # Center point in original camera frame
                        cx_w, cy_w = (xw1 + xw2) / 2.0, (yw1 + yw2) / 2.0
                        pt_w = np.array([[[cx_w, cy_w]]], dtype=np.float32)
                        pt_orig = cv2.perspectiveTransform(pt_w, inv_M)[0, 0]
                        center_x = float(pt_orig[0])
                        center_y = float(pt_orig[1])

                        width = float(np.linalg.norm(box_orig[1] - box_orig[0]))
                        height = float(np.linalg.norm(box_orig[3] - box_orig[0]))

                        # Draw rotated polygon on main camera view
                        poly_pts = np.array(box_polygon, dtype=np.int32)
                        cv2.polylines(annotated_frame, [poly_pts], True, (16, 185, 129), 2)
                        tag_x = int(min(p[0] for p in box_polygon))
                        tag_y = int(min(p[1] for p in box_polygon))
                        tag_text = f"#{idx + 1} {label}"
                        (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                        cv2.rectangle(annotated_frame, (tag_x, max(0, tag_y - th - 6)), (tag_x + tw + 6, max(th + 6, tag_y)), (16, 185, 129), -1)
                        cv2.putText(annotated_frame, tag_text, (tag_x + 3, max(th + 2, tag_y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

                    else:
                        center_x = t["center_x"]
                        center_y = t["center_y"]
                        width = t["width"]
                        height = t["height"]
                        box_polygon = [
                            [round(xw1, 1), round(yw1, 1)],
                            [round(xw2, 1), round(yw1, 1)],
                            [round(xw2, 1), round(yw2, 1)],
                            [round(xw1, 1), round(yw2, 1)],
                        ]
                        cv2.rectangle(annotated_frame, (int(xw1), int(yw1)), (int(xw2), int(yw2)), (16, 185, 129), 2)
                        tag_text = f"#{idx + 1} {label}"
                        (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                        cv2.rectangle(annotated_frame, (int(xw1), max(0, int(yw1) - th - 6)), (int(xw1) + tw + 6, max(th + 6, int(yw1))), (16, 185, 129), -1)
                        cv2.putText(annotated_frame, tag_text, (int(xw1) + 3, max(th + 2, int(yw1) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

                    # Ánh xạ sang tọa độ CNC
                    cnc_x, cnc_y = self._map_to_cnc(center_x, center_y, cnc_origin, cnc_span, work_area)
                    cnc_x += camera_offset[0]
                    cnc_y += camera_offset[1]

                    processed_objects.append({
                        "id": idx + 1,
                        "label": label,
                        "confidence": round(conf, 2),
                        "pixel_x": round(center_x, 1),
                        "pixel_y": round(center_y, 1),
                        "cnc_x": round(cnc_x, 1),
                        "cnc_y": round(cnc_y, 1),
                        "width": round(width, 1),
                        "height": round(height, 1),
                        "box_polygon": box_polygon,
                    })

            annotated_b64 = encode_image_to_base64(annotated_frame)
            warped_b64 = encode_image_to_base64(warped_annotated) if warped_annotated is not None else annotated_b64
            return {
                "success": True,
                "count": len(processed_objects),
                "image": annotated_b64,
                "warped_preview": warped_b64,
                "objects": processed_objects,
            }
        except Exception as exc:
            logger.exception("AI Detection failed: %s", exc)
            err_msg = str(exc)
            if "AuthenticationError" in type(exc).__name__ or "invalid_api_key" in err_msg.lower():
                err_msg = "OpenAI API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại key."
            elif "RateLimitError" in type(exc).__name__ or "insufficient_quota" in err_msg.lower():
                err_msg = "OpenAI API Key đã hết lượt sử dụng (quota) hoặc bị rate limit."
            return {"success": False, "message": err_msg, "image": None, "warped_preview": None, "objects": []}

    @staticmethod
    def _iou(a, b) -> float:
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        return inter / union if union > 0 else 0.0

    @staticmethod
    def _filter_device_boxes(boxes: List[Tuple[int, int, int, int]], min_area_ratio: float = 0.25,
                             max_overlap: float = 0.5) -> List[Tuple[int, int, int, int]]:
        """Remove spurious device detections: boxes much smaller than the biggest device (servo, card, cable...)
        and boxes that mostly overlap an already-kept, larger box (duplicate detections of the same POS)."""
        if len(boxes) <= 1:
            return list(boxes)
        area = lambda b: max(0, b[2] - b[0]) * max(0, b[3] - b[1])
        ordered = sorted(boxes, key=area, reverse=True)
        biggest = area(ordered[0]) or 1
        kept: List[Tuple[int, int, int, int]] = []
        for b in ordered:
            a = area(b)
            if a < min_area_ratio * biggest:
                continue
            overlapped = False
            for k in kept:
                ix = max(0, min(b[2], k[2]) - max(b[0], k[0]))
                iy = max(0, min(b[3], k[3]) - max(b[1], k[1]))
                if a > 0 and (ix * iy) / a > max_overlap:
                    overlapped = True
                    break
            if not overlapped:
                kept.append(b)
        return kept

    def _detect_opencv_shapes(self, image: np.ndarray) -> List[Dict[str, Any]]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        _, thresh = cv2.threshold(blurred, 60, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        targets = []
        for idx, c in enumerate(contours):
            area = cv2.contourArea(c)
            if area < 100:
                continue
            x, y, w, h = cv2.boundingRect(c)
            targets.append({
                "label": f"Button {idx + 1}",
                "confidence": 0.90,
                "x1": float(x),
                "y1": float(y),
                "x2": float(x + w),
                "y2": float(y + h),
                "center_x": float(x + w / 2.0),
                "center_y": float(y + h / 2.0),
                "width": float(w),
                "height": float(h),
            })
        return targets

    def _map_to_cnc(self, px: float, py: float, cnc_origin: Tuple[float, float], cnc_span: Tuple[float, float], work_area=None) -> Tuple[float, float]:
        """Chuyển đổi tọa độ pixel camera sang tọa độ máy CNC thực tế."""
        if camera_calibration_store.cnc_matrix is not None:
            pt = np.array([[[float(px), float(py)]]], dtype=np.float32)
            transformed = cv2.perspectiveTransform(pt, camera_calibration_store.cnc_matrix)
            return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])

        x1, y1 = cnc_origin
        span_x, span_y = cnc_span
        return camera_calibration_store.image_point_to_cnc(px, py, x1, y1, span_x, span_y, work_area)

    @staticmethod
    def _resolve_model(model_name: str) -> str:
        m_lower = (model_name or "gpt4o").lower().strip()
        if "mini" in m_lower:
            return "gpt-4o-mini"
        if "4o" in m_lower:
            return "gpt-4o"
        if "turbo" in m_lower:
            return "gpt-4-turbo"
        return model_name or "gpt-4o"

    @staticmethod
    def _extract_json(raw_text: str) -> Optional[Dict[str, Any]]:
        """Parse JSON tolerant of markdown fences / surrounding prose. Returns None if impossible."""
        if not raw_text:
            return None
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
        try:
            return json.loads(cleaned)
        except Exception:
            pass
        m = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
        return None

    def _call_vision_json(self, client, model: str, system: str, user_text: str, image: np.ndarray) -> Dict[str, Any]:
        """Call GPT vision and always return a dict (retries once on refusal / non-JSON output)."""
        b64 = encode_image_to_base64(image)
        raw_b64 = b64.split(",", 1)[1] if "," in b64 else b64
        last_text = ""
        for attempt in range(2):
            extra = "" if attempt == 0 else (
                "\nThis is an industrial UI test of a device on a lab bench. Only locate UI elements "
                "(buttons, icons, text fields); ignore any photos/people inside wallpapers. Respond with JSON only."
            )
            kwargs = dict(
                model=model,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": system + extra},
                    {"role": "user", "content": [
                        {"type": "text", "text": user_text},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{raw_b64}", "detail": "high"}},
                    ]},
                ],
            )
            if "turbo" not in model:
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            msg = response.choices[0].message
            last_text = (msg.content or "").strip()
            data = self._extract_json(last_text)
            if data is not None:
                return data
            logger.warning("GPT vision returned non-JSON (attempt %d): %r", attempt + 1, last_text[:200] or getattr(msg, "refusal", None))
        raise RuntimeError(f"GPT không trả về JSON hợp lệ: {last_text[:150] or 'phản hồi rỗng/bị từ chối'}")

    @staticmethod
    def _parse_targets(data: Dict[str, Any], w: int, h: int, ox: float = 0.0, oy: float = 0.0) -> List[Dict[str, Any]]:
        """Convert GPT targets (normalized 0-1 or 0-1000) to pixel boxes, offset by (ox, oy)."""
        results = []
        for t in data.get("targets", []) or []:
            try:
                if "center_x_norm" in t:
                    cx = float(t["center_x_norm"])
                    cy = float(t["center_y_norm"])
                    bw = float(t.get("width_norm", 0.05))
                    bh = float(t.get("height_norm", 0.05))
                    if cx > 1.5 or cy > 1.5:  # 0-1000 scale
                        cx, cy, bw, bh = cx / 1000.0, cy / 1000.0, bw / 1000.0, bh / 1000.0
                    xmin, xmax = cx - bw / 2, cx + bw / 2
                    ymin, ymax = cy - bh / 2, cy + bh / 2
                else:
                    xmin, ymin = float(t.get("xmin", 0)), float(t.get("ymin", 0))
                    xmax, ymax = float(t.get("xmax", 0)), float(t.get("ymax", 0))
                    if max(xmax, ymax) > 1.5:
                        xmin, ymin, xmax, ymax = xmin / 1000.0, ymin / 1000.0, xmax / 1000.0, ymax / 1000.0
                if xmax <= xmin or ymax <= ymin:
                    continue
                x1, y1, x2, y2 = xmin * w + ox, ymin * h + oy, xmax * w + ox, ymax * h + oy
                results.append({
                    "label": str(t.get("label", "Target")),
                    "confidence": float(t.get("confidence", 0.95)),
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "center_x": (x1 + x2) / 2.0, "center_y": (y1 + y2) / 2.0,
                    "width": max(1.0, x2 - x1), "height": max(1.0, y2 - y1),
                })
            except Exception as e:
                logger.warning("Error parsing target item: %s", e)
        return results

    @staticmethod
    def _enhance_crop(img: np.ndarray) -> np.ndarray:
        """CLAHE on luminance + mild unsharp mask so faint/blurred icons and keys become visible."""
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(6, 6))
        l = clahe.apply(l)
        out = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
        blur = cv2.GaussianBlur(out, (0, 0), 2.0)
        return cv2.addWeighted(out, 1.6, blur, -0.6, 0)

    def _detect_elements_in_crop(self, client, model: str, image: np.ndarray, box_px: Tuple[int, int, int, int],
                                 user_target: str, schema: str) -> List[Dict[str, Any]]:
        """Zoom into one device box (x1,y1,x2,y2 in image px), overlay grid, ask GPT for elements,
        and return boxes in the coordinate space of `image`."""
        h, w = image.shape[:2]
        cx1, cy1, cx2, cy2 = box_px
        cx1, cy1, cx2, cy2 = max(0, cx1), max(0, cy1), min(w, cx2), min(h, cy2)
        if cx2 - cx1 < 20 or cy2 - cy1 < 20:
            return []
        crop = image[cy1:cy2, cx1:cx2]
        ch, cw = crop.shape[:2]
        scale = 1280.0 / max(ch, cw)
        if scale > 1.0:
            crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_CUBIC)

        grid = self._enhance_crop(crop)
        gh, gw = grid.shape[:2]
        for i in range(1, 10):
            v = i / 10.0
            gx, gy = int(v * gw), int(v * gh)
            cv2.line(grid, (gx, 0), (gx, gh), (0, 255, 255), 1)
            cv2.line(grid, (0, gy), (gw, gy), (0, 255, 255), 1)
            cv2.putText(grid, f"{v:.1f}", (gx + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(grid, f"{v:.1f}", (2, gy - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)

        system = (
            "You are a precision UI touch-localization assistant for a robotic CNC stylus tester. The image is cropped to "
            "ONE phone/POS device and has a thin YELLOW GRID with labels 0.1-0.9 (x labels on top, y labels on the left) "
            "- use it to read accurate normalized coordinates, then ignore the grid itself. "
            "Detect EVERY individual touchable element INSIDE the lit screen, specifically observing: "
            "1. Numeric keypad layout: Row 1 (1, 2, 3), Row 2 (4, 5, 6), Row 3 (7, 8, 9), Row 4 (Clear 'C', '0', Backspace '<'). "
            "2. Action buttons BELOW the keypad: Wide rectangular buttons such as 'Cancel' on the left and 'Pay' on the right. "
            "3. Bottom navigation bar (if visible at the bottom chin): 'Nav Back' (<), 'Nav Home' (O), 'Nav Recents' (|||). "
            "4. App icons, back header arrow, amount fields, and text labels. "
            "CRITICAL ACCURACY REQUIREMENT: Do NOT place Cancel/Pay inside the numeric 0 row. Cancel and Pay are wide action buttons BELOW the numeric keys. "
            "center_x_norm and center_y_norm MUST strictly coincide with the exact visible physical center of the button/key as aligned with the yellow grid numbers (0.1 - 0.9). "
            "Each box tightly encloses ONE element. "
            "Label each element with the EXACT visible text on it (e.g. 'Pay', 'Cancel', '1', '2', 'C', 'Purchase'). " + schema
        )
        data = self._call_vision_json(client, model, system, user_target, grid)
        res = self._parse_targets(data, cw, ch)
        res = [r for r in res if 0 <= r["center_x"] <= cw and 0 <= r["center_y"] <= ch]
        for r in res:
            r["x1"] += cx1; r["x2"] += cx1
            r["y1"] += cy1; r["y2"] += cy1
            r["center_x"] += cx1; r["center_y"] += cy1
        return res

    def _detect_chatgpt_vision(
        self,
        image: np.ndarray,
        prompt: str = "",
        model_name: str = "gpt4o",
        api_key: Optional[str] = None,
        is_cropped_screen: bool = False,
    ) -> List[Dict[str, Any]]:
        """Multi-device GPT vision. The work area (CNC travel range) may hold several devices:
        YOLO finds every phone, each one is zoomed and analysed separately, results are merged."""
        client = get_openai_client(api_key=api_key)
        h, w = image.shape[:2]
        model = self._resolve_model(model_name)
        user_target = prompt.strip() if prompt and prompt.strip() else (
            "ALL UI elements on the device screen: every app icon, dock icon, button, key, text field, toggle, widget."
        )
        schema = (
            "Return JSON ONLY: {\"screen_bbox\": [xmin, ymin, xmax, ymax], \"targets\": [{\"label\": str, "
            "\"confidence\": 0.0-1.0, \"center_x_norm\": 0-1, \"center_y_norm\": 0-1, \"width_norm\": 0-1, \"height_norm\": 0-1}]}. "
            "All coordinates are normalized 0.0-1.0 relative to the image given."
        )
        if is_cropped_screen:
            # Vùng làm việc đã được căn chỉnh 4 góc chuẩn xác thành màn hình thiết bị:
            # Quét trực tiếp 1 lần (single-pass) trên toàn màn hình, không cắt lát (tiling) tránh lệch toạ độ và tăng tốc độ gấp 3 lần!
            return self._detect_elements_in_crop(client, model, image, (0, 0, w, h), user_target, schema)

        # ---- Find every device in the work area ----
        device_boxes: List[Tuple[int, int, int, int]] = []
        try:
            yres = get_yolo_model()(image, conf=0.25, verbose=False)[0]
            for b in yres.boxes:
                bx1, by1, bx2, by2 = b.xyxy[0].tolist()
                ix, iy = (bx2 - bx1) * 0.04, (by2 - by1) * 0.03  # inset to approximate lit screen
                device_boxes.append((int(bx1 + ix), int(by1 + iy), int(bx2 - ix), int(by2 - iy)))
        except Exception as e:
            logger.warning("YOLO device locate failed: %s", e)
        device_boxes = self._filter_device_boxes(device_boxes)
        device_boxes.sort(key=lambda b: (b[0], b[1]))  # left-to-right

        if not device_boxes:
            # Fallback: let GPT locate devices (may return several), else treat whole area as one device
            try:
                sys1 = (
                    "You are a computer-vision assistant for a CNC stylus tester. The image is a top-down view of a table "
                    "with one or MORE smartphones / POS terminals. Return each device screen as a separate entry in targets "
                    "(label 'device') using center_x_norm/center_y_norm/width_norm/height_norm. " + schema
                )
                d1 = self._call_vision_json(client, model, sys1, "Locate every device screen.", image)
                for t in self._parse_targets(d1, w, h):
                    device_boxes.append((int(t["x1"]), int(t["y1"]), int(t["x2"]), int(t["y2"])))
            except Exception as e:
                logger.warning("GPT device locate failed: %s", e)
        if not device_boxes:
            device_boxes = [(0, 0, w, h)]

        multi = len(device_boxes) > 1
        merged: List[Dict[str, Any]] = []
        errors = []
        for di, box in enumerate(device_boxes, start=1):
            try:
                res = self._detect_device_tiled(client, model, image, box, user_target, schema)
            except Exception as e:
                logger.warning("Device %d detection failed: %s", di, e)
                errors.append(str(e))
                continue
            for r in res:
                if multi:
                    r["label"] = f"D{di} {r['label']}"
                merged.append(r)
        if not merged and errors:
            raise RuntimeError(errors[0])
        return [r for r in merged if 0 <= r["center_x"] <= w and 0 <= r["center_y"] <= h]

    def _detect_device_tiled(self, client, model: str, image: np.ndarray, box: Tuple[int, int, int, int],
                             user_target: str, schema: str) -> List[Dict[str, Any]]:
        """Scan one device in overlapping tiles + full pass so no row of icons is skipped."""
        x1, y1, x2, y2 = box
        bw, bh = x2 - x1, y2 - y1
        tiles: List[Tuple[Tuple[int, int, int, int], Optional[str], Optional[str]]] = []
        ov = 0.12
        if bh >= bw * 1.1:
            mid = (y1 + y2) // 2
            ovp = int(bh * ov)
            tiles.append(((x1, y1, x2, mid + ovp), None, "bottom"))
            tiles.append(((x1, mid - ovp, x2, y2), "top", None))
        elif bw >= bh * 1.1:
            mid = (x1 + x2) // 2
            ovp = int(bw * ov)
            tiles.append(((x1, y1, mid + ovp, y2), None, "right"))
            tiles.append(((mid - ovp, y1, x2, y2), "left", None))

        if max(bw, bh) < 700:
            tiles = []  # tiny crops: tiling only upscales blur and encourages hallucination
        tile_prompt = user_target + " (This image is only a PART of the device; list every element fully visible here, skip ones cut by the image border.)"
        collected: List[Dict[str, Any]] = []
        for tbox, cut_start, cut_end in tiles:
            try:
                res = self._detect_elements_in_crop(client, model, image, tbox, tile_prompt, schema)
            except Exception as e:
                logger.warning("Tile detection failed: %s", e)
                continue
            tx1, ty1, tx2, ty2 = tbox
            mx, my = 0.03 * (tx2 - tx1), 0.03 * (ty2 - ty1)
            for r in res:
                # drop elements cut by an interior tile border
                if cut_end == "bottom" and r["y2"] > ty2 - my:
                    continue
                if cut_start == "top" and r["y1"] < ty1 + my:
                    continue
                if cut_end == "right" and r["x2"] > tx2 - mx:
                    continue
                if cut_start == "left" and r["x1"] < tx1 + mx:
                    continue
                collected.append(r)

        # Full pass fills anything the tiles missed
        try:
            collected.extend(self._detect_elements_in_crop(client, model, image, box, user_target, schema))
        except Exception as e:
            if not collected:
                raise
            logger.warning("Full-device pass failed: %s", e)

        # Dedupe by center distance; earlier (tile) results win
        kept: List[Dict[str, Any]] = []
        for r in collected:
            dup = False
            for k in kept:
                thr = 0.5 * min(r["width"], r["height"], k["width"], k["height"])
                thr = max(thr, 0.02 * max(bw, bh))
                if abs(r["center_x"] - k["center_x"]) < thr and abs(r["center_y"] - k["center_y"]) < thr:
                    dup = True
                    break
            if not dup:
                kept.append(r)

        # Note: _refine_in_crop drew red box index numbers which confused GPT into labeling buttons as '1', '2', '3' etc.
        # Keeping first-pass results preserves exact text labels (Refund, Cancel, Payments, etc.) with 2x faster response.
        kept.sort(key=lambda r: (round(r["center_y"] / max(1.0, bh * 0.06)), r["center_x"]))
        return kept

    def _refine_in_crop(self, client, model: str, image: np.ndarray, box: Tuple[int, int, int, int],
                        current: List[Dict[str, Any]], user_target: str, schema: str) -> List[Dict[str, Any]]:
        """Draw the current detections on the device crop and let GPT correct them visually
        (move misplaced, delete invented, add missing)."""
        h, w = image.shape[:2]
        x1, y1, x2, y2 = max(0, box[0]), max(0, box[1]), min(w, box[2]), min(h, box[3])
        if x2 - x1 < 20 or y2 - y1 < 20:
            return []
        crop = image[y1:y2, x1:x2]
        ch, cw = crop.shape[:2]
        scale = 1280.0 / max(ch, cw)
        if scale > 1.0:
            crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_CUBIC)
        else:
            scale = 1.0
        vis = self._enhance_crop(crop)
        for i, r in enumerate(current, start=1):
            bx1, by1 = int((r["x1"] - x1) * scale), int((r["y1"] - y1) * scale)
            bx2, by2 = int((r["x2"] - x1) * scale), int((r["y2"] - y1) * scale)
            cv2.rectangle(vis, (bx1, by1), (bx2, by2), (0, 255, 0), 2)
            cv2.putText(vis, str(i), (bx1 + 2, max(14, by1 + 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2, cv2.LINE_AA)

        system = (
            "You are a precision UI touch-localization assistant for a robotic CNC stylus tester. The image is cropped to "
            "ONE phone/POS device. GREEN numbered boxes are a previous automatic detection that may be MISPLACED, wrongly "
            "sized, duplicated, or INVENTED (not really visible). Re-examine the image yourself and return the CORRECT FINAL list "
            "of ALL real touchable elements that are actually visible on the lit screen (app icons, folder icons, buttons, "
            "input fields, nav-bar buttons only if visible, dock icons). Rules: (1) center_x_norm/center_y_norm must be the exact "
            "visual center of the element in THIS image (0-1); (2) the box tightly encloses ONE element; (3) delete boxes that are on "
            "bezel, table, wallpaper or empty space; (4) add any visible element missing - check every row/column; "
            "(5) label with the text actually shown under/on the element, never invent names; (6) ignore the green drawings themselves. "
            + schema
        )
        data = self._call_vision_json(client, model, system, user_target, vis)
        res = self._parse_targets(data, cw, ch)
        res = [r for r in res if 0 <= r["center_x"] <= cw and 0 <= r["center_y"] <= ch]
        for r in res:
            r["x1"] += x1; r["x2"] += x1
            r["y1"] += y1; r["y2"] += y1
            r["center_x"] += x1; r["center_y"] += y1
        return res

    def _detect_chatgpt_vision_single(
        self,
        image: np.ndarray,
        prompt: str = "",
        model_name: str = "gpt4o",
        api_key: Optional[str] = None,
        is_cropped_screen: bool = False,
    ) -> List[Dict[str, Any]]:
        """Two-stage GPT vision: (1) locate device screen, (2) zoom into it and detect every UI element
        (buttons, app icons, dock, status bar, input fields...)."""
        client = get_openai_client(api_key=api_key)
        h, w = image.shape[:2]
        model = self._resolve_model(model_name)
        user_target = prompt.strip() if prompt and prompt.strip() else (
            "ALL UI elements on the device screen: every app icon, dock icon, button, key, text field, toggle, widget."
        )

        schema = (
            "Return JSON ONLY: {\"screen_bbox\": [xmin, ymin, xmax, ymax], \"targets\": [{\"label\": str, "
            "\"confidence\": 0.0-1.0, \"center_x_norm\": 0-1, \"center_y_norm\": 0-1, \"width_norm\": 0-1, \"height_norm\": 0-1}]}. "
            "All coordinates are normalized 0.0-1.0 relative to the image given."
        )

        # ---- Stage 1: locate the physical device screen ----
        stage1_sys = (
            "You are a computer-vision assistant for a CNC stylus tester. The image is a top-down view of a table "
            "with a smartphone / POS terminal on it. Locate the lit touchscreen display of the device (exclude bezel, "
            "holder, table). Put it in screen_bbox and leave targets as an empty list. " + schema
        )
        screen_box = None
        try:
            ymodel = get_yolo_model()
            yres = ymodel(image, conf=0.25, verbose=False)[0]
            if len(yres.boxes) > 0:
                best = max(yres.boxes, key=lambda b: float(b.conf[0]))
                bx1, by1, bx2, by2 = best.xyxy[0].tolist()
                bw_, bh_ = bx2 - bx1, by2 - by1
                # Inset a little from phone body to approximate the lit screen
                ix, iy = bw_ * 0.04, bh_ * 0.03
                screen_box = (
                    max(0.0, (bx1 + ix) / w), max(0.0, (by1 + iy) / h),
                    min(1.0, (bx2 - ix) / w), min(1.0, (by2 - iy) / h),
                )
        except Exception as e:
            logger.warning("YOLO phone locate failed, falling back to GPT: %s", e)

        if screen_box is None:
          try:
            d1 = self._call_vision_json(client, model, stage1_sys, "Locate the device screen.", image)
            sb = d1.get("screen_bbox")
            if isinstance(sb, (list, tuple)) and len(sb) == 4:
                sx1, sy1, sx2, sy2 = [float(v) for v in sb]
                if max(sx1, sy1, sx2, sy2) > 1.5:
                    sx1, sy1, sx2, sy2 = sx1 / 1000.0, sy1 / 1000.0, sx2 / 1000.0, sy2 / 1000.0
                if sx2 - sx1 > 0.1 and sy2 - sy1 > 0.1:
                    screen_box = (max(0.0, sx1), max(0.0, sy1), min(1.0, sx2), min(1.0, sy2))
          except Exception as e:
            logger.warning("Stage 1 (screen locate) failed, using full image: %s", e)

        # ---- Stage 2: zoomed crop of the screen -> detect inner elements ----
        if screen_box is not None:
            pad = 0.02
            cx1 = int(max(0.0, screen_box[0] - pad) * w)
            cy1 = int(max(0.0, screen_box[1] - pad) * h)
            cx2 = int(min(1.0, screen_box[2] + pad) * w)
            cy2 = int(min(1.0, screen_box[3] + pad) * h)
            crop = image[cy1:cy2, cx1:cx2]
        else:
            cx1 = cy1 = 0
            crop = image
        ch, cw = crop.shape[:2]
        scale = 1280.0 / max(ch, cw)
        if scale > 1.0:
            crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_CUBIC)

        # Grid overlay (10% steps, labelled) greatly improves GPT coordinate accuracy
        grid = crop.copy()
        gh, gw = grid.shape[:2]
        for i in range(1, 10):
            v = i / 10.0
            gx, gy = int(v * gw), int(v * gh)
            cv2.line(grid, (gx, 0), (gx, gh), (0, 255, 255), 1)
            cv2.line(grid, (0, gy), (gw, gy), (0, 255, 255), 1)
            cv2.putText(grid, f"{v:.1f}", (gx + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(grid, f"{v:.1f}", (2, gy - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)

        stage2_sys = (
            "You are a precision UI touch-localization assistant for a robotic CNC stylus tester. The image is cropped to "
            "the phone/POS device and has a thin YELLOW GRID with labels 0.1-0.9 (x labels on top, y labels on the left) "
            "- use it to read accurate normalized coordinates, then ignore the grid itself. "
            "Detect EVERY individual touchable element INSIDE the lit screen, including: each app icon (use the app name as label, e.g. 'Camera', 'Settings'), "
            "dock icons, buttons, keypad keys, input fields, search bars, toggles, widgets. "
            "center_x_norm / center_y_norm must be the exact center of the element relative to THIS cropped image (0-1), "
            "and must never fall on the bezel, table or background. Each box tightly encloses ONE element. "
            "Do not merge icons and do not invent elements. Ignore wallpaper photos/people. "
            "If the user asks for specific elements, return only those; otherwise return all. " + schema
        )
        d2 = self._call_vision_json(client, model, stage2_sys, user_target, grid)
        results = self._parse_targets(d2, cw, ch, ox=0.0, oy=0.0)
        # Keep only targets whose center lies inside the device crop (never on table/background)
        results = [r for r in results if 0 <= r["center_x"] <= cw and 0 <= r["center_y"] <= ch]
        # Boxes are in original-crop pixel space; shift by crop origin back to the input image
        out = results
        for r in out:
            r["x1"] += cx1
            r["x2"] += cx1
            r["y1"] += cy1
            r["y2"] += cy1
            r["center_x"] += cx1
            r["center_y"] += cy1
        # Drop boxes that fall outside the original image
        return [r for r in out if 0 <= r["center_x"] <= w and 0 <= r["center_y"] <= h]

    def _detect_chatgpt_vision_legacy(
        self,
        image: np.ndarray,
        prompt: str = "",
        model_name: str = "gpt4o",
        api_key: Optional[str] = None,
        is_cropped_screen: bool = False,
    ) -> List[Dict[str, Any]]:
        """Sử dụng mô hình ChatGPT Vision (GPT-4o / GPT-4o-mini) để nhận diện toàn bộ UI element trên màn hình máy POS/điện thoại."""
        client = get_openai_client(api_key=api_key)
        h, w = image.shape[:2]
        base64_img = encode_image_to_base64(image)
        raw_b64 = base64_img.split(",", 1)[1] if "," in base64_img else base64_img

        # Normalize model selection
        m_lower = (model_name or "gpt4o").lower().strip()
        if "mini" in m_lower:
            chosen_model = "gpt-4o-mini"
        elif "4o" in m_lower:
            chosen_model = "gpt-4o"
        elif "turbo" in m_lower:
            chosen_model = "gpt-4-turbo"
        else:
            chosen_model = model_name or "gpt-4o"

        user_target = prompt.strip() if prompt and prompt.strip() else "Detect all buttons, numeric keypad keys (0-9), app icons, Enter/OK, Cancel, and input fields on the POS machine or smartphone screen."

        system_instruction = (
            "You are an industrial computer vision and precision UI touch localization assistant for a robotic CNC stylus tester.\n"
            "The image provided is a top-down view of a testing table. Resting on the table is a physical electronic device (such as a POS payment terminal or smartphone).\n\n"
            "CRITICAL SPATIAL INSTRUCTIONS:\n"
            "1. The background surface is just a table. Do NOT place targets on the table or surrounding items (like wires, tape, wood).\n"
            "2. The user wants to test the physical device (POS terminal / smartphone).\n"
            "3. The device has a rectangular touchscreen display (often showing an app, header, amount display, and keypad).\n"
            "4. All touchable UI elements (buttons, keys 1-9, 0, Cancel, OK, Enter, input boxes) reside STRICTLY INSIDE THE ILLUMINATED SCREEN of the device.\n"
            "5. First locate the bounding box of the device screen: screen_bbox: [xmin, ymin, xmax, ymax] normalized [0.0 to 1.0].\n"
            "6. Then locate all requested targets strictly within this screen. Each target's center_x_norm and center_y_norm MUST lie strictly inside screen_bbox!\n\n"
            "Return JSON ONLY:\n"
            "{\n"
            '  "screen_bbox": [0.1, 0.2, 0.9, 0.8],\n'
            '  "targets": [\n'
            "    {\n"
            '      "label": "Tên tiếng Việt hoặc tiếng Anh chính xác (e.g. Nút 1, Nút OK, Ô nhập tiền)",\n'
            '      "confidence": 0.98,\n'
            '      "center_x_norm": 0.50,\n'
            '      "center_y_norm": 0.55,\n'
            '      "width_norm": 0.06,\n'
            '      "height_norm": 0.04\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "Do NOT include explanation or markdown outside the JSON."
        )

        response = client.chat.completions.create(
            model=chosen_model,
            temperature=0.1,
            messages=[
                {"role": "system", "content": system_instruction},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_target},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{raw_b64}", "detail": "high"}},
                    ],
                },
            ],
        )

        raw_text = (response.choices[0].message.content or "").strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
        data = json.loads(cleaned)

        results = []
        for t in data.get("targets", []):
            try:
                xmin = float(t.get("xmin", 0))
                ymin = float(t.get("ymin", 0))
                xmax = float(t.get("xmax", 0))
                ymax = float(t.get("ymax", 0))

                # Handle alternate schema if model returns normalized 0.0 - 1.0
                if xmax <= 1.0 and ymax <= 1.0 and (xmax > 0 or ymax > 0):
                    xmin *= 1000.0
                    ymin *= 1000.0
                    xmax *= 1000.0
                    ymax *= 1000.0

                # Handle center_x_norm/center_y_norm if returned
                if xmax == 0 and "center_x_norm" in t:
                    cx = float(t["center_x_norm"]) * 1000.0
                    cy = float(t["center_y_norm"]) * 1000.0
                    half_w = float(t.get("width_norm", 0.05)) * 500.0
                    half_h = float(t.get("height_norm", 0.05)) * 500.0
                    xmin, xmax = cx - half_w, cx + half_w
                    ymin, ymax = cy - half_h, cy + half_h

                conf = float(t.get("confidence", 0.95))
                label = str(t.get("label", "Target"))

                x1 = (xmin / 1000.0) * w
                y1 = (ymin / 1000.0) * h
                x2 = (xmax / 1000.0) * w
                y2 = (ymax / 1000.0) * h

                width = max(1.0, x2 - x1)
                height = max(1.0, y2 - y1)
                center_x = x1 + width / 2.0
                center_y = y1 + height / 2.0

                results.append({
                    "label": label,
                    "confidence": conf,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "center_x": center_x,
                    "center_y": center_y,
                    "width": width,
                    "height": height,
                })
            except Exception as e:
                logger.warning("Error parsing target item: %s", e)

        return results


ai_detector_service = AIDetectorService()

