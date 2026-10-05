import sys

sys.path.insert(0, '.')
import cv2
import numpy as np

from services.ai_detector import get_yolo_model

src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
col_mean = img.mean(axis=(0, 2))
# strip pillarbox: dark navy bars
cols = np.where(img[img.shape[0] // 2].mean(axis=1) > 60)[0]
x0, x1 = (cols[0], cols[-1]) if len(cols) else (0, img.shape[1] - 1)
img = img[:, x0:x1 + 1]
print('img', img.shape)
r = get_yolo_model()(img, conf=0.25, verbose=False)[0]
print('yolo boxes', [b.xyxy[0].tolist() for b in r.boxes])
if len(r.boxes):
    bx1, by1, bx2, by2 = [int(v) for v in r.boxes[0].xyxy[0].tolist()]
else:
    bx1, by1, bx2, by2 = 0, 0, img.shape[1], img.shape[0]
crop = img[by1:by2, bx1:bx2]
cv2.imwrite(out.replace('.png', '_crop.png'), crop)


def propose(crop):
    h, w = crop.shape[:2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(3.0, (6, 6)).apply(gray)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    bs = int(min(h, w) * 0.15) | 1
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, bs, -4)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        if not (0.05 * w < bw < 0.35 * w and 0.03 * h < bh < 0.2 * h):
            continue
        if not (0.6 < bw / bh < 1.7):
            continue
        fill = cv2.contourArea(c) / (bw * bh)
        if fill < 0.5:
            continue
        boxes.append((x, y, bw, bh))
    return boxes, th


boxes, th = propose(crop)
print('candidates', len(boxes))
vis = crop.copy()
for i, (x, y, bw, bh) in enumerate(boxes):
    cv2.rectangle(vis, (x, y), (x + bw, y + bh), (0, 255, 0), 1)
cv2.imwrite(out, vis)
cv2.imwrite(out.replace('.png', '_th.png'), th)
