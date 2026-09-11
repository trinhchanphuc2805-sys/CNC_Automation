import traceback
 
from fastapi import APIRouter, Depends, HTTPException
 
from schemas import (
    AStepsRequest,
    ImagePointRequest,
    ManualMoveRequest,
    MovePenToPixelRequest,
    MoveToCncRequest,
    SequenceRequest,
    SpeedRequest,
)
from services.cnc_service import CNCService, get_service
from services.vision_service import (
    camera_calibration_store,
    decode_image_data,
    find_red_pen_center,
    pixel_displacement_to_steps,
)
 
 
router = APIRouter(prefix="/api/cnc", tags=["CNC"])
 
 
@router.post("/speed")
def set_speed(req: SpeedRequest, service: CNCService = Depends(get_service)):
    try:
        service.controller.set_speed(req.speed, req.delay_between_keys)
        return {
            "status": "success",
            "message": "Speed updated",
            "speed": service.controller.speed,
            "delay_between_keys": service.controller.delay_between_keys,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
 
 
@router.get("/speed")
def get_speed(service: CNCService = Depends(get_service)):
    return {
        "speed": service.controller.speed,
        "delay_between_keys": service.controller.delay_between_keys,
    }
 
 
@router.post("/origin")
def set_origin(service: CNCService = Depends(get_service)):
    service.controller.current_x = service.controller.x1
    service.controller.current_y = service.controller.y1
    return {
        "status": "success",
        "message": f"Origin set to ({service.controller.x1}, {service.controller.y1})",
        "current_x": service.controller.current_x,
        "current_y": service.controller.current_y,
    }
 
 
@router.post("/zero")
def set_zero(service: CNCService = Depends(get_service)):
    service.controller.current_x = 0
    service.controller.current_y = 0
    return {
        "status": "success",
        "message": "Current position calibrated as Zero (0, 0)",
        "current_x": 0,
        "current_y": 0,
    }
 
 
@router.post("/go-to-origin")
def go_to_origin(service: CNCService = Depends(get_service)):
    if not service.controller.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        service.controller.move_to_coordinate(service.controller.x1, service.controller.y1)
        return {
            "status": "success",
            "message": "Moved to origin (0, 0)",
            "current_x": service.controller.current_x,
            "current_y": service.controller.current_y,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
 
 
@router.post("/a-origin")
def set_a_origin(service: CNCService = Depends(get_service)):
    service.controller.set_a_origin()
    return {"status": "success", "message": "A origin set"}
 
 
@router.post("/a-steps")
def set_a_steps(req: AStepsRequest, service: CNCService = Depends(get_service)):
    try:
        service.controller.set_a_press_steps(req.steps)
        return {"status": "success", "a_press_steps": service.controller.a_press_steps}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
 
 
@router.post("/move")
def manual_move(req: ManualMoveRequest, service: CNCService = Depends(get_service)):
    if not service.controller.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        service.controller.move_manual(req.axis, req.steps)
        return {"status": "success"}
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
 
 
@router.post("/move-to-image-point")
def move_to_image_point(req: ImagePointRequest, service: CNCService = Depends(get_service)):
    if not service.controller.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        work_area = req.work_area or (camera_calibration_store.points if camera_calibration_store.has_matrix() else None)
        target_x, target_y = service.controller.image_to_cnc_point(
            req.image_x,
            req.image_y,
            image_width=req.image_width,
            image_height=req.image_height,
            work_area=work_area,
            cnc_width=req.cnc_width,
            cnc_height=req.cnc_height,
        )
        if req.invert_x and req.cnc_width:
            target_x = req.cnc_width - target_x
        if req.invert_y and req.cnc_height:
            target_y = req.cnc_height - target_y
        if req.swap_xy:
            target_x, target_y = target_y, target_x

        target_x += req.camera_offset_x
        target_y += req.camera_offset_y

        service.controller.move_to_coordinate(target_x, target_y)
        if req.press_a:
            service.controller.press_and_return_a()

        return {
            "status": "success",
            "target": {"x": round(target_x, 2), "y": round(target_y, 2)},
            "current": {"x": service.controller.current_x, "y": service.controller.current_y},
            "pressed_a": req.press_a,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/move-to-cnc-point")
def move_to_cnc_point(req: MoveToCncRequest, service: CNCService = Depends(get_service)):
    if not service.controller.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        service.controller.move_to_coordinate(req.target_x, req.target_y)
        if req.press_a:
            service.controller.press_and_return_a(req.press_steps)
        return {
            "status": "success",
            "target": {"x": round(req.target_x, 2), "y": round(req.target_y, 2)},
            "current": {"x": service.controller.current_x, "y": service.controller.current_y},
            "pressed_a": req.press_a,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
 
 
@router.post("/sequence")
async def run_sequence(req: SequenceRequest, service: CNCService = Depends(get_service)):
    cnc = service.controller
    if not cnc.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        await service.run_sequence(req.sequence, req.delay_ms, req.a_steps)
        return {"status": "success", "message": "Sequence completed"}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/move-pen-to-pixel")
def move_pen_to_pixel(req: MovePenToPixelRequest, service: CNCService = Depends(get_service)):
    cnc = service.controller
    if not cnc.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")

    pen_x = req.current_pen_x
    pen_y = req.current_pen_y

    # If pen coordinates are not explicitly passed, detect from image
    if pen_x is None or pen_y is None:
        if not req.image_data:
            raise HTTPException(status_code=400, detail="Either (current_pen_x, current_pen_y) or image_data must be provided")
        image = decode_image_data(req.image_data)
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        pen_info = find_red_pen_center(image)
        if not pen_info:
            raise HTTPException(status_code=400, detail="Could not detect red pen marker in the frame")
        # Prefer the sharp pen tip coordinates, fallback to center
        pen_x = float(pen_info.get("tip_x", pen_info["center_x"]))
        pen_y = float(pen_info.get("tip_y", pen_info["center_y"]))

    delta_px_x = float(req.target_pixel_x - pen_x)
    delta_px_y = float(req.target_pixel_y - pen_y)

    round_steps_x, round_steps_y = pixel_displacement_to_steps(
        (delta_px_x, delta_px_y),
        motion_matrix_inv=req.motion_matrix_inv,
        steps_per_pixel_x=req.steps_per_pixel_x or 5.0,
        steps_per_pixel_y=req.steps_per_pixel_y or 5.0,
        invert_x=req.invert_x,
        invert_y=req.invert_y,
        swap_xy=req.swap_xy,
    )

    try:
        if round_steps_x != 0:
            cnc.move_manual('X', round_steps_x)
        if round_steps_y != 0:
            cnc.move_manual('YZ', round_steps_y)

        if req.press_a:
            cnc.press_and_return_a(req.press_steps)

        return {
            "status": "success",
            "pen_start": {"x": round(pen_x, 2), "y": round(pen_y, 2)},
            "target_pixel": {"x": round(req.target_pixel_x, 2), "y": round(req.target_pixel_y, 2)},
            "steps_moved": {"x": round_steps_x, "y": round_steps_y},
            "pressed_a": req.press_a,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

 