import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE = 'http://localhost:8000/api';

const WebcamOcrPanel = () => {
  const [engine, setEngine] = useState('paddle');
  const [pattern, setPattern] = useState('');
  const [captureAttempts, setCaptureAttempts] = useState(3);
  const [ocrAttempts, setOcrAttempts] = useState(3);
  const [lastCapturePath, setLastCapturePath] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState('');
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [cameraRetry, setCameraRetry] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [capturedImage, setCapturedImage] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const loadCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === 'videoinput');
    const availableCameras = videoDevices.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
    setCameras(availableCameras);
    return availableCameras;
  };

  useEffect(() => {
    axios.get(`${API_BASE}/webcam/ocr-engine`)
      .then((response) => setEngine(response.data.engine))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const startCamera = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const availableCameras = await loadCameras();
        if (!cameraId && availableCameras.length > 0) {
          const externalCamera = availableCameras.find((camera) =>
            /usb|external|logitech|webcam|camera/i.test(camera.label),
          );
          setCameraId((externalCamera || availableCameras[0]).deviceId);
        }
        setCameraError('');
      } catch (error) {
        const reason = error?.name ? `${error.name}: ${error.message || 'access denied'}` : 'Unknown camera error';
        setCameraError(`${reason}. Allow camera access, close other camera apps, then press ENABLE CAMERA.`);
      }
    };

    if (navigator.mediaDevices?.getUserMedia) {
      startCamera();
    } else {
      setCameraError('Camera API is unavailable. Open the frontend on localhost or HTTPS.');
    }
    return () => {
      active = false;
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, [cameraId, cameraRetry]);

  const runAction = async (action, callback) => {
    setLoading(action);
    try {
      await callback();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || 'Webcam OCR request failed');
    } finally {
      setLoading('');
    }
  };

  const handleEngineChange = async (nextEngine) => {
    setEngine(nextEngine);
    await runAction('engine', async () => {
      await axios.post(`${API_BASE}/webcam/set-ocr-engine`, { engine: nextEngine });
      toast.success(`OCR engine: ${nextEngine}`);
    });
  };

  const handleWarmup = () => runAction('warmup', async () => {
    await axios.post(`${API_BASE}/webcam/warmup`);
    toast.success(`${engine.toUpperCase()} OCR is ready`);
  });

  const handleCapture = () => runAction('capture', async () => {
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');
    setCapturedImage(imageData);
    setLastCapturePath('Browser preview frame');
    toast.success('Image captured');
  });

  const handleOcr = () => {
    if (!pattern.trim()) {
      toast.error('Enter text to search for in the image');
      return;
    }

    return runAction('ocr', async () => {
      const imageData = captureFrame();
      if (!imageData) throw new Error('Camera preview is not ready yet');
      const response = await axios.post(`${API_BASE}/webcam/check-image`, {
        image_data: imageData,
        pattern: pattern.trim(),
      });
      setResult(response.data);
      if (response.data.image_url) setCapturedImage(`${API_BASE.replace('/api', '')}${response.data.image_url}`);
      if (response.data.matched) {
        toast.success('Target text found');
      } else {
        toast('Capture completed, target text was not found');
      }
    });
  };

  const busy = Boolean(loading);

  return (
    <section className="webcam-ocr-panel">
      <div className="webcam-ocr-header">
        <div>
          <p className="webcam-ocr-kicker">VISION CHECK</p>
          <h2 className="section-title">Webcam OCR test</h2>
          <p className="webcam-ocr-description">Capture a frame and check whether a target label is visible.</p>
        </div>
        <span className={`webcam-ocr-status ${result?.matched ? 'webcam-ocr-status--matched' : ''}`}>
          {result ? (result.matched ? 'MATCHED' : 'NO MATCH') : 'READY'}
        </span>
      </div>

      <div className="webcam-ocr-controls">
        <label>
          Camera
          <select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={busy || cameras.length === 0}>
            {cameras.length === 0 && <option value="">No camera found</option>}
            {cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
          </select>
        </label>
        <label>
          OCR engine
          <select value={engine} onChange={(event) => handleEngineChange(event.target.value)} disabled={busy}>
            <option value="paddle">PaddleOCR</option>
            <option value="gpt4o">GPT-4o</option>
          </select>
        </label>
        <label>
          Target text
          <input
            type="text"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="e.g. 123456"
          />
        </label>
        <label>
          Capture attempts
          <input type="number" min="1" max="10" value={captureAttempts} onChange={(event) => setCaptureAttempts(Number(event.target.value) || 1)} />
        </label>
        <label>
          OCR attempts
          <input type="number" min="1" max="10" value={ocrAttempts} onChange={(event) => setOcrAttempts(Number(event.target.value) || 1)} />
        </label>
      </div>

      <div className="webcam-preview" aria-label="Camera preview">
        {cameraError ? (
          <div className="webcam-preview__error">
            <p>{cameraError}</p>
            <button type="button" onClick={() => setCameraRetry((value) => value + 1)} className="webcam-ocr-button webcam-ocr-button--capture">
              ENABLE CAMERA
            </button>
          </div>
        ) : <video ref={videoRef} autoPlay muted playsInline />}
        {capturedImage && <img src={capturedImage} alt="Latest captured frame" />}
      </div>

      <div className="webcam-ocr-actions">
        <button type="button" onClick={handleWarmup} disabled={busy} className="webcam-ocr-button webcam-ocr-button--quiet">
          {loading === 'warmup' ? 'WARMING UP...' : 'WARM UP OCR'}
        </button>
        <button type="button" onClick={handleCapture} disabled={busy} className="webcam-ocr-button webcam-ocr-button--capture">
          {loading === 'capture' ? 'CAPTURING...' : 'CAPTURE FRAME'}
        </button>
        <button type="button" onClick={handleOcr} disabled={busy} className="webcam-ocr-button webcam-ocr-button--primary">
          {loading === 'ocr' ? 'READING...' : 'CAPTURE + CHECK TEXT'}
        </button>
      </div>

      <div className="webcam-ocr-results">
        <div>
          <span className="webcam-ocr-result-label">Last saved frame</span>
          <code>{lastCapturePath || 'No capture yet'}</code>
        </div>
        <div>
          <span className="webcam-ocr-result-label">Extracted text</span>
          <p>{result?.extracted_text || 'OCR result will appear here.'}</p>
        </div>
      </div>
    </section>
  );
};

export default WebcamOcrPanel;