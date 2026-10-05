import cv2
import numpy as np

src = r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9f77c9fe-4302-4354-9f7c-93a3f8fc2ffb\.user_uploaded\media_1791171381560.png"
img = cv2.imread(src)

# Let's crop out dark borders from the screenshot
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# Find lit screen: screens are bright (>150), rectangular, aspect ratio between 1.3 and 2.5
# Let's threshold high brightness
_, thresh = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
# Morph close to fill numbers/icons
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

cnts, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print("Found contours:", len(cnts))
h_img, w_img = img.shape[:2]
screens = []
for c in cnts:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    if area > (h_img * w_img * 0.03): # At least 3% of image
        aspect = h / float(w)
        print(f"Candidate: x={x}, y={y}, w={w}, h={h}, area={area}, aspect={aspect:.2f}")
        if 1.0 < aspect < 3.0: # Tall portrait screen
            screens.append((x, y, w, h))

vis = img.copy()
for (x, y, w, h) in screens:
    cv2.rectangle(vis, (x, y), (x+w, y+h), (0, 255, 0), 2)

cv2.imwrite(r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9f77c9fe-4302-4354-9f7c-93a3f8fc2ffb\scratch\screen_candidates.png", vis)
