from fastapi import APIRouter, Depends, HTTPException

from schemas import (
    AiDetectRequest,
    AutoDetectQuadRequest,
    CalibrationRequest,
    CaptureRequest,
    ComputeMotionMatrixRequest,
    GridClickRequest,
    GridDetectRequest,
    ImageOcrRequest,
    MeasureFrameStepsRequest,
    OcrCheckRequest,
    OcrEngineRequest,
    RedPenDetectRequest,
)
from services.ai_detector import ai_detector_service
from services.cnc_service import CNCService, get_service
from services.vision_service import (
    FixedGridDetector,
    auto_detect_quadrilateral,
    calculate_steps_per_pixel,
    camera_calibration_store,
    compute_motion_matrix,
    decode_image_data,
    encode_image_to_base64,
    find_red_pen_center,
    measure_quadrilateral_steps,
    pixel_displacement_to_steps,
    warp_perspective_region,
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


def _detect_fixed_grid_impl(request: GridDetectRequest):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    detector = FixedGridDetector()
    result = detector.detect_grid_from_frame(
        image,
        rows=request.rows,
        cols=request.cols,
        work_area=request.work_area,
    )
    return {
        "success": result["work_area_detected"],
        "work_area_detected": result["work_area_detected"],
        "message": result.get("message"),
        "cells": result.get("cells", []),
        "work_area": result.get("work_area"),
    }


@router.post("/detect-fixed-grid")
@router.post("/detect-grid")
def detect_fixed_grid(request: GridDetectRequest):
    return _detect_fixed_grid_impl(request)


def _click_fixed_grid_impl(request: GridClickRequest, service: CNCService):
    if request.row < 0 or request.col < 0:
        raise HTTPException(status_code=400, detail="Row and col must be >= 0")
    if request.row >= request.rows or request.col >= request.cols:
        raise HTTPException(status_code=400, detail="Row/col index is outside the grid")

    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    detector = FixedGridDetector()
    result = detector.detect_grid_from_frame(image, rows=request.rows, cols=request.cols)
    if not result["work_area_detected"]:
        raise HTTPException(status_code=400, detail="Unable to detect the fixed work area from the image")

    cell = next((item for item in result["cells"] if item["row"] == request.row and item["col"] == request.col), None)
    if cell is None:
        raise HTTPException(status_code=400, detail="Requested cell does not exist in the detected grid")

    controller = service.controller
    work_area = request.work_area if request.work_area else (result.get("work_area") or [])

    if len(work_area) >= 4:
        target_x, target_y = controller.cell_to_cnc_point(
            request.row,
            request.col,
            rows=request.rows,
            cols=request.cols,
            work_area=work_area,
        )
        target_x += request.camera_offset_x
        target_y += request.camera_offset_y
    elif camera_calibration_store.has_matrix():
        rectified_x, rectified_y = camera_calibration_store.rectified_point_for_image(cell["center_x"], cell["center_y"])
        output_w, output_h = camera_calibration_store.output_size
        x_span = max(1, (request.cols - 1) * controller.spach_x)
        y_span = max(1, (request.rows - 1) * controller.spach_y)
        norm_x = rectified_x / max(1, output_w - 1)
        norm_y = rectified_y / max(1, output_h - 1)
        target_x = controller.x1 + norm_x * x_span * request.camera_scale_x + request.camera_offset_x
        target_y = controller.y1 + norm_y * y_span * request.camera_scale_y + request.camera_offset_y
    else:
        target_x = controller.x1 + request.col * controller.spach_x * request.camera_scale_x + request.camera_offset_x
        target_y = controller.y1 + request.row * controller.spach_y * request.camera_scale_y + request.camera_offset_y

    delta_x = round(target_x - controller.current_x)
    delta_y = round(target_y - controller.current_y)

    if delta_x != 0:
        controller.move_manual('X', delta_x)
    if delta_y != 0:
        controller.move_manual('YZ', delta_y)

    controller.press_and_return_a()

    return {
        "success": True,
        "row": request.row,
        "col": request.col,
        "cell": cell,
        "target_x": round(target_x, 2),
        "target_y": round(target_y, 2),
        "camera_offset_x": request.camera_offset_x,
        "camera_offset_y": request.camera_offset_y,
        "camera_scale_x": request.camera_scale_x,
        "camera_scale_y": request.camera_scale_y,
    }


@router.post("/calibrate-work-area")
def calibrate_work_area(request: CalibrationRequest):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    if len(request.points) != 4:
        raise HTTPException(status_code=400, detail="Calibration requires 4 corner points")

    points = [(point.x, point.y) for point in request.points]
    camera_calibration_store.set_from_points(points, output_size=(request.output_width, request.output_height))
    return {
        "success": True,
        "points": points,
        "output_size": [request.output_width, request.output_height],
    }


@router.post("/calibration/reset")
def reset_calibration():
    camera_calibration_store.clear()
    return {"success": True, "message": "Calibration reset"}


@router.post("/click-fixed-grid")
@router.post("/click-grid")
def click_fixed_grid(request: GridClickRequest, service: CNCService = Depends(get_service)):
    return _click_fixed_grid_impl(request, service)


@router.post("/auto-detect-quad")
def auto_detect_quad(request: AutoDetectQuadRequest):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    corners = auto_detect_quadrilateral(image)
    if not corners:
        corners = ai_detector_service.detect_workspace_corners(image)

    if not corners:
        return {"success": False, "message": "No distinct 4-corner frame detected. Try manual selection.", "corners": []}

    return {
        "success": True,
        "message": "Quadrilateral detected successfully",
        "corners": corners,
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

    key1_ref = None
    if request.key1_x is not None and request.key1_y is not None:
        key1_ref = (float(request.key1_x), float(request.key1_y))

    key_spacing = None
    if request.spacing_x is not None and request.spacing_y is not None:
        key_spacing = (float(request.spacing_x), float(request.spacing_y))

    result = ai_detector_service.detect_in_region(
        frame=image,
        work_area=request.work_area,
        prompt=request.prompt,
        model_type=request.model_type,
        cnc_origin=origin,
        cnc_span=span,
        camera_offset=(request.camera_offset_x, request.camera_offset_y),
        invert_x=request.invert_x,
        invert_y=request.invert_y,
        swap_xy=request.swap_xy,
        key1_ref=key1_ref,
        key_spacing=key_spacing,
    )
    return result


@router.post("/warp-preview")
def warp_preview(request: AutoDetectQuadRequest):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    if not camera_calibration_store.has_matrix():
        raise HTTPException(status_code=400, detail="No active calibration points set")

    warped = camera_calibration_store.warp_frame(image)
    if warped is None:
        raise HTTPException(status_code=400, detail="Unable to warp image")

    return {
        "success": True,
        "warped_preview": encode_image_to_base64(warped),
    }


@router.post("/detect-red-pen")
def detect_red_pen(request: RedPenDetectRequest):
    image = decode_image_data(request.image_data)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    pen_info = find_red_pen_center(image, min_area=request.min_area)
    if pen_info is None:
        return {
            "success": False,
            "message": "Không tìm thấy cây bút đỏ trong khung hình. Hãy kiểm tra ánh sáng hoặc đưa bút vào vùng quan sát.",
            "pen": None,
        }

    return {
        "success": True,
        "message": "Đã nhận diện vị trí cây bút đỏ thành công",
        "pen": pen_info,
    }


@router.post("/compute-motion-matrix")
def api_compute_motion_matrix(request: ComputeMotionMatrixRequest):
    try:
        matrix_result = compute_motion_matrix(
            vec_x=request.vec_x,
            steps_x=request.steps_x,
            vec_y=request.vec_y,
            steps_y=request.steps_y,
        )
        return {
            "success": True,
            "motion_matrix": matrix_result["M"],
            "motion_matrix_inv": matrix_result["M_inv"],
            "det": matrix_result["det"],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/measure-frame-steps")
def measure_frame_steps(request: MeasureFrameStepsRequest):
    corners = request.corners
    if not corners or len(corners) != 4:
        if not request.image_data:
            raise HTTPException(status_code=400, detail="Either corners or image_data must be provided")
        image = decode_image_data(request.image_data)
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        corners = auto_detect_quadrilateral(image)
        if not corners or len(corners) != 4:
            raise HTTPException(status_code=400, detail="Unable to auto-detect a 4-point frame from image")

    try:
        measurement = measure_quadrilateral_steps(
            corners,
            steps_per_pixel_x=request.steps_per_pixel_x or 5.0,
            steps_per_pixel_y=request.steps_per_pixel_y or 5.0,
            motion_matrix_inv=request.motion_matrix_inv,
        )
        return {
            "success": True,
            "measurement": measurement,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc



