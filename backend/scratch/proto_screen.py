import sys

sys.path.insert(0, '.')
import cv2
import numpy as np

crop = cv2.imread(sys.argv[1])
out = sys.argv[2]
h, w = crop.shape[:2]
gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
gray = cv2.GaussianBlur(gray, (7, 7), 0)
t, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
best = None
for c in cnts:
    x, y, bw, bh = cv2.boundingRect(c)
    m = 4
    touches = x <= m or y <= m or x + bw >= w - m or y + bh >= h - m
    area = cv2.contourArea(c)
    print('cnt', x, y, bw, bh, area, 'touch' if touches else '')
    if touches or area < 0.12 * w * h:
        continue
    if best is None or area > best[0]:
        best = (area, c)
vis = crop.copy()
if best:
    rect = cv2.minAreaRect(best[1])
    box = cv2.boxPoints(rect).astype(int)
    cv2.polylines(vis, [box], True, (0, 255, 0), 2)
    print('screen rect', rect)
cv2.imwrite(out, vis)
cv2.imwrite(out.replace('.png', '_th.png'), th)
print('otsu', t)
