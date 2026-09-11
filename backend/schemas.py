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


class GridDetectRequest(BaseModel):
    image_data: str
    rows: int = 3
    cols: int = 3
    work_area: Optional[list[list[float]]] = None


class GridClickRequest(BaseModel):
    image_data: str
    row: int
    col: int
    rows: int = 3
    cols: int = 3
    camera_offset_x: float = 0.0
    camera_offset_y: float = 0.0
    camera_scale_x: float = 1.0
    camera_scale_y: float = 1.0
    work_area: Optional[list[list[float]]] = None


class CalibrationPoint(BaseModel):
    x: float
    y: float


class CalibrationRequest(BaseModel):
    image_data: str
    points: list[CalibrationPoint]
    output_width: int = 1000
    output_height: int = 1000
    cnc_corners: Optional[list[list[float]]] = None


class ImagePointRequest(BaseModel):
    image_x: float
    image_y: float
    image_width: Optional[float] = None
    image_height: Optional[float] = None
    work_area: Optional[list[list[float]]] = None
    cnc_corners: Optional[list[list[float]]] = None
    camera_offset_x: float = 0.0
    camera_offset_y: float = 0.0
    press_a: bool = False
    cnc_width: Optional[float] = None
    cnc_height: Optional[float] = None
    invert_x: bool = False
    invert_y: bool = False
    swap_xy: bool = False


class MoveToCncRequest(BaseModel):
    target_x: float
    target_y: float
    press_a: bool = False
    press_steps: Optional[int] = None


class SetPositionRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0


class AiDetectRequest(BaseModel):
    image_data: str
    work_area: Optional[list[list[float]]] = None
    cnc_corners: Optional[list[list[float]]] = None
    model_config = {'protected_namespaces': ()}  # thêm dòng này

    prompt: str = "all buttons, keys, or targets"
    model_type: str = "gpt4o"  # "gpt4o" or "opencv"
    origin_x: Optional[float] = 0.0
    origin_y: Optional[float] = 0.0
    camera_offset_x: float = 0.0
    camera_offset_y: float = 0.0
    cnc_width: Optional[float] = None
    cnc_height: Optional[float] = None
    invert_x: bool = False
    invert_y: bool = False
    swap_xy: bool = False
    key1_x: Optional[float] = 50.0
    key1_y: Optional[float] = -170.0
    spacing_x: Optional[float] = 100.0
    spacing_y: Optional[float] = -100.0


class AutoDetectQuadRequest(BaseModel):
    image_data: str


class OcrEngineRequest(BaseModel):
    engine: str


class RedPenDetectRequest(BaseModel):
    image_data: str
    min_area: float = 20.0


class ComputeMotionMatrixRequest(BaseModel):
    vec_x: list[float]  # [dx_cam, dy_cam] when moving X+
    steps_x: float      # test steps moved along X
    vec_y: list[float]  # [dx_cam, dy_cam] when moving Y+
    steps_y: float      # test steps moved along Y


class MeasureFrameStepsRequest(BaseModel):
    image_data: Optional[str] = None
    corners: Optional[list[list[float]]] = None
    steps_per_pixel_x: Optional[float] = 5.0
    steps_per_pixel_y: Optional[float] = 5.0
    motion_matrix_inv: Optional[list[list[float]]] = None


class MovePenToPixelRequest(BaseModel):
    image_data: Optional[str] = None
    current_pen_x: Optional[float] = None
    current_pen_y: Optional[float] = None
    target_pixel_x: float
    target_pixel_y: float
    steps_per_pixel_x: Optional[float] = 5.0
    steps_per_pixel_y: Optional[float] = 5.0
    motion_matrix_inv: Optional[list[list[float]]] = None
    invert_x: bool = False
    invert_y: bool = False
    swap_xy: bool = False
    press_a: bool = False
    press_steps: Optional[int] = None


