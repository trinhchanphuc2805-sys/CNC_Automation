from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import traceback
from cnc_controller import CNCController

app = FastAPI(title="CNC Control API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cnc = CNCController()

# ------------------------------------------------------------------ #
#  Request models                                                      #
# ------------------------------------------------------------------ #

class ConnectRequest(BaseModel):
    port: str
    baudrate: int = 115200

class ConfigRequest(BaseModel):
    x1: float
    y1: float
    spach_x: float
    spach_y: float

class ManualMoveRequest(BaseModel):
    axis: str
    steps: int

class SequenceRequest(BaseModel):
    sequence: str
    delay_ms: int = 1000
    a_steps: int = None

class AStepsRequest(BaseModel):
    steps: int

class OrientationRequest(BaseModel):
    orientation: int  # 0, 90, 180, 270

class SpeedRequest(BaseModel):
    speed: int           # feedrate / steps per second
    delay_between_keys: int = None  # ms between keys in a sequence

# ------------------------------------------------------------------ #
#  COM endpoints                                                       #
# ------------------------------------------------------------------ #

@app.get("/api/com/ports")
def get_ports():
    try:
        ports = cnc.get_ports()
        return {"ports": ports}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/com/connect")
def connect_com(req: ConnectRequest):
    try:
        cnc.connect(req.port, req.baudrate)
        return {"status": "success", "message": f"Connected to {req.port}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/com/disconnect")
def disconnect_com():
    cnc.disconnect()
    return {"status": "success", "message": "Disconnected"}

@app.get("/api/com/status")
def get_status():
    return {
        "connected": cnc.is_connected(),
        "current_x": cnc.current_x,
        "current_y": cnc.current_y,
        "current_a": cnc.current_a,
        "a_press_steps": cnc.a_press_steps,
        "config": {
            "x1": cnc.x1,
            "y1": cnc.y1,
            "spach_x": cnc.spach_x,
            "spach_y": cnc.spach_y,
        },
        "orientation": cnc.orientation,
        "speed": cnc.speed,
        "delay_between_keys": cnc.delay_between_keys,
    }

# ------------------------------------------------------------------ #
#  Keypad config endpoints                                             #
# ------------------------------------------------------------------ #

@app.post("/api/keypad/config")
def set_config(req: ConfigRequest):
    cnc.set_config(req.x1, req.y1, req.spach_x, req.spach_y)
    return {"status": "success", "message": "Configuration updated and origin set"}

@app.post("/api/keypad/orientation")
def set_orientation(req: OrientationRequest):
    try:
        cnc.set_orientation(req.orientation)
        return {
            "status": "success",
            "message": f"Orientation set to {req.orientation}°",
            "orientation": cnc.orientation,
            "layout": cnc.KEY_LAYOUT,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/keypad/orientation")
def get_orientation():
    return {
        "orientation": cnc.orientation,
        "layout": cnc.KEY_LAYOUT,
    }

# ------------------------------------------------------------------ #
#  Speed endpoints                                                     #
# ------------------------------------------------------------------ #

@app.post("/api/cnc/speed")
def set_speed(req: SpeedRequest):
    try:
        cnc.set_speed(req.speed, req.delay_between_keys)
        return {
            "status": "success",
            "message": "Speed updated",
            "speed": cnc.speed,
            "delay_between_keys": cnc.delay_between_keys,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/cnc/speed")
def get_speed():
    return {
        "speed": cnc.speed,
        "delay_between_keys": cnc.delay_between_keys,
    }

# ------------------------------------------------------------------ #
#  CNC movement endpoints                                              #
# ------------------------------------------------------------------ #

@app.post("/api/cnc/origin")
def set_origin():
    cnc.current_x = cnc.x1
    cnc.current_y = cnc.y1
    return {"status": "success", "message": "Origin set"}

@app.post("/api/cnc/a-origin")
def set_a_origin():
    cnc.set_a_origin()
    return {"status": "success", "message": "A origin set"}

@app.post("/api/cnc/a-steps")
def set_a_steps(req: AStepsRequest):
    try:
        cnc.set_a_press_steps(req.steps)
        return {"status": "success", "a_press_steps": cnc.a_press_steps}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/cnc/move")
def manual_move(req: ManualMoveRequest):
    if not cnc.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        print(f"Moving axis={req.axis}, steps={req.steps}")
        cnc.move_manual(req.axis, req.steps)
        return {"status": "success"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cnc/sequence")
async def run_sequence(req: SequenceRequest):
    if not cnc.is_connected():
        raise HTTPException(status_code=400, detail="Arduino is not connected. Connect a COM port first.")
    try:
        seq = req.sequence.strip()
        if not seq:
            raise HTTPException(status_code=400, detail="Sequence is empty")

        # Use per-request delay_ms if provided, else fall back to server config
        delay = req.delay_ms if req.delay_ms > 0 else cnc.delay_between_keys

        for i, char in enumerate(seq):
            if char in cnc.KEY_LAYOUT:
                success = cnc.move_to_key(char)
                if not success:
                    print(f"Failed to move to {char}")

                cnc.press_and_return_a(req.a_steps)

                if i < len(seq) - 1:
                    await asyncio.sleep(delay / 1000.0)

        return {"status": "success", "message": "Sequence completed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
