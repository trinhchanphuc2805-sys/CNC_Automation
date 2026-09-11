from cnc_controller import CNCController
 
 
def test_image_to_cnc_point_maps_click_coordinates_to_machine_coordinates():
    controller = CNCController()
    controller.set_config(200, 300, 100, 120)
 
    target = controller.image_to_cnc_point(400, 300, 800, 600)
 
    assert target == (300, 480)
 
 
def test_move_to_image_point_uses_linear_mapping_for_click_positions():
    controller = CNCController()
    controller.set_config(50, 80, 100, 150)
 
    target = controller.image_to_cnc_point(200, 150, 400, 300)
 
    assert target == (150, 305)