from fastapi import APIRouter, Depends, HTTPException

from schemas import ConfigRequest, OrientationRequest
from services.cnc_service import CNCService, get_service


router = APIRouter(prefix="/api/keypad", tags=["Keypad"])


@router.post("/config")
def set_config(req: ConfigRequest, service: CNCService = Depends(get_service)):
    service.controller.set_config(req.x1, req.y1, req.spach_x, req.spach_y)
    return {"status": "success", "message": "Configuration updated and origin set"}


@router.post("/orientation")
def set_orientation(req: OrientationRequest, service: CNCService = Depends(get_service)):
    try:
        service.controller.set_orientation(req.orientation)
        return {
            "status": "success",
            "message": f"Orientation set to {req.orientation}°",
            "orientation": service.controller.orientation,
            "layout": service.controller.KEY_LAYOUT,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/orientation")
def get_orientation(service: CNCService = Depends(get_service)):
    return {
        "orientation": service.controller.orientation,
        "layout": service.controller.KEY_LAYOUT,
    }