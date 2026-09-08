import base64
import binascii
import json
import logging
import os
import re
import time
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
from openai import OpenAI
from dotenv import load_dotenv


logger = logging.getLogger(__name__)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
PICTURES_DIR = Path(__file__).resolve().parents[2] / "pictures"
DEFAULT_RETRY_ATTEMPTS = 5
DEFAULT_RETRY_DELAY = 1.0
GPT4O_MODEL = "gpt-4o-mini"


class OcrEngine(str, Enum):
    PADDLE = "paddle"
    GPT4O = "gpt4o"


_paddle_reader = None
_openai_client: OpenAI | None = None


def _get_paddle_reader():
    global _paddle_reader
    if _paddle_reader is None:
        from paddleocr import PaddleOCR

        _paddle_reader = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _paddle_reader


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


class OcrResult(NamedTuple):
    capture_success: bool
    pattern_matched: bool
    extracted_text: str
    image_path: Path | None = None


class WebcamService:
    def __init__(self, device_index: int = 0, ocr_engine: OcrEngine = OcrEngine.GPT4O):
        self.device_index = device_index
        self.ocr_engine = ocr_engine

    def set_ocr_engine(self, engine: OcrEngine) -> OcrEngine:
        self.ocr_engine = engine
        return self.ocr_engine

    def get_ocr_engine(self) -> OcrEngine:
        return self.ocr_engine

    def list_cameras(self, max_devices: int = 10):
        cameras = []
        for device_index in range(max_devices):
            cap = cv2.VideoCapture(device_index)
            try:
                if cap.isOpened():
                    cameras.append({"index": device_index, "name": f"Camera {device_index}"})
            finally:
                cap.release()
        return cameras

    def warmup_ocr(self) -> bool:
        try:
            if self.ocr_engine is OcrEngine.PADDLE:
                _get_paddle_reader()
            else:
                _get_openai_client()
            return True
        except Exception:
            logger.exception("OCR warmup failed for engine=%s", self.ocr_engine)
            return False

    def capture(
        self,
        attempts: int = DEFAULT_RETRY_ATTEMPTS,
        retry_delay: float = DEFAULT_RETRY_DELAY,
        device_index: int | None = None,
    ):
        PICTURES_DIR.mkdir(parents=True, exist_ok=True)
        selected_device = self.device_index if device_index is None else device_index
        for attempt in range(1, attempts + 1):
            try:
                cap = cv2.VideoCapture(selected_device)
                if not cap.isOpened():
                    cap.release()
                    if attempt < attempts:
                        time.sleep(retry_delay)
                    continue

                try:
                    success, frame = cap.read()
                    if not success or frame is None:
                        if attempt < attempts:
                            time.sleep(retry_delay)
                        continue

                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    path = PICTURES_DIR / f"capture_{timestamp}.png"
                    cv2.imwrite(str(path), frame)
                    return True, path
                finally:
                    cap.release()
            except (OSError, cv2.error):
                if attempt < attempts:
                    time.sleep(retry_delay)
        return False, None

    def capture_and_check(
        self,
        pattern: str,
        device_index: int | None = None,
        capture_attempts: int = DEFAULT_RETRY_ATTEMPTS,
        capture_retry_delay: float = DEFAULT_RETRY_DELAY,
        ocr_attempts: int = DEFAULT_RETRY_ATTEMPTS,
        ocr_retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> OcrResult:
        extracted_text = ""
        for ocr_attempt in range(1, ocr_attempts + 1):
            success, path = self.capture(capture_attempts, capture_retry_delay, device_index)
            if not success or path is None:
                return OcrResult(False, False, "", None)

            extracted_text, matched = self._run_ocr(path, pattern)
            if matched:
                return OcrResult(True, True, extracted_text, path)
            if ocr_attempt < ocr_attempts:
                time.sleep(ocr_retry_delay)
        return OcrResult(True, False, extracted_text, path)

    def check_image(self, image_data: str, pattern: str) -> OcrResult:
        try:
            encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
            image_bytes = base64.b64decode(encoded, validate=True)
            image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                return OcrResult(False, False, "", None)

            PICTURES_DIR.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            path = PICTURES_DIR / f"capture_{timestamp}.png"
            if not cv2.imwrite(str(path), image):
                return OcrResult(False, False, "", None)

            extracted_text, matched = self._run_ocr(path, pattern)
            return OcrResult(True, matched, extracted_text, path)
        except (ValueError, binascii.Error, cv2.error, OSError):
            logger.exception("Uploaded webcam image could not be processed")
            return OcrResult(False, False, "", None)

    def _prepare_image(self, image_path: Path, target_width: int = 1024, jpeg_quality: int = 85):
        image = cv2.imread(str(image_path))
        if image is None:
            return image_path.read_bytes()
        height, width = image.shape[:2]
        if width > target_width:
            scale = target_width / width
            image = cv2.resize(image, (target_width, int(height * scale)), interpolation=cv2.INTER_AREA)
        success, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        return buffer.tobytes() if success else image_path.read_bytes()

    def _run_ocr(self, image_path: Path, pattern: str):
        if self.ocr_engine is OcrEngine.GPT4O:
            return self._run_ocr_gpt4o(image_path, pattern)
        return self._run_ocr_paddle(image_path, pattern)

    def _run_ocr_paddle(self, image_path: Path, pattern: str):
        try:
            result = _get_paddle_reader().ocr(str(image_path), cls=True)
            lines = [line[1][0] for page in result or [] for line in page or []]
            combined = " ".join(lines)
            return combined, bool(re.search(pattern, combined, re.IGNORECASE))
        except Exception:
            logger.exception("PaddleOCR run failed for %s", image_path)
            return "", False

    def _run_ocr_gpt4o(self, image_path: Path, pattern: str):
        try:
            image = base64.b64encode(self._prepare_image(image_path)).decode("utf-8")
            prompt = (
                "Transcribe all legible text in this webcam image, then determine whether "
                f"the target text {pattern!r} appears as a case-insensitive substring. "
                'Respond only as JSON: {"extracted_text": "...", "matched": true or false}'
            )
            response = _get_openai_client().chat.completions.create(
                model=GPT4O_MODEL,
                max_tokens=1000,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{image}",
                            "detail": "low",
                        }},
                    ],
                }],
            )
            raw = (response.choices[0].message.content or "").strip()
            cleaned = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(cleaned)
            return str(parsed.get("extracted_text", "")), bool(parsed.get("matched", False))
        except Exception:
            logger.exception("GPT-4o OCR call failed for %s", image_path)
            return "", False


webcam_service = WebcamService()