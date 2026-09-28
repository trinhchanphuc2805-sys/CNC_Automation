import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

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

class AIDetectorService:
    def detect_in_region(
        self,
        frame: np.ndarray,
        prompt: str = "",
        cnc_origin: Tuple[float, float] = (0.0, 0.0),
        cnc_span: Tuple[float, float] = (300.0, 300.0),
        camera_offset: Tuple[float, float] = (0.0, 0.0),
        invert_x: bool = False,
        invert_y: bool = True,
        swap_xy: bool = False,
    ) -> Dict[str, Any]:
        if frame is None:
            return {"success": False, "message": "No frame provided", "objects": []}

        h, w = frame.shape[:2]

        try:
            raw_objects = self._detect_yolo(frame, prompt)
        except Exception as exc:
            logger.exception("Detection failed: %s", exc)
            return {"success": False, "message": str(exc), "objects": []}

        x1, y1 = cnc_origin
        span_x, span_y = cnc_span
        off_x, off_y = camera_offset

        processed_objects = []
        for idx, item in enumerate(raw_objects):
            rx = float(item["center_x"])
            ry = float(item["center_y"])
            norm_x = max(0.0, min(1.0, rx / w))
            norm_y = max(0.0, min(1.0, ry / h))

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

            eff_norm_x = (1.0 - norm_x) if invert_x else norm_x
            eff_norm_y = (1.0 - norm_y) if invert_y else norm_y

            if swap_xy:
                eff_norm_x, eff_norm_y = eff_norm_y, eff_norm_x

            cnc_x = x1 + eff_norm_x * span_x + off_x
            cnc_y = y1 + eff_norm_y * span_y + off_y

            processed_objects.append({
                "id": idx + 1,
                "label": str(item.get("label", f"Target {idx + 1}")),
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

        return {
            "success": True,
            "count": len(processed_objects),
            "objects": processed_objects,
            "warped_preview": None,
            "work_area": [[0, 0], [w, 0], [w, h], [0, h]],
            "cnc_bounds": {"x1": x1, "y1": y1, "span_x": span_x, "span_y": span_y},
        }

    def _detect_yolo(self, image: np.ndarray, prompt: str = "") -> List[Dict[str, Any]]:
        model = get_yolo_model()
        results_yolo = model(image, conf=0.5, verbose=False)
        
        detected_candidates = []
        for result in results_yolo:
            boxes = result.boxes
            logger.info(f"YOLO detected {len(boxes)} boxes.")
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                label = model.names[cls]
                
                width = x2 - x1
                height = y2 - y1
                center_x = x1 + width / 2.0
                center_y = y1 + height / 2.0

                detected_candidates.append({
                    "label": label,
                    "confidence": conf,
                    "center_x": float(center_x),
                    "center_y": float(center_y),
                    "width": float(width),
                    "height": float(height),
                })
        return detected_candidates

ai_detector_service = AIDetectorService()
