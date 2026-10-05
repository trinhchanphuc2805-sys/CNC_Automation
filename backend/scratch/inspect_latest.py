import sys
sys.path.insert(0, '.')
import cv2
import numpy as np
from services.ai_detector import get_yolo_model

src = r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9f77c9fe-4302-4354-9f7c-93a3f8fc2ffb\.user_uploaded\media_1791171381560.png"
img = cv2.imread(src)
print("Image shape:", img.shape)

# Let's crop out dark borders if any
col_mean = img[img.shape[0]//2].mean(axis=1)
cols = np.where(col_mean > 60)[0]
x0, x1 = (cols[0], cols[-1]) if len(cols) else (0, img.shape[1] - 1)
main_view = img[:, x0:x1+1]

# YOLO detect
ymodel = get_yolo_model()
yres = ymodel(main_view, conf=0.25, verbose=False)[0]
print("YOLO boxes on main view:")
for b in yres.boxes:
    print(b.xyxy[0].tolist(), float(b.conf[0]))

if len(yres.boxes):
    bx1, by1, bx2, by2 = [int(v) for v in yres.boxes[0].xyxy[0].tolist()]
    phone_crop = main_view[by1:by2, bx1:bx2]
    cv2.imwrite(r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9f77c9fe-4302-4354-9f7c-93a3f8fc2ffb\scratch\phone_crop_latest.png", phone_crop)
    print("Saved phone_crop_latest.png with shape:", phone_crop.shape)
