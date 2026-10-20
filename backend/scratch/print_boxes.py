import sys
sys.path.insert(0, '.')
import cv2
from services.ai_detector import get_yolo_element_model, _infer_kwargs

p = r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9c0c100f-3458-4063-80bc-fd1ba78de14d\.user_uploaded\media_1792464901215.png"
frame = cv2.imread(p)
h, w = frame.shape[:2]

elem_model = get_yolo_element_model()
yres = elem_model.predict(frame, conf=0.18, verbose=False, **_infer_kwargs())[0]
boxes = []
for idx, b in enumerate(yres.boxes, 1):
    ex1, ey1, ex2, ey2 = b.xyxy[0].tolist()
    cx, cy = (ex1+ex2)/2, (ey1+ey2)/2
    boxes.append({"id": idx, "cx": cx, "cy": cy, "w": ex2-ex1, "h": ey2-ey1, "box": [ex1, ey1, ex2, ey2]})

boxes.sort(key=lambda b: (round(b["cy"] / 25.0), b["cx"]))
print(f"Total boxes: {len(boxes)}")
for i, b in enumerate(boxes, 1):
    print(f"  #{i:2d}: cx={b['cx']:.1f}, cy={b['cy']:.1f}, w={b['w']:.1f}, h={b['h']:.1f}")
