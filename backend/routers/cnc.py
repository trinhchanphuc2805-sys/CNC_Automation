import traceback

from fastapi import APIRouter, Depends, HTTPException

from schemas import AStepsRequest, ManualMoveRequest, SequenceRequest, SpeedRequest
from services.cnc_service import CNCService, get_service


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
    return {"status": "success", "message": "Origin set"}


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