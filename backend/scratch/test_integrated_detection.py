import sys
sys.path.insert(0, '.')
import cv2, numpy as np
from services.ai_detector import ai_detector_service
from services.vision_service import auto_detect_quadrilateral, order_corners

img = cv2.imread(r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\49eb5611-52b5-4490-bb24-237b73ff1e3c\.user_uploaded\media_1789100543177.png')
corners = auto_detect_quadrilateral(img)
ordered = order_corners(corners).tolist()

res = ai_detector_service.detect_in_region(
    frame=img,
    work_area=ordered,
    prompt='all numeric keys 1-9, 0, cancel, pay, amount',
    model_type='gpt4o',
    cnc_origin=(0, 0),
    cnc_span=(380, -460),
    invert_y=True,
)
print('Success:', res.get('success'))
print('Count:', res.get('count'))
for obj in res.get('objects', []):
    print(f"{obj['label']}: pixel=({obj['pixel_x']}, {obj['pixel_y']}), cnc=({obj['cnc_x']}, {obj['cnc_y']})")
