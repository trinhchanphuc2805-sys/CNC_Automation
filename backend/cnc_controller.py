import serial
import serial.tools.list_ports
import time
import threading

import cv2
import numpy as np


class CNCController:
    # On this machine, negative A steps press the mechanism downward.
    A_PRESS_DIRECTION = -1
 
    # Full standard keypad layout: key -> (col, row)
    # Standard layout (0°):
    #   1 2 3   (row 0)
    #   4 5 6   (row 1)
    #   7 8 9   (row 2)
    #   * 0 #   (row 3)
    BASE_LAYOUT = {
        '1': (0, 0), '2': (1, 0), '3': (2, 0),
        '4': (0, 1), '5': (1, 1), '6': (2, 1),
        '7': (0, 2), '8': (1, 2), '9': (2, 2),
        '*': (0, 3), '0': (1, 3), '#': (2, 3),
    }
    MAX_COL = 2  # 3 columns: 0,1,2
    MAX_ROW = 3  # 4 rows: 0,1,2,3
 
    def __init__(self):
        self._lock = threading.Lock()
        self._last_port = None
        self._last_baudrate = 115200
        self.serial_port = None
        self.current_x = 0
        self.current_y = 0
        self.current_a = 0
        self.a_press_steps = 100
        self.x1 = 0
        self.y1 = 0
        self.spach_x = 100
        self.spach_y = 100
 
        # Orientation: 0, 90, 180, 270 (degrees clockwise)
        self.orientation = 0
 
        # Speed: steps/s sent to Arduino (feedrate)
        self.speed = 1000
 
        # Delay between keystrokes in a sequence (ms)
        self.delay_between_keys = 500
 
        # Computed key layout based on orientation
        self.KEY_LAYOUT = self._compute_layout()
 
    # ------------------------------------------------------------------ #
    #  Orientation helpers                                                 #
    # ------------------------------------------------------------------ #
 
    def _rotate_col_row(self, col, row):
        """
        Rotate a (col, row) grid position by self.orientation degrees CW.
        Returns the new (col, row) in the rotated grid.
        """
        mc = self.MAX_COL
        mr = self.MAX_ROW
        if self.orientation == 0:
            return col, row
        elif self.orientation == 90:
            # CW 90°: new_col = mr - row, new_row = col
            return mr - row, col
        elif self.orientation == 180:
            # 180°: new_col = mc - col, new_row = mr - row
            return mc - col, mr - row
        elif self.orientation == 270:
            # CCW 90° (CW 270°): new_col = row, new_row = mc - col
            return row, mc - col
        return col, row
 
    def _compute_layout(self):
        """Recompute KEY_LAYOUT dict after orientation change."""
        layout = {}
        for key, (col, row) in self.BASE_LAYOUT.items():
            layout[key] = self._rotate_col_row(col, row)
        return layout
 
    def set_orientation(self, orientation: int):
        """Set orientation (0, 90, 180, 270) and recompute layout."""
        if orientation not in (0, 90, 180, 270):
            raise ValueError("Orientation must be 0, 90, 180, or 270")
        self.orientation = orientation
        self.KEY_LAYOUT = self._compute_layout()
 
    def set_speed(self, speed: int, delay_between_keys: int = None):
        """Set feedrate speed and optional delay between keys."""
        if speed < 1:
            raise ValueError("Speed must be >= 1")
        self.speed = speed
        if delay_between_keys is not None:
            if delay_between_keys < 0:
                raise ValueError("Delay must be >= 0")
            self.delay_between_keys = delay_between_keys
 
    # ------------------------------------------------------------------ #
    #  Serial helpers                                                      #
    # ------------------------------------------------------------------ #
 
    def get_ports(self):
        ports = serial.tools.list_ports.comports()
        port_list = [{"device": p.device, "description": p.description} for p in ports]
        # Prioritize USB-Serial CH340 / Arduino devices over motherboard SOL ports
        def _port_priority(p):
            desc = (p.get("description") or "").lower()
            dev = (p.get("device") or "").lower()
            if "ch340" in desc or "arduino" in desc or "ch340" in dev:
                return 0
            if "usb" in desc or "serial" in desc:
                return 1
            if "sol" in desc or "intel" in desc:
                return 9
            return 5
        port_list.sort(key=_port_priority)
        return port_list

    def connect(self, port_name: str, baudrate: int = 115200):
        with self._lock:
            if self.serial_port and self.serial_port.is_open:
                try:
                    self.serial_port.close()
                except Exception:
                    pass

            self.serial_port = None
            self._last_port = port_name
            self._last_baudrate = baudrate
            try:
                self.serial_port = serial.Serial(
                    port=port_name,
                    baudrate=baudrate,
                    timeout=2,
                    write_timeout=None,
                    rtscts=False,
                    dsrdtr=False,
                )
                time.sleep(1.5)  # Wait for Arduino to reset
                try:
                    self.serial_port.reset_input_buffer()
                    self.serial_port.reset_output_buffer()
                except Exception:
                    pass
            except serial.SerialException as exc:
                self.serial_port = None
                raise serial.SerialException(
                    f"Unable to open {port_name}. Check the cable/CH340 driver, "
                    f"close Arduino IDE or Serial Monitor if it is using this port, "
                    f"then try again. Details: {exc}"
                ) from exc

            return True

    def disconnect(self):
        with self._lock:
            if self.serial_port and self.serial_port.is_open:
                try:
                    self.serial_port.close()
                except Exception:
                    pass
                self.serial_port = None
            return True

    def is_connected(self):
        return self.serial_port is not None and self.serial_port.is_open

    def send_command(self, command: str):
        with self._lock:
            if not self.is_connected():
                raise Exception("Arduino is not connected")
            cmd_str = f"{command}\n"
            data = cmd_str.encode('utf-8')
            try:
                self.serial_port.write(data)
                self.serial_port.flush()
                print(f"Sent: {command}")
            except (serial.SerialException, PermissionError, OSError) as exc:
                print(f"Serial write error on {command}: {exc}, attempting reconnect...")
                # Attempt one quick re-connect if port name is known
                if self._last_port:
                    try:
                        if self.serial_port:
                            try:
                                self.serial_port.close()
                            except Exception:
                                pass
                        self.serial_port = serial.Serial(
                            port=self._last_port,
                            baudrate=self._last_baudrate,
                            timeout=2,
                            write_timeout=None,
                            rtscts=False,
                            dsrdtr=False,
                        )
                        time.sleep(1.0)
                        self.serial_port.write(data)
                        self.serial_port.flush()
                        print(f"Sent (after re-connect): {command}")
                        return
                    except Exception as re_err:
                        self.serial_port = None
                        raise Exception(f"Serial port disconnected. Re-connect failed: {re_err}") from re_err
                raise

    # ------------------------------------------------------------------ #
    #  Config                                                              #
    # ------------------------------------------------------------------ #

    def set_config(self, x1, y1, spach_x, spach_y):
        self.x1 = x1
        self.y1 = y1
        self.spach_x = spach_x
        self.spach_y = spach_y
        self.current_x = x1
        self.current_y = y1

    # ------------------------------------------------------------------ #
    #  Movement                                                            #
    # ------------------------------------------------------------------ #

    def move_manual(self, axis: str, steps: int):
        axis = axis.upper()
        if axis == 'X':
            self.send_command(f"X{steps}")
            self.current_x += steps
        elif axis in ('YZ', 'Y', 'Z'):
            if steps > 0:
                self.send_command(f"F{steps}")
            else:
                self.send_command(f"B{abs(steps)}")
            self.current_y += steps
        elif axis == 'A':
            self.send_command(f"A{steps}")
            self.current_a += steps
        else:
            raise ValueError(f"Unsupported axis: {axis}")
 
    def set_a_origin(self):
        self.current_a = 0
 
    def set_a_press_steps(self, steps: int):
        if steps < 1:
            raise ValueError("A press steps must be >= 1")
        self.a_press_steps = steps
 
    def press_and_return_a(self, steps=None):
        press_steps = self.a_press_steps if steps is None else steps
        if press_steps < 1:
            raise ValueError("A press steps must be >= 1")
        press_delta = self.A_PRESS_DIRECTION * press_steps
        self.move_manual('A', press_delta)
        self.move_manual('A', -press_delta)
        self.set_a_origin()
 
    def get_target_position(self, key: str):
        if key not in self.KEY_LAYOUT:
            return None
        col, row = self.KEY_LAYOUT[key]
        target_x = self.x1 + col * self.spach_x
        target_y = self.y1 + row * self.spach_y
        return target_x, target_y
 
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

    def _transform_point(self, point, src_points, dst_points):
        src = np.asarray(src_points, dtype=np.float32)
        dst = np.asarray(dst_points, dtype=np.float32)
        if src.shape != (4, 2) or dst.shape != (4, 2):
            raise ValueError("Source and destination must each contain 4 points")

        matrix = cv2.getPerspectiveTransform(src, dst)
        transformed = cv2.perspectiveTransform(np.array([[[float(point[0]), float(point[1])]]], dtype=np.float32), matrix)
        return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])

    def map_image_point_to_cnc(self, image_x: float, image_y: float, image_width: float = None, image_height: float = None, work_area=None, rows: int = 1, cols: int = 1, cnc_width: float = None, cnc_height: float = None):
        if work_area is not None:
            ordered = self._order_work_area(work_area)
            if cnc_width is not None and cnc_height is not None and cnc_width > 0 and cnc_height > 0:
                x_span = cnc_width
                y_span = cnc_height
            else:
                x_span = max(1.0, (cols - 1) * self.spach_x)
                y_span = max(1.0, (rows - 1) * self.spach_y)
            target_rect = np.array([
                [self.x1, self.y1],
                [self.x1 + x_span, self.y1],
                [self.x1 + x_span, self.y1 + y_span],
                [self.x1, self.y1 + y_span],
            ], dtype=np.float32)
            return self._transform_point((float(image_x), float(image_y)), ordered, target_rect)

        if image_width is None or image_height is None or image_width <= 0 or image_height <= 0:
            raise ValueError("image_width and image_height must be provided when work_area is not used")

        x_span = self.spach_x * max(1, self.MAX_COL)
        y_span = self.spach_y * max(1, self.MAX_ROW)
        target_x = self.x1 + (image_x / image_width) * x_span
        target_y = self.y1 + (image_y / image_height) * y_span
        return round(target_x), round(target_y)

    def cell_to_cnc_point(self, row: int, col: int, rows: int, cols: int, work_area=None):
        if rows <= 0 or cols <= 0:
            raise ValueError("Rows and cols must be greater than zero")

        if work_area is None:
            target_x = self.x1 + col * self.spach_x
            target_y = self.y1 + row * self.spach_y
            return round(target_x), round(target_y)

        ordered = self._order_work_area(work_area)
        min_x = float(np.min(ordered[:, 0]))
        min_y = float(np.min(ordered[:, 1]))
        max_x = float(np.max(ordered[:, 0]))
        max_y = float(np.max(ordered[:, 1]))
        cell_center_x = min_x + ((col + 0.5) / cols) * (max_x - min_x)
        cell_center_y = min_y + ((row + 0.5) / rows) * (max_y - min_y)

        x_span = max(1.0, (cols - 1) * self.spach_x)
        y_span = max(1.0, (rows - 1) * self.spach_y)
        target_rect = np.array([
            [self.x1, self.y1],
            [self.x1 + x_span, self.y1],
            [self.x1 + x_span, self.y1 + y_span],
            [self.x1, self.y1 + y_span],
        ], dtype=np.float32)
        target_x, target_y = self._transform_point((cell_center_x, cell_center_y), ordered, target_rect)
        return round(target_x), round(target_y)

    def image_to_cnc_point(self, image_x: float, image_y: float, image_width: float = None, image_height: float = None, work_area=None, rows: int = None, cols: int = None, cnc_width: float = None, cnc_height: float = None):
        if work_area is not None:
            if rows is None:
                rows = self.MAX_ROW + 1
            if cols is None:
                cols = self.MAX_COL + 1
            return self.map_image_point_to_cnc(image_x, image_y, image_width, image_height, work_area=work_area, rows=rows, cols=cols, cnc_width=cnc_width, cnc_height=cnc_height)

        return self.map_image_point_to_cnc(image_x, image_y, image_width, image_height)
 
    def move_to_coordinate(self, target_x: float, target_y: float):
        delta_x = round(target_x - self.current_x)
        delta_y = round(target_y - self.current_y)
 
        if delta_x != 0:
            self.send_command(f"X{delta_x}")
 
        if delta_y != 0:
            if delta_y > 0:
                self.send_command(f"F{delta_y}")
            else:
                self.send_command(f"B{abs(delta_y)}")
 
        self.current_x = target_x
        self.current_y = target_y
        return True
 
    def move_to_image_point(self, image_x: float, image_y: float, image_width: float, image_height: float):
        target_x, target_y = self.image_to_cnc_point(image_x, image_y, image_width, image_height)
        return self.move_to_coordinate(target_x, target_y)
 
    def move_to_key(self, key: str):
        target = self.get_target_position(key)
        if not target:
            return False
 
        target_x, target_y = target
        return self.move_to_coordinate(target_x, target_y)
 