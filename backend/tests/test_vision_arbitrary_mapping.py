import unittest
import cv2
import numpy as np
from cnc_controller import CNCController
from services.vision_service import (
    auto_detect_quadrilateral,
    camera_calibration_store,
    order_corners,
    warp_perspective_region,
)
from services.ai_detector import ai_detector_service


class VisionArbitraryMappingTests(unittest.TestCase):
    def test_order_corners_orders_correctly(self):
        # Unordered points: [bottom-right, top-left, bottom-left, top-right]
        raw_points = [[200, 200], [10, 15], [12, 195], [205, 20]]
        ordered = order_corners(raw_points)
        # Expected sequence: TL, TR, BR, BL
        self.assertAlmostEqual(ordered[0][0], 10.0, delta=2)
        self.assertAlmostEqual(ordered[0][1], 15.0, delta=2)
        self.assertAlmostEqual(ordered[1][0], 205.0, delta=2)
        self.assertAlmostEqual(ordered[1][1], 20.0, delta=2)
        self.assertAlmostEqual(ordered[2][0], 200.0, delta=2)
        self.assertAlmostEqual(ordered[2][1], 200.0, delta=2)
        self.assertAlmostEqual(ordered[3][0], 12.0, delta=2)
        self.assertAlmostEqual(ordered[3][1], 195.0, delta=2)

    def test_auto_detect_quadrilateral_finds_framed_rectangle(self):
        # Create a black image with a distinct bright rectangle inside
        frame = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.rectangle(frame, (50, 50), (350, 350), (255, 255, 255), thickness=-1)
        corners = auto_detect_quadrilateral(frame)
        self.assertIsNotNone(corners)
        self.assertEqual(len(corners), 4)
        # Corners should be close to (50, 50), (350, 50), (350, 350), (50, 350)
        self.assertAlmostEqual(corners[0][0], 50, delta=5)
        self.assertAlmostEqual(corners[0][1], 50, delta=5)
        self.assertAlmostEqual(corners[2][0], 350, delta=5)
        self.assertAlmostEqual(corners[2][1], 350, delta=5)

    def test_warp_perspective_region(self):
        frame = np.zeros((300, 300, 3), dtype=np.uint8)
        cv2.circle(frame, (150, 150), 30, (0, 255, 0), -1)
        corners = [[50, 50], [250, 50], [250, 250], [50, 250]]
        warped, M = warp_perspective_region(frame, corners, output_size=(200, 200))
        self.assertEqual(warped.shape, (200, 200, 3))
        self.assertIsNotNone(M)

    def test_image_point_to_cnc_mapping(self):
        controller = CNCController()
        # Machine origin at (100, 100), work area width 300mm, height 200mm
        controller.set_config(100, 100, 50, 50)
        work_area = [[0, 0], [400, 0], [400, 200], [0, 200]]

        # Center of image work area is (200, 100)
        # Should map to CNC physical center: x = 100 + 300/2 = 250, y = 100 + 200/2 = 200
        target = controller.image_to_cnc_point(
            200, 100,
            work_area=work_area,
            cnc_width=300.0,
            cnc_height=200.0
        )
        self.assertAlmostEqual(target[0], 250.0, places=1)
        self.assertAlmostEqual(target[1], 200.0, places=1)

    def test_opencv_shape_detection_and_coordinate_computation(self):
        # Create image with two circular buttons
        frame = np.ones((600, 600, 3), dtype=np.uint8) * 40
        cv2.circle(frame, (200, 200), 25, (220, 220, 220), -1)
        cv2.circle(frame, (400, 400), 25, (220, 220, 220), -1)

        result = ai_detector_service.detect_in_region(
            frame=frame,
            work_area=[[100, 100], [500, 100], [500, 500], [100, 500]],
            model_type="opencv",
            cnc_origin=(0.0, 0.0),
            cnc_span=(400.0, 400.0),
            camera_offset=(5.0, -10.0),
        )
        self.assertTrue(result["success"])
        self.assertGreaterEqual(result["count"], 2)
        # Check first object coordinates include camera offsets
        obj = result["objects"][0]
        self.assertIn("cnc_x", obj)
        self.assertIn("cnc_y", obj)
        self.assertIn("pixel_x", obj)
        self.assertIn("pixel_y", obj)


if __name__ == "__main__":
    unittest.main()
