import serial
import serial.tools.list_ports
import time

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
        return [{"device": p.device, "description": p.description} for p in ports]

    def connect(self, port_name: str, baudrate: int = 115200):
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()

        self.serial_port = None
        try:
            self.serial_port = serial.Serial(
                port=port_name,
                baudrate=baudrate,
                timeout=1,
                write_timeout=1,
            )
        except serial.SerialException as exc:
            self.serial_port = None
            raise serial.SerialException(
                f"Unable to open {port_name}. Check the cable/CH340 driver, "
                f"close Arduino IDE or Serial Monitor if it is using this port, "
                f"then try again. Details: {exc}"
            ) from exc

        time.sleep(2)  # Wait for Arduino to reset
        return True

    def disconnect(self):
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()
            self.serial_port = None
        return True

    def is_connected(self):
        return self.serial_port is not None and self.serial_port.is_open

    def send_command(self, command: str):
        if not self.is_connected():
            raise Exception("Arduino is not connected")
        cmd_str = f"{command}\n"
        self.serial_port.write(cmd_str.encode('utf-8'))
        print(f"Sent: {command}")

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
        elif axis == 'YZ':
            if steps > 0:
                self.send_command(f"F{steps}")
            else:
                self.send_command(f"B{abs(steps)}")
        elif axis == 'A':
            self.send_command(f"A{steps}")
        else:
            raise ValueError(f"Unsupported axis: {axis}")

        if axis == 'A':
            self.current_a += steps

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

    def move_to_key(self, key: str):
        target = self.get_target_position(key)
        if not target:
            return False

        target_x, target_y = target

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
