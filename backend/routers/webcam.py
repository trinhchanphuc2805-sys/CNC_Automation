from fastapi import APIRouter, Depends, HTTPException

from schemas import (
    AiDetectRequest,
    CalibrateCncMappingRequest,
    CalibrationRequest,
    CaptureRequest,
    ImageOcrRequest,
    MapPixelRequest,
    OcrCheckRequest,
    OcrEngineRequest,
    OpenAiKeyRequest,
    SaveSnapshotRequest,
)
from services.ai_detector import ai_detector_service
from services.cnc_service import CNCService, get_service
from services.vision_service import (
    auto_detect_quadrilateral,
    camera_calibration_store,
    decode_image_data,
    encode_image_to_base64,
)
from services.webcam import OcrEngine, webcam_service


router = APIRouter(prefix="/api/webcam", tags=["Webcam"])


@router.get("/cameras")
def get_cameras():
    return {"cameras": webcam_service.list_cameras()}


@router.post("/warmup")
def warmup():
    if not webcam_service.warmup_ocr():
        raise HTTPException(status_code=502, detail="OCR warmup failed")
    return {"success": True}


@router.post("/set-ocr-engine")
def set_ocr_engine(request: OcrEngineRequest):
    try:
        engine = OcrEngine(request.engine)
    except ValueError as exc:
        valid_options = [engine.value for engine in OcrEngine]
        raise HTTPException(
            status_code=400,
            detail=f"Unknown OCR engine '{request.engine}'. Valid options: {valid_options}",
        ) from exc
    webcam_service.set_ocr_engine(engine)
    return {"success": True, "engine": webcam_service.get_ocr_engine().value}


@router.get("/ocr-engine")
def get_ocr_engine():
    return {"engine": webcam_service.get_ocr_engine().value}


@router.post("/capture")
def capture(request: CaptureRequest):
    success, path = webcam_service.capture(
        request.attempts,
        request.retry_delay,
        request.device_index,
    )
    return {
        "success": success,
        "path": str(path) if path else None,
        "image_url": f"/pictures/{path.name}" if path else None,
    }


@router.post("/save-snapshot")
def save_snapshot(request: SaveSnapshotRequest):
    import cv2
    import datetime
    from pathlib import Path

    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    PICTURES_DIR = Path(__file__).resolve().parents[2] / "pictures"
    PICTURES_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    path = PICTURES_DIR / f"snapshot_{timestamp}.png"
    
    success = cv2.imwrite(str(path), image)
    
    return {
        "success": success,
        "path": str(path) if success else None,
        "image_url": f"/pictures/{path.name}" if success else None,
    }


@router.post("/capture-and-check")
def capture_and_check(request: OcrCheckRequest):
    result = webcam_service.capture_and_check(
        pattern=request.pattern,
        device_index=request.device_index,
        capture_attempts=request.capture_attempts,
        capture_retry_delay=request.capture_retry_delay,
        ocr_attempts=request.ocr_attempts,
        ocr_retry_delay=request.ocr_retry_delay,
    )
    return {
        "success": result.capture_success,
        "matched": result.pattern_matched,
        "extracted_text": result.extracted_text,
        "path": str(result.image_path) if result.image_path else None,
        "image_url": f"/pictures/{result.image_path.name}" if result.image_path else None,
    }


@router.post("/check-image")
def check_image(request: ImageOcrRequest):
    result = webcam_service.check_image(request.image_data, request.pattern)
    return {
        "success": result.capture_success,
        "matched": result.pattern_matched,
        "extracted_text": result.extracted_text,
        "path": str(result.image_path) if result.image_path else None,
        "image_url": f"/pictures/{result.image_path.name}" if result.image_path else None,
    }


@router.post("/ai-detect")
def ai_detect(request: AiDetectRequest, service: CNCService = Depends(get_service)):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    controller = service.controller
    origin_x = request.origin_x if request.origin_x is not None else controller.x1
    origin_y = request.origin_y if request.origin_y is not None else controller.y1
    origin = (float(origin_x), float(origin_y))

    if request.cnc_width is not None and request.cnc_height is not None and request.cnc_width != 0 and request.cnc_height != 0:
        span = (float(request.cnc_width), float(request.cnc_height))
    else:
        span_x = max(1.0, controller.MAX_COL * controller.spach_x)
        span_y = max(1.0, controller.MAX_ROW * controller.spach_y)
        span = (span_x, span_y)

    result = ai_detector_service.detect_in_region(
        frame=image,
        work_area=request.work_area,
        prompt=request.prompt,
        model_type=request.model_type or "gpt4o",
        cnc_origin=origin,
        cnc_span=span,
        camera_offset=(request.camera_offset_x, request.camera_offset_y),
        invert_x=request.invert_x,
        invert_y=request.invert_y,
        swap_xy=request.swap_xy,
        api_key=request.api_key,
    )
    return result


@router.post("/map-pixel")
def map_pixel(request: MapPixelRequest, service: CNCService = Depends(get_service)):
    """Convert a camera pixel (e.g. a manually dragged detection marker) to CNC coordinates."""
    controller = service.controller
    origin = (
        float(request.origin_x if request.origin_x is not None else controller.x1),
        float(request.origin_y if request.origin_y is not None else controller.y1),
    )
    if request.cnc_width and request.cnc_height:
        span = (float(request.cnc_width), float(request.cnc_height))
    else:
        span = (
            max(1.0, controller.MAX_COL * controller.spach_x),
            max(1.0, controller.MAX_ROW * controller.spach_y),
        )
    cnc_x, cnc_y = ai_detector_service._map_to_cnc(
        request.pixel_x, request.pixel_y, origin, span, request.work_area
    )
    return {
        "cnc_x": round(cnc_x + request.camera_offset_x, 1),
        "cnc_y": round(cnc_y + request.camera_offset_y, 1),
    }


@router.get("/openai-status")
def get_openai_status():
    import os
    from pathlib import Path
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    configured = bool(key and len(key) > 10)
    masked = f"{key[:8]}...{key[-4:]}" if configured else ""
    return {
        "configured": configured,
        "masked_key": masked,
        "model_options": [
            {"id": "gpt4o", "name": "OpenAI GPT-4o (High Precision Vision)"},
            {"id": "gpt4o-mini", "name": "OpenAI GPT-4o-mini (Fast & Cheap)"},
            {"id": "opencv", "name": "OpenCV Contours & Shapes (Offline 0ms)"},
            {"id": "yolo", "name": "YOLO Custom Model (Offline - phone.pt)"},
        ],
    }


@router.post("/openai-key")
def set_openai_key(request: OpenAiKeyRequest):
    import os
    from pathlib import Path
    from openai import OpenAI

    new_key = request.api_key.strip()
    if not new_key:
        raise HTTPException(status_code=400, detail="API Key không được để trống")

    # Validate key by making a test call
    try:
        client = OpenAI(api_key=new_key)
        client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=3,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"API Key không hợp lệ: {exc}") from exc

    # Write key to backend/.env
    env_path = Path(__file__).resolve().parents[1] / ".env"
    try:
        existing_lines = []
        if env_path.exists():
            existing_lines = env_path.read_text(encoding="utf-8").splitlines()

        new_lines = []
        key_written = False
        for line in existing_lines:
            if line.strip().startswith("OPENAI_API_KEY="):
                new_lines.append(f'OPENAI_API_KEY="{new_key}"')
                key_written = True
            else:
                new_lines.append(line)
        if not key_written:
            new_lines.append(f'OPENAI_API_KEY="{new_key}"')

        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        os.environ["OPENAI_API_KEY"] = new_key
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể ghi file .env: {exc}") from exc

    return {"status": "success", "message": "API Key đã được cập nhật và kiểm tra thành công!"}



@router.post("/calibrate-cnc-mapping")
def calibrate_cnc_mapping(request: CalibrateCncMappingRequest):
    try:
        matrix = camera_calibration_store.set_cnc_mapping(request.camera_points, request.cnc_points)
        return {
            "status": "success",
            "message": "Physical CNC mapping calibrated successfully",
            "matrix": matrix.tolist() if matrix is not None else None,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/calibrate-work-area")
def calibrate_work_area(request: CalibrationRequest):
    try:
        pts = [[float(p.x), float(p.y)] for p in request.points]
        camera_calibration_store.set_from_points(pts, output_size=(request.output_width, request.output_height))
        warped_b64 = None
        image = decode_image_data(request.image_data)
        if image is not None:
            warped = camera_calibration_store.warp_frame(image)
            if warped is not None:
                warped_b64 = encode_image_to_base64(warped)
        return {
            "status": "success",
            "message": "Work area calibrated successfully",
            "corners": pts,
            "warped_preview": warped_b64,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/calibration/reset")
def reset_calibration():
    camera_calibration_store.clear()
    return {"status": "success", "message": "Calibration reset successfully"}


@router.post("/auto-detect-quad")
def auto_detect_quad(payload: dict):
    image_data = payload.get("image_data", "")
    image = decode_image_data(image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    corners = auto_detect_quadrilateral(image)
    if not corners:
        return {"success": False, "message": "Could not auto-detect a rectangular frame"}
    return {"success": True, "corners": corners}


@router.post("/calibration")
def set_calibration(payload: dict):
    points = payload.get("points", [])
    if len(points) == 4:
        camera_calibration_store.set_from_points(points)
    return {"status": "success", "message": "Calibration points updated"}


@router.post("/warp-preview")
def warp_preview(payload: dict):
    image_data = payload.get("image_data", "")
    image = decode_image_data(image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    warped = camera_calibration_store.warp_frame(image)
    if warped is None:
        return {"success": False, "warped_preview": None}
    b64 = encode_image_to_base64(warped)
    return {"success": True, "warped_preview": b64}


