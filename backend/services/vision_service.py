import base64
import binascii

import cv2
import numpy as np


class FixedGridDetector:
    """Simple fixed-position detector for a known work area without model training."""

    def detect_grid_from_frame(self, frame: np.ndarray, rows: int = 3, cols: int = 3, work_area=None):
        if frame is None:
            return {
                "work_area_detected": False,
                "message": "No frame provided",
                "cells": [],
                "work_area": None,
            }

        if work_area is not None:
            ordered = self._order_work_area(work_area)
            min_x = int(np.min(ordered[:, 0]))
            min_y = int(np.min(ordered[:, 1]))
            max_x = int(np.max(ordered[:, 0]))
            max_y = int(np.max(ordered[:, 1]))
            width = max(1, max_x - min_x + 1)
            height = max(1, max_y - min_y + 1)
            cells = self._build_cells(min_x, min_y, width, height, rows, cols)
            return {
                "work_area_detected": True,
                "message": "Manual work area used for grid generation",
                "cells": cells,
                "work_area": [[int(v[0]), int(v[1])] for v in ordered],
            }

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, thresh = cv2.threshold(blur, 200, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        work_rect = None
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 5000:
                continue
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.04 * peri, True)
            if len(approx) == 4:
                work_rect = approx.reshape(4, 2)
                break

        if work_rect is None:
            height, width = frame.shape[:2]
            x, y, w, h = 0, 0, width, height
            work_rect = np.array([[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1]], dtype=np.float32)
            return {
                "work_area_detected": True,
                "message": "Used full frame as fallback work area",
                "cells": self._build_cells(x, y, w, h, rows, cols),
                "work_area": [[int(v[0]), int(v[1])] for v in work_rect],
            }

        min_x = int(work_rect[:, 0].min())
        min_y = int(work_rect[:, 1].min())
        max_x = int(work_rect[:, 0].max())
        max_y = int(work_rect[:, 1].max())

        cells = self._build_cells(min_x, min_y, max_x - min_x + 1, max_y - min_y + 1, rows, cols)
        return {
            "work_area_detected": True,
            "message": "Work area detected successfully",
            "cells": cells,
            "work_area": [[int(v[0]), int(v[1])] for v in work_rect],
        }

    def _order_work_area(self, work_area):
        points = np.asarray(work_area, dtype=np.float32)
        if points.shape != (4, 2):
            raise ValueError("work_area must contain exactly 4 points")

        x_sorted = sorted(points.tolist(), key=lambda p: p[0])
        left = x_sorted[:2]
        right = x_sorted[2:]
        top_left = min(left, key=lambda p: p[1])
        bottom_left = max(left, key=lambda p: p[1])
        top_right = min(right, key=lambda p: p[1])
        bottom_right = max(right, key=lambda p: p[1])
        return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)

    def _build_cells(self, x: int, y: int, w: int, h: int, rows: int, cols: int):
        if rows <= 0 or cols <= 0:
            raise ValueError("Rows and cols must be greater than zero")

        cell_w = w / cols
        cell_h = h / rows
        cells = []

        for row in range(rows):
            for col in range(cols):
                cell_x = x + col * cell_w
                cell_y = y + row * cell_h
                cx = cell_x + cell_w / 2
                cy = cell_y + cell_h / 2
                cells.append({
                    "row": row,
                    "col": col,
                    "center_x": int(round(cx)),
                    "center_y": int(round(cy)),
                    "bbox": [
                        int(round(cell_x)),
                        int(round(cell_y)),
                        int(round(cell_w)),
                        int(round(cell_h)),
                    ],
                })

        return cells


def order_corners(points) -> np.ndarray:
    """Order 4 points in sequence: Top-Left, Top-Right, Bottom-Right, Bottom-Left."""
    points = np.asarray(points, dtype=np.float32)
    if points.shape != (4, 2):
        raise ValueError("Must provide exactly 4 points for quad ordering")

    # Sum and difference method or sorted x/y
    x_sorted = sorted(points.tolist(), key=lambda p: p[0])
    left = x_sorted[:2]
    right = x_sorted[2:]
    top_left = min(left, key=lambda p: p[1])
    bottom_left = max(left, key=lambda p: p[1])
    top_right = min(right, key=lambda p: p[1])
    bottom_right = max(right, key=lambda p: p[1])
    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)


def auto_detect_quadrilateral(frame: np.ndarray) -> list[list[float]] | None:
    """
    Detect the 4 corners of the wooden CNC workbed (vùng vân gỗ).
    Accurately isolates the wood surface by color segmentation (R > G > B, wood warm tones)
    and extracts the 4 corners bounded by the left rail and right blue wall.
    """
    if frame is None:
        return None
    h, w = frame.shape[:2]

    # 1. Segment wood grain color (warm brown/reddish tone: R > G > B)
    b, g, r = cv2.split(frame)
    is_wood = ((r.astype(int) - b.astype(int) > 20) & (r > g) & (g > b) & (r > 60) & (b < 140))
    # Exclude upper 25% (background ceiling / person) and far right blue wall
    is_wood[:int(h * 0.25), :] = False
    is_wood[:, int(w * 0.88):] = False

    central_wood = is_wood[:, int(w * 0.15):int(w * 0.65)]
    row_counts = np.sum(central_wood, axis=1)
    threshold_count = int(central_wood.shape[1] * 0.15)
    top_candidates = np.where(row_counts > threshold_count)[0]

    if len(top_candidates) > 0:
        y_top = float(top_candidates[0])
        y_top = max(float(round(h * 0.28, 1)), min(float(round(h * 0.36, 1)), y_top))
    else:
        y_top = float(round(h * 0.316, 1))

    y_bot = float(h - 1)

    # Sample rows near top (y_top to y_top + 45) and near bottom (y_bot - 50 to y_bot)
    sample_top_rows = is_wood[int(y_top):int(min(h, y_top + 45)), :]
    top_cols = np.where(sample_top_rows)[1]
    if len(top_cols) > 20:
        x_tl = float(np.percentile(top_cols, 2))
        x_tr = float(np.percentile(top_cols, 98))
    else:
        x_tl = float(round(w * 0.094, 1))
        x_tr = float(round(w * 0.708, 1))

    sample_bot_rows = is_wood[int(max(0, y_bot - 50)):int(y_bot), :]
    bot_cols = np.where(sample_bot_rows)[1]
    if len(bot_cols) > 20:
        x_bl = float(np.percentile(bot_cols, 2))
        x_br = float(np.percentile(bot_cols, 98))
    else:
        x_bl = float(round(w * 0.016, 1))
        x_br = float(round(w * 0.818, 1))

    # Clamp to boundaries
    x_tl = max(0.0, min(float(w * 0.20), x_tl))
    x_tr = max(float(w * 0.60), min(float(w * 0.80), x_tr))
    x_bl = max(0.0, min(float(w * 0.10), x_bl))
    x_br = max(float(w * 0.75), min(float(w * 0.90), x_br))

    corners = [
        [float(round(x_tl, 1)), float(round(y_top, 1))],
        [float(round(x_tr, 1)), float(round(y_top, 1))],
        [float(round(x_br, 1)), float(round(y_bot, 1))],
        [float(round(x_bl, 1)), float(round(y_bot, 1))],
    ]
    ordered = order_corners(corners)
    return [[float(p[0]), float(p[1])] for p in ordered]


def warp_perspective_region(frame: np.ndarray, corners, output_size=(800, 800)) -> tuple[np.ndarray, np.ndarray]:
    """Warp quadrilateral region defined by 4 corners into rectified top-down rectangle."""
    ordered = order_corners(corners)
    w, h = output_size
    dst = np.array([
        [0, 0],
        [w - 1, 0],
        [w - 1, h - 1],
        [0, h - 1],
    ], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(frame, matrix, (w, h))
    return warped, matrix


class CameraCalibrationStore:
    def __init__(self, output_size=(1000, 1000)):
        self.output_size = tuple(output_size)
        self.matrix = None
        self.points = []
        self.cnc_bounds = None  # (x1, y1, width, height)

    def _order_corners(self, points):
        return order_corners(points)

    def set_from_points(self, points, output_size=None, cnc_bounds=None):
        if output_size is not None:
            self.output_size = tuple(output_size)
        if cnc_bounds is not None:
            self.cnc_bounds = cnc_bounds

        ordered = self._order_corners(points)
        dst = np.array([
            [0, 0],
            [self.output_size[0] - 1, 0],
            [self.output_size[0] - 1, self.output_size[1] - 1],
            [0, self.output_size[1] - 1],
        ], dtype=np.float32)
        self.points = ordered.tolist()
        self.matrix = cv2.getPerspectiveTransform(ordered, dst)
        return self.matrix

    def clear(self):
        self.matrix = None
        self.points = []
        self.cnc_bounds = None

    def has_matrix(self):
        return self.matrix is not None and len(self.points) == 4

    def transform_point(self, x, y):
        if self.matrix is None:
            return (float(x), float(y))
        point = np.array([[[float(x), float(y)]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, self.matrix)
        return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])

    def rectified_cell_center(self, row, col, rows, cols):
        w, h = self.output_size
        cx = ((col + 0.5) * w) / cols
        cy = ((row + 0.5) * h) / rows
        return cx, cy

    def rectified_point_for_image(self, x, y):
        return self.transform_point(x, y)

    def image_point_to_cnc(self, x: float, y: float, x1: float, y1: float, span_x: float, span_y: float, work_area=None):
        """Map camera image pixel (x, y) to physical CNC coordinates (cnc_x, cnc_y)."""
        pts = work_area if work_area is not None else self.points
        if not pts or len(pts) != 4:
            # Fallback to direct offset
            return float(x1 + x), float(y1 + y)

        ordered = order_corners(pts)
        target_rect = np.array([
            [x1, y1],
            [x1 + span_x, y1],
            [x1 + span_x, y1 + span_y],
            [x1, y1 + span_y],
        ], dtype=np.float32)

        homography = cv2.getPerspectiveTransform(ordered, target_rect)
        pt = np.array([[[float(x), float(y)]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(pt, homography)
        return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])

    def warp_frame(self, frame: np.ndarray, output_size=None) -> np.ndarray | None:
        if not self.has_matrix() or frame is None:
            return None
        sz = output_size or self.output_size
        warped, _ = warp_perspective_region(frame, self.points, sz)
        return warped


camera_calibration_store = CameraCalibrationStore()


def decode_image_data(image_data: str) -> np.ndarray | None:
    if not image_data:
        return None
    try:
        encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
        image_bytes = base64.b64decode(encoded, validate=True)
        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        return image
    except (ValueError, binascii.Error, cv2.error):
        return None


def encode_image_to_base64(image: np.ndarray, quality: int = 85) -> str:
    if image is None:
        return ""
    success, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not success:
        return ""
    b64_str = base64.b64encode(buffer).decode("utf-8")
    return f"data:image/jpeg;base64,{b64_str}"


def find_red_pen_center(frame: np.ndarray, min_area: float = 20.0) -> dict | None:
    """
    Find the pixel position (center and sharp tip) of a red pen / stylus marker.
    Uses strict pure-red HSV bounds and RGB color contrast to filter out reddish/brown wood grain,
    and applies vertical slender shape scoring since the pen hangs from the CNC carriage.
    """
    if frame is None:
        return None

    b = frame[:, :, 0].astype(int)
    g = frame[:, :, 1].astype(int)
    r = frame[:, :, 2].astype(int)

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h = hsv[:, :, 0]
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    # Pure Red hue wraps around 0 and 180 (strictly cap hue <= 7 to eliminate orange-brown wood grain)
    mask_hsv = (((h <= 7) | (h >= 173)) & (s >= 105) & (v >= 65)).astype(np.uint8) * 255

    # Color contrast: Red must strictly dominate Green and Blue (wood grain has high Green)
    mask_rgb = ((r - g >= 25) & (r - b >= 20)).astype(np.uint8) * 255

    mask = cv2.bitwise_and(mask_hsv, mask_rgb)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    valid_contours = [c for c in contours if cv2.contourArea(c) >= min_area]
    if not valid_contours:
        return None

    def score_contour(c):
        area = cv2.contourArea(c)
        _, _, bw, bh = cv2.boundingRect(c)
        aspect = float(bh) / max(1, bw)
        # Pen hangs vertically from CNC toolhead, favoring slender vertical aspect ratio
        shape_bonus = 2.0 if aspect >= 1.25 else 1.0
        return area * shape_bonus

    best_contour = max(valid_contours, key=score_contour)
    area = cv2.contourArea(best_contour)

    M = cv2.moments(best_contour)
    if M["m00"] == 0:
        return None

    cx = int(round(M["m10"] / M["m00"]))
    cy = int(round(M["m01"] / M["m00"]))
    (_, _), radius = cv2.minEnclosingCircle(best_contour)
    bx, by, bw, bh = cv2.boundingRect(best_contour)

    # Lowest point of the contour corresponds to the active pen tip
    lowest_pt = best_contour[best_contour[:, :, 1].argmax()][0]

    return {
        "center_x": cx,
        "center_y": cy,
        "tip_x": int(lowest_pt[0]),
        "tip_y": int(lowest_pt[1]),
        "area": round(float(area), 2),
        "radius": round(float(radius), 2),
        "bbox": [int(bx), int(by), int(bw), int(bh)],
    }



def calculate_steps_per_pixel(p0: tuple[float, float], p1: tuple[float, float], steps_moved: float) -> dict:
    """Calculate the motor steps per camera pixel ratio from two positions."""
    dx = float(p1[0] - p0[0])
    dy = float(p1[1] - p0[1])
    dist_px = float(np.hypot(dx, dy))
    if dist_px < 1e-4:
        raise ValueError("Displacement in camera pixels is zero or negligible; cannot determine ratio.")

    steps_per_pixel = abs(float(steps_moved)) / dist_px
    return {
        "dx_px": round(dx, 2),
        "dy_px": round(dy, 2),
        "dist_px": round(dist_px, 2),
        "steps_moved": steps_moved,
        "steps_per_pixel": round(steps_per_pixel, 4),
    }


def measure_quadrilateral_steps(
    corners,
    steps_per_pixel_x: float = 5.0,
    steps_per_pixel_y: float = 5.0,
    motion_matrix_inv: list[list[float]] | None = None,
) -> dict:
    """Measure the width and height of a 4-point frame in both pixels and CNC motor steps."""
    ordered = order_corners(corners)
    tl, tr, br, bl = ordered

    top_w = float(np.hypot(tr[0] - tl[0], tr[1] - tl[1]))
    bot_w = float(np.hypot(br[0] - bl[0], br[1] - bl[1]))
    avg_w_px = (top_w + bot_w) / 2.0

    left_h = float(np.hypot(bl[0] - tl[0], bl[1] - tl[1]))
    right_h = float(np.hypot(br[0] - tr[0], br[1] - tr[1]))
    avg_h_px = (left_h + right_h) / 2.0

    if motion_matrix_inv is not None and len(motion_matrix_inv) == 2 and len(motion_matrix_inv[0]) == 2:
        m_inv = np.array(motion_matrix_inv, dtype=np.float64)
        vec_w = np.array([tr[0] - tl[0], tr[1] - tl[1]], dtype=np.float64)
        vec_h = np.array([bl[0] - tl[0], bl[1] - tl[1]], dtype=np.float64)
        steps_w = m_inv @ vec_w
        steps_h = m_inv @ vec_h
        width_steps = int(round(np.hypot(steps_w[0], steps_w[1])))
        height_steps = int(round(np.hypot(steps_h[0], steps_h[1])))
        spx = round(float(width_steps / max(1.0, avg_w_px)), 4)
        spy = round(float(height_steps / max(1.0, avg_h_px)), 4)
    else:
        if steps_per_pixel_x <= 0 or steps_per_pixel_y <= 0:
            raise ValueError("steps_per_pixel must be positive numbers")
        width_steps = int(round(avg_w_px * steps_per_pixel_x))
        height_steps = int(round(avg_h_px * steps_per_pixel_y))
        spx = round(float(steps_per_pixel_x), 4)
        spy = round(float(steps_per_pixel_y), 4)

    return {
        "ordered_corners": [[float(p[0]), float(p[1])] for p in ordered],
        "width_px": round(avg_w_px, 2),
        "height_px": round(avg_h_px, 2),
        "width_steps": width_steps,
        "height_steps": height_steps,
        "steps_per_pixel_x": spx,
        "steps_per_pixel_y": spy,
    }


def compute_motion_matrix(
    vec_x: tuple[float, float] | list[float],
    steps_x: float,
    vec_y: tuple[float, float] | list[float],
    steps_y: float,
) -> dict:
    """
    Computes forward matrix M and inverse matrix M_inv connecting
    motor steps [steps_x, steps_y]^T to camera pixel displacement [dx_cam, dy_cam]^T:
    [dx_cam, dy_cam]^T = M * [steps_x, steps_y]^T
    """
    if abs(steps_x) < 1e-4 or abs(steps_y) < 1e-4:
        raise ValueError("steps_x and steps_y must be non-zero")

    col_x = [float(vec_x[0]) / float(steps_x), float(vec_x[1]) / float(steps_x)]
    col_y = [float(vec_y[0]) / float(steps_y), float(vec_y[1]) / float(steps_y)]

    M = np.array([
        [col_x[0], col_y[0]],
        [col_x[1], col_y[1]],
    ], dtype=np.float64)

    det = float(np.linalg.det(M))
    if abs(det) < 1e-9:
        raise ValueError("Motion vectors on camera are linearly dependent; check camera movement.")

    M_inv = np.linalg.inv(M)
    return {
        "M": [[round(float(v), 6) for v in row] for row in M],
        "M_inv": [[round(float(v), 6) for v in row] for row in M_inv],
        "det": round(det, 6),
    }


def pixel_displacement_to_steps(
    delta_pixel: tuple[float, float],
    motion_matrix_inv: list[list[float]] | None = None,
    steps_per_pixel_x: float = 5.0,
    steps_per_pixel_y: float = 5.0,
    invert_x: bool = False,
    invert_y: bool = False,
    swap_xy: bool = False,
) -> tuple[int, int]:
    """Convert camera pixel displacement (dx_cam, dy_cam) into exact motor steps."""
    dx, dy = float(delta_pixel[0]), float(delta_pixel[1])

    if motion_matrix_inv is not None and len(motion_matrix_inv) == 2 and len(motion_matrix_inv[0]) == 2:
        m_inv = np.array(motion_matrix_inv, dtype=np.float64)
        disp = np.array([dx, dy], dtype=np.float64)
        steps = m_inv @ disp
        return int(round(steps[0])), int(round(steps[1]))

    sx = dx * steps_per_pixel_x
    sy = dy * steps_per_pixel_y
    if swap_xy:
        sx, sy = sy, sx
    if invert_x:
        sx = -sx
    if invert_y:
        sy = -sy
    return int(round(sx)), int(round(sy))



