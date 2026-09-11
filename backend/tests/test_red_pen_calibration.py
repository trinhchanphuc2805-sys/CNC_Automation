import unittest
import cv2
import numpy as np
from services.vision_service import (
    calculate_steps_per_pixel,
    find_red_pen_center,
    measure_quadrilateral_steps,
)


class RedPenCalibrationTests(unittest.TestCase):
    def test_find_red_pen_center_on_synthetic_image(self):
        # Create a neutral grey background
        frame = np.ones((400, 400, 3), dtype=np.uint8) * 120
        # Draw a red circle at (180, 240) with BGR = (0, 0, 240)
        cv2.circle(frame, (180, 240), 15, (0, 0, 240), thickness=-1)

        result = find_red_pen_center(frame, min_area=20.0)
        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["center_x"], 180, delta=2)
        self.assertAlmostEqual(result["center_y"], 240, delta=2)
        self.assertIn("tip_x", result)
        self.assertIn("tip_y", result)
        self.assertGreater(result["area"], 100)

    def test_find_red_pen_returns_none_when_no_red(self):
        # Blue image
        frame = np.zeros((200, 200, 3), dtype=np.uint8)
        frame[:, :, 0] = 255
        result = find_red_pen_center(frame)
        self.assertIsNone(result)

    def test_calculate_steps_per_pixel(self):
        # Moved 1000 steps, pixel moved from (100, 100) to (300, 100) -> 200px
        p0 = (100.0, 100.0)
        p1 = (300.0, 100.0)
        steps_moved = 1000

        res = calculate_steps_per_pixel(p0, p1, steps_moved)
        self.assertAlmostEqual(res["dist_px"], 200.0, places=1)
        self.assertAlmostEqual(res["steps_per_pixel"], 5.0, places=2)

    def test_measure_quadrilateral_steps(self):
        # Frame of 400px width and 300px height
        # With 5 steps/pixel X and 4 steps/pixel Y
        corners = [
            [50, 50],
            [450, 50],
            [450, 350],
            [50, 350]
        ]
        res = measure_quadrilateral_steps(corners, steps_per_pixel_x=5.0, steps_per_pixel_y=4.0)
        self.assertAlmostEqual(res["width_px"], 400.0, delta=1)
        self.assertAlmostEqual(res["height_px"], 300.0, delta=1)
        self.assertEqual(res["width_steps"], 2000)
        self.assertEqual(res["height_steps"], 1200)


if __name__ == "__main__":
    unittest.main()
