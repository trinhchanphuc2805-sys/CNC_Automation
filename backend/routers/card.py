import logging
import traceback
from fastapi import APIRouter, Depends, HTTPException

from schemas import (
    CardActionRequest,
    CardConfigRequest,
    CardConnectRequest,
    CardInsertEjectRequest,
    CardNfcAngleRequest,
    CardNfcTapRequest,
    CardRawCommandRequest,
    CardServoRequest,
    CardSwipeReturnRequest,
)
from services.card_service import CardController, get_card_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/card", tags=["Card Servo Controller"])


@router.get("/ports")
def get_card_ports(card: CardController = Depends(get_card_service)):
    try:
        return {"ports": card.get_ports()}
    except Exception as exc:
        logger.exception("Error getting COM ports: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/connect")
def connect_card(req: CardConnectRequest, card: CardController = Depends(get_card_service)):
    try:
        card.connect(req.port, req.baudrate)
        return {"status": "success", "message": f"Connected to ESP32 Card Controller on {req.port}"}
    except Exception as exc:
        logger.exception("Failed to connect to ESP32: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/disconnect")
def disconnect_card(card: CardController = Depends(get_card_service)):
    card.disconnect()
    return {"status": "success", "message": "Disconnected from ESP32 Card Controller"}


@router.get("/status")
def get_card_status(card: CardController = Depends(get_card_service)):
    return card.get_status()


@router.post("/config")
def update_card_config(req: CardConfigRequest, card: CardController = Depends(get_card_service)):
    card.set_config(
        insert_servo=req.insert_servo,
        swipe_servo=req.swipe_servo,
        default_insert_seconds=req.default_insert_seconds,
        default_eject_seconds=req.default_eject_seconds,
        default_swipe_seconds=req.default_swipe_seconds,
    )
    return {"status": "success", "config": card.get_status()}


@router.post("/command")
def send_raw_command(req: CardRawCommandRequest, card: CardController = Depends(get_card_service)):
    try:
        res = card.send_command(req.command)
        return {"status": "success", "message": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/servo12")
def control_servo12(req: CardServoRequest, card: CardController = Depends(get_card_service)):
    try:
        res = card.servo12(req.direction, req.seconds)
        return {"status": "success", "message": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/servo33")
def control_servo33(req: CardServoRequest, card: CardController = Depends(get_card_service)):
    try:
        res = card.servo33(req.direction, req.seconds)
        return {"status": "success", "message": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/insert")
def insert_card(req: CardActionRequest = CardActionRequest(), card: CardController = Depends(get_card_service)):
    try:
        res = card.insert_card(req.seconds)
        return {"status": "success", "message": f"Insert card executed ({req.seconds}s)", "raw": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/eject")
def eject_card(req: CardActionRequest = CardActionRequest(), card: CardController = Depends(get_card_service)):
    try:
        res = card.eject_card(req.seconds)
        return {"status": "success", "message": f"Eject card executed ({req.seconds}s)", "raw": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/insert-and-eject")
async def insert_and_eject(req: CardInsertEjectRequest = CardInsertEjectRequest(), card: CardController = Depends(get_card_service)):
    try:
        res = await card.insert_and_eject(
            insert_seconds=req.insert_seconds,
            hold_seconds=req.hold_seconds or 2.0,
            eject_seconds=req.eject_seconds,
        )
        return res
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/swipe")
def swipe_card(req: CardActionRequest = CardActionRequest(), card: CardController = Depends(get_card_service)):
    try:
        direction = req.direction if req.direction else "l"
        res = card.swipe_card(req.seconds, direction=direction)
        return {"status": "success", "message": f"Swipe card executed ({req.seconds}s, dir: {direction})", "raw": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/swipe-and-return")
async def swipe_and_return(req: CardSwipeReturnRequest = CardSwipeReturnRequest(), card: CardController = Depends(get_card_service)):
    try:
        res = await card.swipe_and_return(
            swipe_seconds=req.swipe_seconds,
            return_seconds=req.return_seconds,
        )
        return res
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/nfc/angle")
def nfc_set_angle(req: CardNfcAngleRequest, card: CardController = Depends(get_card_service)):
    try:
        res = card.nfc_set_angle(req.angle)
        return {"status": "success", "message": f"SG90 set to {req.angle}°", "raw": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/nfc/tap")
def nfc_tap_card(req: CardNfcTapRequest, card: CardController = Depends(get_card_service)):
    try:
        res = card.nfc_tap(req.angle)
        return {"status": "success", "message": f"NFC tap executed at {req.angle}°", "raw": res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
