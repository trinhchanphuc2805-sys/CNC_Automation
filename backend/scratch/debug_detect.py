import base64
import sys

sys.path.insert(0, '.')
import cv2
import numpy as np

from services.ai_detector import ai_detector_service

src = sys.argv[1]
out = sys.argv[2]
img = cv2.imread(src)
# crop away dark pillarbox if present (columns that are almost uniformly dark)
col_mean = img.mean(axis=(0, 2))
cols = np.where(col_mean > 40)[0]
if len(cols):
    img = img[:, cols[0]:cols[-1] + 1]
print('image', img.shape)
res = ai_detector_service.detect_in_region(frame=img, work_area=None, prompt='', model_type='gpt4o')
print('success', res.get('success'), res.get('message'), 'count', res.get('count'))
for o in res.get('objects', []):
    print(o['id'], o['label'], o['pixel_x'], o['pixel_y'])
b64 = res['image'].split(',', 1)[1] if res.get('image') else None
if b64:
    open(out, 'wb').write(base64.b64decode(b64))
