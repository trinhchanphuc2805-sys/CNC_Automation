import asyncio

from cnc_controller import CNCController


class CNCService:
    def __init__(self):
        self.controller = CNCController()

    def get_status(self):
        cnc = self.controller
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

    async def run_sequence(self, sequence: str, delay_ms: int, a_steps: int = None):
        cnc = self.controller
        sequence = sequence.strip()
        if not sequence:
            raise ValueError("Sequence is empty")

        delay = delay_ms if delay_ms > 0 else cnc.delay_between_keys
        for index, char in enumerate(sequence):
            if char in cnc.KEY_LAYOUT:
                cnc.move_to_key(char)
                cnc.press_and_return_a(a_steps)
                if index < len(sequence) - 1:
                    await asyncio.sleep(delay / 1000.0)


service = CNCService()


def get_service():
    return service