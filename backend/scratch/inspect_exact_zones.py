import sys
sys.path.insert(0, '.')
import cv2
from services.ai_detector import get_yolo_model, get_yolo_element_model, _infer_kwargs

p = r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9c0c100f-3458-4063-80bc-fd1ba78de14d\.user_uploaded\media_1792464901215.png"
frame = cv2.imread(p)
h, w = frame.shape[:2]
print(f"Image: {w}x{h}")

phone_model = get_yolo_model()
p_res = phone_model(frame, conf=0.25, verbose=False)[0]
for idx, b in enumerate(p_res.boxes, 1):
    x1, y1, x2, y2 = b.xyxy[0].tolist()
    print(f"Phone #{idx}: ({x1:.1f}, {y1:.1f}) -> ({x2:.1f}, {y2:.1f}), w={x2-x1:.1f}, h={y2-y1:.1f}")

px1, py1, px2, py2 = p_res.boxes[0].xyxy[0].tolist()
ph = py2 - py1

elem_model = get_yolo_element_model()
yres = elem_model.predict(frame, conf=0.18, verbose=False, **_infer_kwargs())[0]
boxes = []
for idx, b in enumerate(yres.boxes, 1):
    ex1, ey1, ex2, ey2 = b.xyxy[0].tolist()
    cx, cy = (ex1+ex2)/2, (ey1+ey2)/2
    rel_y = (cy - py1) / ph
    rel_x = (cx - px1) / (px2 - px1)
    boxes.append({"id": idx, "cx": cx, "cy": cy, "w": ex2-ex1, "h": ey2-ey1, "rel_x": rel_x, "rel_y": rel_y})

boxes.sort(key=lambda b: (round(b["cy"] / 35.0), b["cx"]))
print(f"\nAll YOLO element boxes (sorted):")
for i, b in enumerate(boxes, 1):
    print(f"  #{i:2d}: cx={b['cx']:.1f}, cy={b['cy']:.1f}, w={b['w']:.1f}, h={b['h']:.1f}, rel_x={b['rel_x']:.2f}, rel_y={b['rel_y']:.2f}")
