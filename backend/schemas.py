from typing import Optional

from pydantic import BaseModel


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
    a_steps: Optional[int] = None


class AStepsRequest(BaseModel):
    steps: int


class OrientationRequest(BaseModel):
    orientation: int


class SpeedRequest(BaseModel):
    speed: int
    delay_between_keys: Optional[int] = None


class CaptureRequest(BaseModel):
    device_index: int = 0
    attempts: int = 5
    retry_delay: float = 1.0


class OcrCheckRequest(BaseModel):
    pattern: str
    device_index: int = 0
    capture_attempts: int = 5
    capture_retry_delay: float = 1.0
    ocr_attempts: int = 5
    ocr_retry_delay: float = 1.0


class ImageOcrRequest(BaseModel):
    image_data: str
    pattern: str


class OcrEngineRequest(BaseModel):
    engine: str