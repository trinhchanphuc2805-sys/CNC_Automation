import sys
sys.path.insert(0, '.')
sys.stdout.reconfigure(encoding='utf-8')
import cv2, json
from services.ai_detector import get_openai_client, encode_image_to_base64
from services.vision_service import auto_detect_quadrilateral, order_corners, warp_perspective_region

img = cv2.imread(r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\49eb5611-52b5-4490-bb24-237b73ff1e3c\.user_uploaded\media_1789100543177.png')
corners = auto_detect_quadrilateral(img)
ordered_pts = order_corners(corners)
warped, M = warp_perspective_region(img, ordered_pts, (800, 800))

client = get_openai_client()
b64 = encode_image_to_base64(warped).split(',', 1)[1]

sys_prompt = """You are an industrial computer vision and precision UI touch localization assistant for a robotic CNC stylus tester.
The image provided is a top-down view of a testing table. Resting on the table is a physical electronic device (such as a POS payment terminal or smartphone).

CRITICAL SPATIAL INSTRUCTIONS:
1. The table / background surface is wood. Do NOT place targets on the wooden table or surrounding items (glasses, paper roll, frame edges).
2. The user wants to test the physical device (POS terminal / smartphone).
3. The device has a rectangular touchscreen display (often showing an app, blue/white header, amount display, and keypad).
4. All touchable UI elements (buttons, keys 1-9, 0, Cancel, OK, Enter, input boxes) reside STRICTLY INSIDE THE ILLUMINATED SCREEN of the device.
5. First locate the bounding box of the device screen: screen_bbox: [xmin, ymin, xmax, ymax] normalized [0.0 to 1.0].
6. Then locate all requested targets strictly within this screen. Each target's center_x_norm and center_y_norm MUST lie strictly inside screen_bbox!

Return JSON ONLY:
{
  "screen_bbox": [xmin, ymin, xmax, ymax],
  "targets": [
    {
      "label": "Tên tiếng Việt hoặc tiếng Anh chính xác (e.g. Nút 1, Nút 2, Nút OK, Ô nhập tiền)",
      "confidence": 0.98,
      "center_x_norm": 0.50,
      "center_y_norm": 0.55,
      "width_norm": 0.06,
      "height_norm": 0.04
    }
  ]
}
"""

resp = client.chat.completions.create(
    model='gpt-4o-mini',
    temperature=0.1,
    messages=[
        {'role': 'system', 'content': sys_prompt},
        {'role': 'user', 'content': [
            {'type': 'text', 'text': 'Detect all buttons and keys on the device screen: numeric keys 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, Cancel, Pay/Confirm, and the amount display.'},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}', 'detail': 'high'}}
        ]}
    ]
)
print('Response:\n', resp.choices[0].message.content)
