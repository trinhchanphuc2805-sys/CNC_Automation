import asyncio
import logging
import threading
import time
from typing import Any, Dict, List, Optional

import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)


class CardController:
    """Controller for 2x 360-degree Servos on ESP32:

    - Pin D12: Swipe Card (L: Left / Trái, R: Right / Phải)
    - Pin D33: Insert Card (A: Forward / Tiến - Đút thẻ, B: Backward / Lùi - Rút thẻ)
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.serial_port: Optional[serial.Serial] = None
        self._last_baudrate: int = 115200

        # Hardware mappings & defaults (Updated for latest ESP32 3-servo wiring)
        self.insert_servo = "D18"  # 'D18' (MG996R Insert: Commands l, r)
        self.swipe_servo = "D33"   # 'D33' (MG996R Swipe: Commands a, b)
        self.nfc_servo = "D19"     # 'D19' (SG90 180° Micro Servo: Commands g, n)
        self.default_insert_seconds = 2.0
        self.default_eject_seconds = 2.0
        self.default_swipe_seconds = 2.0

    def get_ports(self) -> List[Dict[str, str]]:
        """List all available serial COM ports with smart priority."""
        ports = serial.tools.list_ports.comports()
        port_list = [{"device": p.device, "description": p.description} for p in ports]

        def _port_priority(p):
            desc = (p.get("description") or "").lower()
            dev = (p.get("device") or "").lower()
            if "esp32" in desc or "cp210" in desc or "ch340" in desc or "usb-serial" in desc:
                return 0
            if "usb" in desc or "serial" in desc:
                return 1
            return 5

        port_list.sort(key=_port_priority)
        return port_list

    def connect(self, port_name: str, baudrate: int = 115200) -> bool:
        """Connect to ESP32 Card Controller serial port."""
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
                    write_timeout=2,
                    rtscts=False,
                    dsrdtr=False,
                )
                time.sleep(1.2)  # Wait for ESP32 boot/reset
                try:
                    self.serial_port.reset_input_buffer()
                    self.serial_port.reset_output_buffer()
                except Exception:
                    pass
                logger.info("Connected to ESP32 Card Controller at %s (%d bps)", port_name, baudrate)
                return True
            except serial.SerialException as exc:
                self.serial_port = None
                raise serial.SerialException(
                    f"Unable to open ESP32 Card Controller on {port_name}. Details: {exc}"
                ) from exc

    def disconnect(self) -> bool:
        """Disconnect from serial port."""
        with self._lock:
            if self.serial_port and self.serial_port.is_open:
                try:
                    self.serial_port.close()
                except Exception:
                    pass
            self.serial_port = None
            return True

    def is_connected(self) -> bool:
        return self.serial_port is not None and self.serial_port.is_open

    def send_command(self, command: str) -> str:
        """Send raw command string (e.g. 'l2', 'r1', 'a3', 'b2') to ESP32."""
        cleaned_cmd = command.strip()
        if not cleaned_cmd:
            raise ValueError("Empty command")

        with self._lock:
            if not self.is_connected():
                raise ConnectionError("ESP32 Card Controller is not connected. Please connect a COM port first.")

            data = f"{cleaned_cmd}\n".encode("utf-8")
            try:
                self.serial_port.write(data)
                self.serial_port.flush()
                logger.info("Sent to Card Controller: %s", cleaned_cmd)
                return f"Command '{cleaned_cmd}' sent successfully"
            except (serial.SerialException, OSError) as exc:
                logger.warning("Serial error writing %s: %s. Attempting auto-reconnect...", cleaned_cmd, exc)
                if self._last_port:
                    try:
                        self.serial_port = serial.Serial(
                            port=self._last_port,
                            baudrate=self._last_baudrate,
                            timeout=2,
                            write_timeout=2,
                        )
                        time.sleep(1.0)
                        self.serial_port.write(data)
                        self.serial_port.flush()
                        return f"Command '{cleaned_cmd}' sent after reconnect"
                    except Exception as re_err:
                        self.serial_port = None
                        raise ConnectionError(f"Serial port connection lost: {re_err}") from re_err
                raise

    # -------------------------------------------------------------
    # Low-level Servo commands matching Arduino sketch
    # -------------------------------------------------------------
    def servo18(self, direction: str, seconds: float = 2.0) -> str:
        """Control D18 Servo (or D12 legacy):

        - direction: 'l' / 'left' (Quay Trái) or 'r' / 'right' (Quay Phải)
        - seconds: duration in seconds (must be > 0)
        """
        dir_clean = direction.lower().strip()
        prefix = 'l' if dir_clean in ('l', 'left', 'trai') else 'r' if dir_clean in ('r', 'right', 'phai') else None
        if not prefix:
            raise ValueError(f"Invalid direction for D18: '{direction}'. Expected 'l' (left) or 'r' (right)")
        sec = max(0.01, float(seconds))
        formatted_sec = f"{sec:g}"
        return self.send_command(f"{prefix}{formatted_sec}")

    # Backward compatibility alias
    servo12 = servo18

    def servo33(self, direction: str, seconds: float = 2.0) -> str:
        """Control D33 Servo:

        - direction: 'a' / 'forward' (Quay Tiến) or 'b' / 'backward' (Quay Lùi)
        - seconds: duration in seconds (must be > 0)
        """
        dir_clean = direction.lower().strip()
        prefix = 'a' if dir_clean in ('a', 'forward', 'tien') else 'b' if dir_clean in ('b', 'backward', 'lui') else None
        if not prefix:
            raise ValueError(f"Invalid direction for D33: '{direction}'. Expected 'a' (forward) or 'b' (backward)")
        sec = max(0.01, float(seconds))
        formatted_sec = f"{sec:g}"
        return self.send_command(f"{prefix}{formatted_sec}")

    # -------------------------------------------------------------
    # High-level Card Option 1: Insert Card (Cắm thẻ)
    # -------------------------------------------------------------
    def insert_card(self, seconds: Optional[float] = None) -> str:
        """Đưa thẻ vào khe đọc (Insert Card).
        Mặc định dùng D18 quay trái ('l') hoặc D33 quay tiến ('a').
        """
        sec = max(0.01, float(seconds if seconds is not None else self.default_insert_seconds))
        if self.insert_servo == "D33":
            return self.servo33('a', sec)
        return self.servo18('l', sec)

    def eject_card(self, seconds: Optional[float] = None) -> str:
        """Rút thẻ ra khỏi khe đọc (Eject Card).
        Mặc định dùng D18 quay phải ('r') hoặc D33 quay lùi ('b').
        """
        sec = max(0.01, float(seconds if seconds is not None else self.default_eject_seconds))
        if self.insert_servo == "D33":
            return self.servo33('b', sec)
        return self.servo18('r', sec)

    async def insert_and_eject(
        self,
        insert_seconds: Optional[float] = None,
        hold_seconds: float = 2.0,
        eject_seconds: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Chu trình hoàn chỉnh: Đưa thẻ vào -> Giữ thẻ X giây -> Rút thẻ ra."""
        ins_sec = max(0.01, float(insert_seconds if insert_seconds is not None else self.default_insert_seconds))
        ej_sec = max(0.01, float(eject_seconds if eject_seconds is not None else self.default_eject_seconds))
        hold_sec = max(0.0, float(hold_seconds))

        self.insert_card(ins_sec)
        # ESP32 sketch delays for `ins_sec` seconds while spinning, so we await execution
        await asyncio.sleep(ins_sec + hold_sec)
        self.eject_card(ej_sec)
        await asyncio.sleep(ej_sec)

        return {
            "status": "success",
            "message": f"Insert & Eject cycle completed (Insert: {ins_sec:g}s, Hold: {hold_sec:g}s, Eject: {ej_sec:g}s)",
        }

    # -------------------------------------------------------------
    # High-level Card Option 2: Swipe Card (Quẹt thẻ)
    # -------------------------------------------------------------
    def swipe_card(self, seconds: Optional[float] = None, direction: str = "a") -> str:
        """Quẹt thẻ từ (Swipe Card).
        Mặc định dùng D33 quay tiến ('a') hoặc lùi ('b'), hoặc D18 ('l'/'r').
        """
        sec = max(0.01, float(seconds if seconds is not None else self.default_swipe_seconds))
        dir_clean = direction.lower().strip()
        if self.swipe_servo == "D18" or self.swipe_servo == "D12":
            prefix = 'r' if dir_clean in ('r', 'right', 'phai', 'b', 'backward') else 'l'
            return self.servo18(prefix, sec)
        # Default D33
        prefix = 'b' if dir_clean in ('b', 'backward', 'lui', 'r', 'right') else 'a'
        return self.servo33(prefix, sec)

    async def swipe_and_return(
        self,
        swipe_seconds: Optional[float] = None,
        return_seconds: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Chu trình quẹt thẻ 2 chiều: Quẹt xuôi -> Chờ -> Quay về vị trí ban đầu."""
        swp_sec = max(0.01, float(swipe_seconds if swipe_seconds is not None else self.default_swipe_seconds))
        ret_sec = max(0.01, float(return_seconds if return_seconds is not None else swp_sec))

        self.swipe_card(swp_sec, direction="a")
        await asyncio.sleep(swp_sec + 0.3)
        self.swipe_card(ret_sec, direction="b")
        await asyncio.sleep(ret_sec)

        return {
            "status": "success",
            "message": f"Swipe and return completed (Forward: {swp_sec:g}s, Return: {ret_sec:g}s)",
        }

    # -------------------------------------------------------------
    # High-level Card Option 3: SG90 Micro Servo 180° (NFC Tap)
    # -------------------------------------------------------------
    def nfc_set_angle(self, angle: int = 90) -> str:
        """Quay SG90 (D19) đến góc tùy ý (0 - 180 độ)."""
        clamped_angle = max(0, min(180, int(angle)))
        return self.send_command(f"g{clamped_angle}")

    def nfc_tap(self, angle: int = 90) -> str:
        """Vẫy thẻ NFC bằng SG90 (D19): Vươn tới góc -> Giữ 1s -> Thu về 0 độ."""
        clamped_angle = max(0, min(180, int(angle)))
        return self.send_command(f"n{clamped_angle}")

    # -------------------------------------------------------------
    # Configuration & Status
    # -------------------------------------------------------------
    def set_config(
        self,
        insert_servo: Optional[str] = None,
        swipe_servo: Optional[str] = None,
        default_insert_seconds: Optional[float] = None,
        default_eject_seconds: Optional[float] = None,
        default_swipe_seconds: Optional[float] = None,
    ):
        if insert_servo in ("D18", "D33", "D12"):
            self.insert_servo = insert_servo
        if swipe_servo in ("D18", "D33", "D12"):
            self.swipe_servo = swipe_servo
        if default_insert_seconds is not None and default_insert_seconds > 0:
            self.default_insert_seconds = float(default_insert_seconds)
        if default_eject_seconds is not None and default_eject_seconds > 0:
            self.default_eject_seconds = float(default_eject_seconds)
        if default_swipe_seconds is not None and default_swipe_seconds > 0:
            self.default_swipe_seconds = float(default_swipe_seconds)

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected": self.is_connected(),
            "port": self.serial_port.port if (self.serial_port and self.serial_port.is_open) else None,
            "baudrate": self._last_baudrate,
            "insert_servo": self.insert_servo,
            "swipe_servo": self.swipe_servo,
            "nfc_servo": self.nfc_servo,
            "default_insert_seconds": self.default_insert_seconds,
            "default_eject_seconds": self.default_eject_seconds,
            "default_swipe_seconds": self.default_swipe_seconds,
        }


# Singleton instance
card_controller = CardController()


def get_card_service() -> CardController:
    return card_controller
