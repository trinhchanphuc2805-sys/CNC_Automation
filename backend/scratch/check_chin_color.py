import sys
sys.path.insert(0, '.')
import cv2
import numpy as np

p = r"C:\Users\LENOVO\.gemini\antigravity-ide\brain\9c0c100f-3458-4063-80bc-fd1ba78de14d\.user_uploaded\media_1792464901215.png"
frame = cv2.imread(p)

pts = [
    ("Circle 3 (Home on blue screen)", 205, 450),
    ("Circle 2 (Payments on blue screen)", 273, 450),
    ("Circle 4 (Nav Back on black chin)", 205, 493),
    ("Circle 5 (Nav Home on black chin)", 273, 493),
    ("Circle 7 (Nav Recents on black chin)", 338, 495),
]

for name, x, y in pts:
    patch = frame[y-5:y+5, x-5:x+5]
    b, g, r = patch.mean(axis=(0,1))
    brightness = 0.299*r + 0.587*g + 0.114*b
    print(f"{name:38s}: B={b:5.1f}, G={g:5.1f}, R={r:5.1f}, Brightness={brightness:5.1f}")
