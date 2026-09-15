import sys
sys.path.insert(0, '.')
import cv2, numpy as np, json, re
from services.ai_detector import get_openai_client, encode_image_to_base64
from services.vision_service import auto_detect_quadrilateral, order_corners, warp_perspective_region

img = cv2.imread(r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\49eb5611-52b5-4490-bb24-237b73ff1e3c\.user_uploaded\media_1789100543177.png')
corners = auto_detect_quadrilateral(img)
ordered = order_corners(corners)
warped, M = warp_perspective_region(img, ordered, (800, 800))
inv_M = np.linalg.inv(M)

# 1. Detect illuminated screen box in warped workspace image
gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
_, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
best_screen = None
for c in contours:
    area = cv2.contourArea(c)
    if 25000 < area < 150000:
        bx, by, bw, bh = cv2.boundingRect(c)
        aspect = bh / float(bw)
        if 1.2 <= aspect <= 2.3:
            best_screen = (bx, by, bw, bh)
            break

print('Detected screen box:', best_screen)
if best_screen:
    sx, sy, sw, sh = best_screen
    screen_crop = warped[sy:sy+sh, sx:sx+sw]
    client = get_openai_client()
    b64 = encode_image_to_base64(screen_crop).split(',', 1)[1]
    
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        temperature=0.1,
        messages=[
            {'role': 'system', 'content': '''You are a vision assistant for touchscreen UI. The image is a CROPPED TOUCHSCREEN of a POS payment device.
Detect all UI elements:
- Amount Input Field / Header
- Numeric keys 1, 2, 3, 4, 5, 6, 7, 8, 9, 0
- Cancel Button, Pay / OK Button

Return JSON ONLY:
{
  "targets": [
    {"label": "Key 1", "center_x_norm": 0.2, "center_y_norm": 0.45, "width_norm": 0.25, "height_norm": 0.12}
  ]
}'''},
            {'role': 'user', 'content': [
                {'type': 'text', 'text': 'Detect all numeric keys (1-9, 0), amount field, cancel and pay buttons.'},
                {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}', 'detail': 'high'}}
            ]}
        ]
    )
    raw = resp.choices[0].message.content
    cleaned = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r'\s*```$', '', cleaned, flags=re.MULTILINE).strip()
    data = json.loads(cleaned)
    for t in data.get('targets', []):
        cx_s = float(t['center_x_norm']) * sw + sx
        cy_s = float(t['center_y_norm']) * sh + sy
        pt = cv2.perspectiveTransform(np.array([[[cx_s, cy_s]]], dtype=np.float32), inv_M)
        cam_x, cam_y = pt[0, 0]
        print(f"{t['label']}: screen_norm=({t['center_x_norm']}, {t['center_y_norm']}) -> camera_pixel=({cam_x:.1f}, {cam_y:.1f})")
