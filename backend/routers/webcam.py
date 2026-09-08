from fastapi import APIRouter, HTTPException

from schemas import CaptureRequest, ImageOcrRequest, OcrCheckRequest, OcrEngineRequest
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