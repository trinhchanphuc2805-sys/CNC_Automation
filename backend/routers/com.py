from fastapi import APIRouter, Depends, HTTPException

from schemas import ConnectRequest
from services.cnc_service import CNCService, get_service


router = APIRouter(prefix="/api/com", tags=["COM"])


@router.get("/ports")
def get_ports(service: CNCService = Depends(get_service)):
    try:
        return {"ports": service.controller.get_ports()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/connect")
def connect_com(req: ConnectRequest, service: CNCService = Depends(get_service)):
    try:
        service.controller.connect(req.port, req.baudrate)
        return {"status": "success", "message": f"Connected to {req.port}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/disconnect")
def disconnect_com(service: CNCService = Depends(get_service)):
    service.controller.disconnect()
    return {"status": "success", "message": "Disconnected"}


@router.get("/status")
def get_status(service: CNCService = Depends(get_service)):
    return service.get_status()