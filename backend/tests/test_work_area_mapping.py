import unittest

from cnc_controller import CNCController


class WorkAreaMappingTests(unittest.TestCase):
    def test_cell_to_cnc_point_uses_work_area_geometry(self):
        controller = CNCController()
        controller.set_config(100, 200, 50, 60)
        work_area = [
            [0, 0],
            [300, 0],
            [300, 300],
            [0, 300],
        ]

        target = controller.cell_to_cnc_point(1, 2, rows=4, cols=3, work_area=work_area)

        self.assertAlmostEqual(target[0], 183.0, places=0)
        self.assertAlmostEqual(target[1], 268.0, places=0)

    def test_point_to_cnc_point_uses_calibrated_quadrilateral(self):
        controller = CNCController()
        controller.set_config(0, 0, 100, 100)
        work_area = [
            [0, 0],
            [220, 0],
            [220, 220],
            [0, 220],
        ]

        target = controller.map_image_point_to_cnc(120, 110, work_area=work_area, rows=3, cols=3)

        self.assertAlmostEqual(target[0], 109.09, places=2)
        self.assertAlmostEqual(target[1], 100.0, places=0)


if __name__ == '__main__':
    unittest.main()
