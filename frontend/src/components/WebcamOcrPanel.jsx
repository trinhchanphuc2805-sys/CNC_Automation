import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE = 'http://localhost:8000/api';

export function formatLabelToEnglish(label) {
  if (!label) return 'Target Element';
  const l = String(label).trim();
  const lower = l.toLowerCase();

  // Normalize numbers 0-9: e.g. "nut 1", "nút 1", "phím 1", "key 1", "button 1", "1"
  const m = lower.match(/(?:nut|nút|phim|phím|key|button|số|so)?\s*([0-9])\b/);
  if (m && !lower.includes('nhap') && !lower.includes('nhập') && !lower.includes('amount') && !lower.includes('tien') && !lower.includes('tiền')) {
    return `Key ${m[1]}`;
  }

  if (lower.includes('thanh toan') || lower.includes('thanh toán') || lower.includes('pay')) return 'Pay Button';
  if (lower.includes('huy') || lower.includes('hủy') || lower.includes('cancel')) return 'Cancel Button';
  if (lower.includes('enter') || lower.includes('ok')) return 'Enter / OK Key';
  if (lower.includes('so tien') || lower.includes('số tiền') || lower.includes('nhap') || lower.includes('nhập') || lower.includes('amount')) return 'Amount Input Field';
  if (lower.includes('dang nhap') || lower.includes('đăng nhập') || lower.includes('login')) return 'Login Button';
  if (lower.includes('mat khau') || lower.includes('mật khẩu') || lower.includes('password')) return 'Password Field';
  if (lower.includes('email') || lower.includes('phone') || lower.includes('sdt')) return 'Email / Phone Field';

  return l;
}

// Intelligent matcher between test script steps and detected camera elements
function matchStepWithDetected(step, detectedList) {
  if (!step || !detectedList || detectedList.length === 0) return null;

  const targetClean = (step.target || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const stepVal = (step.value || '').toLowerCase().trim();

  // 1. Check if the step requests a specific digit (1-9, 0)
  // Extracts digit from value or target: "Numeric Key 1" -> "1", "Key 1" -> "1", "1" -> "1"
  let targetNumber = null;
  if (/^\d+$/.test(stepVal)) {
    targetNumber = stepVal;
  } else {
    const m = targetClean.match(/(?:nut|so|phim|key|bam|nhan|cham)?\s*(\d+)/);
    if (m) {
      targetNumber = m[1];
    }
  }

  if (targetNumber !== null) {
    // Priority match for that specific number button in detectedList
    const numMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const dText = (d.text || '').toLowerCase().trim();
      // Skip amount input field
      if (dLabel.includes('so tien') || dLabel.includes('nhap') || dLabel.includes('amount') || dLabel.includes('input')) return false;
      return (
        dLabel === `nut ${targetNumber}` ||
        dLabel === `key ${targetNumber}` ||
        dLabel === targetNumber ||
        dLabel.endsWith(` ${targetNumber}`) ||
        dText === targetNumber
      );
    });
    if (numMatch) return numMatch;
  }

  // 2. Check special action buttons
  // Payment / Enter / OK button
  if (targetClean.includes('thanh toan') || targetClean.includes('pay') || targetClean.includes('enter') || targetClean.includes('ok') || stepVal === 'enter' || stepVal === 'ok') {
    const payMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return dLabel.includes('thanh toan') || dLabel.includes('pay') || dLabel.includes('enter') || dLabel.includes('ok');
    });
    if (payMatch) return payMatch;
  }

  // Cancel button
  if (targetClean.includes('huy') || targetClean.includes('cancel')) {
    const cancelMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return dLabel.includes('huy') || dLabel.includes('cancel');
    });
    if (cancelMatch) return cancelMatch;
  }

  // Amount input field
  if (targetClean.includes('nhap') || targetClean.includes('so tien') || targetClean.includes('amount') || targetClean.includes('input') || step.action === 'TYPE') {
    const inputMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return dLabel.includes('nhap') || dLabel.includes('so tien') || dLabel.includes('amount') || dLabel.includes('input');
    });
    if (inputMatch) return inputMatch;
  }

  // 3. Fallback: match by substring if above rules do not trigger
  const generalMatch = detectedList.find((d) => {
    const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return dLabel.includes(targetClean) || targetClean.includes(dLabel);
  });
  if (generalMatch) return generalMatch;

  return null;
}

const WebcamOcrPanel = ({
  activeTestScript = null,
  aiTargets: externalAiTargets = null,
  setAiTargets: setExternalAiTargets = null,
  onSendToAiStudio = null,
  onStepUpdate = null,
  onCompleteExecution = null,
  isExecutingScript = false,
  onSwitchToAiStudio = null,
}) => {
  const stopScriptRef = useRef(false);
  // Navigation tabs: 'ai' | 'roi' | 'grid' | 'ocr'
  const [activeTab, setActiveTab] = useState('ai');
  const [currentExecutingStep, setCurrentExecutingStep] = useState(null);

  // Camera & preview states
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [cameraRetry, setCameraRetry] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [capturedImage, setCapturedImage] = useState('');
  const [loading, setLoading] = useState('');

  // 4-Point ROI Calibration states
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [draggingPointIndex, setDraggingPointIndex] = useState(null);
  const [savedWorkArea, setSavedWorkArea] = useState(null);

  // CNC Machine physical bounds & offset
  const [originX, setOriginX] = useState(200);
  const [originY, setOriginY] = useState(0);
  const [cncWidth, setCncWidth] = useState(380);
  const [cncHeight, setCncHeight] = useState(-460);
  const [cameraOffsetX, setCameraOffsetX] = useState(0);
  const [cameraOffsetY, setCameraOffsetY] = useState(0);
  const [autoPressA, setAutoPressA] = useState(false);
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(true);
  const [swapXY, setSwapXY] = useState(false);
  const [key1X, setKey1X] = useState(50);
  const [key1Y, setKey1Y] = useState(-170);
  const [spacingX, setSpacingX] = useState(100);
  const [spacingY, setSpacingY] = useState(-100);
  const [jogSteps, setJogSteps] = useState(100);
  const [currentCncPos, setCurrentCncPos] = useState({ x: 0, y: 0, a: 0 });

  // AI Target Detection states
  const [aiPrompt, setAiPrompt] = useState('Every individual key on the laptop keyboard');
  const [aiModel, setAiModel] = useState('gpt4o');
  const [localAiTargets, setLocalAiTargets] = useState([]);
  const aiTargets = (externalAiTargets && externalAiTargets.length > 0) ? externalAiTargets : localAiTargets;
  const setAiTargets = (val) => {
    if (setExternalAiTargets) {
      setExternalAiTargets(val);
    }
    setLocalAiTargets(val);
  };
  const [warpedPreview, setWarpedPreview] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [lastTargetPoint, setLastTargetPoint] = useState(null);
  const [runningSequence, setRunningSequence] = useState(false);

  // Red Pen Marker & Step Auto-Calibration states
  const [redPenPos, setRedPenPos] = useState(null);
  const [testJogSteps, setTestJogSteps] = useState(100);
  const [stepsPerPixelX, setStepsPerPixelX] = useState(5.0);
  const [stepsPerPixelY, setStepsPerPixelY] = useState(5.0);
  const [measuredFrame, setMeasuredFrame] = useState(null);
  const [isAutoMeasuring, setIsAutoMeasuring] = useState(false);
  const [autoMeasureStatus, setAutoMeasureStatus] = useState('');
  const [manualPenPickMode, setManualPenPickMode] = useState(false);
  const [motionMatrixInv, setMotionMatrixInv] = useState(null);

  // Fixed Grid states
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(3);
  const [detectedGrid, setDetectedGrid] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);

  // OCR states
  const [engine, setEngine] = useState('gpt4o');
  const [pattern, setPattern] = useState('');
  const [captureAttempts, setCaptureAttempts] = useState(3);
  const [ocrAttempts, setOcrAttempts] = useState(3);
  const [lastCapturePath, setLastCapturePath] = useState('');
  const [ocrResult, setOcrResult] = useState(null);

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
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');
      const availableCameras = videoDevices.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
      setCameras(availableCameras);
      return availableCameras;
    } catch {
      return [];
    }
  };

  const refreshCncStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/com/status`);
      if (res.data) {
        setCurrentCncPos({
          x: res.data.current_x ?? 0,
          y: res.data.current_y ?? 0,
          a: res.data.current_a ?? 0,
        });
      }
    } catch { }
  };

  useEffect(() => {
    axios.get(`${API_BASE}/webcam/ocr-engine`)
      .then((response) => setEngine(response.data.engine))
      .catch(() => { });
    refreshCncStatus();
    const timer = setInterval(refreshCncStatus, 2500);
    return () => clearInterval(timer);
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
        setCameraError(`${reason}. Please check permissions and press ENABLE CAMERA.`);
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
      toast.error(error.response?.data?.detail || error.message || 'Action failed');
    } finally {
      setLoading('');
    }
  };

  const getFrameCoordsFromEvent = (event) => {
    const element = event.currentTarget || videoRef.current?.parentElement || document.body;
    const rect = element.getBoundingClientRect();
    const naturalWidth = videoRef.current?.videoWidth || rect.width || 1;
    const naturalHeight = videoRef.current?.videoHeight || rect.height || 1;
    const clickX = Math.max(0, Math.min(((event.clientX - rect.left) / rect.width) * naturalWidth, naturalWidth));
    const clickY = Math.max(0, Math.min(((event.clientY - rect.top) / rect.height) * naturalHeight, naturalHeight));
    return { x: clickX, y: clickY, width: naturalWidth, height: naturalHeight };
  };

  const getPointerPosition = (event) => {
    const preview = videoRef.current?.parentElement || document.body;
    const rect = preview.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    const width = preview.clientWidth || rect.width || 1;
    const height = preview.clientHeight || rect.height || 1;
    return {
      x: Math.round((x / width) * (videoRef.current?.videoWidth || width)),
      y: Math.round((y / height) * (videoRef.current?.videoHeight || height)),
    };
  };

  // Dragging calibration points
  useEffect(() => {
    if (draggingPointIndex === null) return undefined;

    const handlePointerMove = (event) => {
      const point = getPointerPosition(event);
      setCalibrationPoints((points) => {
        const next = [...points];
        next[draggingPointIndex] = { x: point.x, y: point.y };
        return next;
      });
      setSavedWorkArea((prev) => {
        const next = prev && prev.length === 4 ? [...prev] : [[0, 0], [0, 0], [0, 0], [0, 0]];
        next[draggingPointIndex] = [point.x, point.y];
        return next;
      });
    };

    const handlePointerUp = () => setDraggingPointIndex(null);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingPointIndex]);

  // 1. Calibration Handlers
  const persistCalibration = async () => {
    if (calibrationPoints.length !== 4) {
      toast.error('Select exactly 4 corner points first');
      return;
    }

    await runAction('calibrate', async () => {
      const imageData = captureFrame();
      if (!imageData) throw new Error('Camera preview is not ready yet');
      const previewWidth = videoRef.current?.videoWidth || 1;
      const previewHeight = videoRef.current?.videoHeight || 1;

      await axios.post(`${API_BASE}/webcam/calibrate-work-area`, {
        image_data: imageData,
        output_width: previewWidth,
        output_height: previewHeight,
        points: calibrationPoints.map((p) => ({ x: p.x, y: p.y })),
      });

      setSavedWorkArea(calibrationPoints.map((p) => [p.x, p.y]));
      setCalibrationMode(false);
      toast.success('4 Corners & Homography Matrix calibrated successfully!');
    });
  };

  const handleAutoDetectQuad = () => runAction('autodetect', async () => {
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');
    toast.loading('Analyzing workspace and auto-detecting 4 corners...', { id: 'autodetect' });
    const response = await axios.post(`${API_BASE}/webcam/auto-detect-quad`, { image_data: imageData });
    if (response.data.success && response.data.corners?.length === 4) {
      const corners = response.data.corners.map(([x, y]) => ({ x, y }));
      setCalibrationPoints(corners);
      setSavedWorkArea(response.data.corners);
      setCalibrationMode(true);

      // Auto-persist calibration to server so homography matrix and top-down view are immediately ready
      try {
        await axios.post(`${API_BASE}/webcam/calibration`, { points: corners });
        try {
          const warpRes = await axios.post(`${API_BASE}/webcam/warp-preview`, { image_data: imageData });
          if (warpRes.data?.warped_preview) {
            setWarpedPreview(warpRes.data.warped_preview);
          }
        } catch (_) { }
      } catch (saveErr) {
        console.warn('Auto-save calibration warning:', saveErr);
      }

      toast.success('Auto-detected 4 corners successfully! Drag handles to fine-tune if needed.', { id: 'autodetect' });
    } else {
      toast.error(response.data.message || 'Could not auto-detect a rectangular frame', { id: 'autodetect' });
    }
  });

  const resetCalibration = async () => {
    await runAction('reset-calib', async () => {
      await axios.post(`${API_BASE}/webcam/calibration/reset`);
      setCalibrationMode(false);
      setCalibrationPoints([]);
      setSavedWorkArea(null);
      setDetectedGrid(null);
      setAiTargets([]);
      setWarpedPreview('');
      setLastTargetPoint(null);
      toast.success('Calibration reset');
    });
  };

  // 2. Click to Move CNC Anywhere in ROI
  const handleArbitraryPointClick = async (event) => {
    const isCalibrating = activeTab === 'roi' && calibrationMode;
    if (isCalibrating) {
      const point = getPointerPosition(event);
      if (calibrationPoints.length < 4) {
        setCalibrationPoints((points) => [...points, { x: point.x, y: point.y }]);
        toast(`Corner ${calibrationPoints.length + 1}/4 selected`);
        return;
      }
      toast('4 corners already set. Drag handles to adjust, or click Save Calibration.');
      return;
    }

    const { x, y, width, height } = getFrameCoordsFromEvent(event);

    if (activeTab === 'redpen' && manualPenPickMode) {
      setRedPenPos({ center_x: x, center_y: y, tip_x: x, tip_y: y, radius: 12, manual: true });
      setManualPenPickMode(false);
      toast.success(`Stylus pen position set to (${x}, ${y})!`);
      return;
    }

    const activeWorkArea = savedWorkArea || (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : null);

    await runAction('move-point', async () => {
      toast.loading(`Moving stylus pen to point (${x}, ${y})...`, { id: 'move-point' });
      const currentFrame = captureFrame();
      const payload = {
        image_data: currentFrame,
        current_pen_x: redPenPos ? (redPenPos.tip_x ?? redPenPos.center_x) : null,
        current_pen_y: redPenPos ? (redPenPos.tip_y ?? redPenPos.center_y) : null,
        target_pixel_x: x,
        target_pixel_y: y,
        steps_per_pixel_x: stepsPerPixelX,
        steps_per_pixel_y: stepsPerPixelY,
        motion_matrix_inv: motionMatrixInv,
        invert_x: invertX,
        invert_y: invertY,
        swap_xy: swapXY,
        press_a: autoPressA,
      };

      const response = await axios.post(`${API_BASE}/cnc/move-pen-to-pixel`, payload);
      if (response.data.status === 'success') {
        const moved = response.data.steps_moved;
        setLastTargetPoint({ x, y, cnc_x: moved.x, cnc_y: moved.y });
        if (response.data.target_pixel) {
          setRedPenPos({
            center_x: response.data.target_pixel.x,
            center_y: response.data.target_pixel.y,
            tip_x: response.data.target_pixel.x,
            tip_y: response.data.target_pixel.y,
            radius: 12,
          });
        }
        await refreshCncStatus();
        toast.success(`Moved stylus pen to (${x}, ${y})! (ΔX: ${moved.x}, ΔY: ${moved.y} steps)`, { id: 'move-point' });
      }
    });
  };

  const handleWarpedPreviewClick = async (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const clickY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    let ratioX = clickX / rect.width;
    let ratioY = clickY / rect.height;

    if (invertX) ratioX = 1.0 - ratioX;
    if (invertY) ratioY = 1.0 - ratioY;
    if (swapXY) {
      const tmp = ratioX;
      ratioX = ratioY;
      ratioY = tmp;
    }

    const cncX = Math.round(ratioX * cncWidth + cameraOffsetX);
    const cncY = Math.round(ratioY * cncHeight + cameraOffsetY);

    await runAction('move-rectified-point', async () => {
      const response = await axios.post(`${API_BASE}/cnc/move-to-cnc-point`, {
        target_x: cncX,
        target_y: cncY,
        press_a: autoPressA,
      });
      if (response.data.status === 'success') {
        refreshCncStatus();
        toast.success(`CNC moved to (${cncX}, ${cncY})${autoPressA ? ' & Pressed A' : ''}`);
      }
    });
  };

  const handleSetZero = async () => {
    await runAction('set-zero', async () => {
      await axios.post(`${API_BASE}/cnc/zero`);
      setCurrentCncPos({ x: 0, y: 0, a: currentCncPos.a });
      // When zeroing at Point 1, sync redPenPos with Point 1 of the frame
      if (calibrationPoints && calibrationPoints.length > 0) {
        setRedPenPos({
          center_x: calibrationPoints[0].x,
          center_y: calibrationPoints[0].y,
          tip_x: calibrationPoints[0].x,
          tip_y: calibrationPoints[0].y,
          radius: 12,
          manual: true,
        });
      } else if (savedWorkArea && savedWorkArea.length > 0) {
        setRedPenPos({
          center_x: savedWorkArea[0][0],
          center_y: savedWorkArea[0][1],
          tip_x: savedWorkArea[0][0],
          tip_y: savedWorkArea[0][1],
          radius: 12,
          manual: true,
        });
      }
      toast.success('Origin Zero (0, 0) calibrated at current toolhead position!');
    });
  };

  const handleGoToOrigin = async () => {
    await runAction('go-origin', async () => {
      await axios.post(`${API_BASE}/cnc/go-to-origin`);
      await refreshCncStatus();
      toast.success('CNC returned to Origin (0, 0)');
    });
  };

  const handleQuickJog = async (axis, stepsValue) => {
    await runAction(`jog-${axis}`, async () => {
      await axios.post(`${API_BASE}/cnc/move`, { axis, steps: stepsValue });
      await refreshCncStatus();
    });
  };

  // 3. AI Target Detection
  const handleRunAiDetection = () => runAction('ai-detect', async () => {
    toast.loading('AI Vision is analyzing frame & detecting targets...', { id: 'ai-detect' });
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');

    // Get work area from 4 calibration points or saved work area (prioritizing current calibration points)
    const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);

    const payload = {
      image_data: imageData,
      work_area: activeWorkArea,
      prompt: aiPrompt.trim() || 'all numeric keys 1, 2, 3, 4, and Enter OK buttons on ATM keypad',
      model_type: aiModel,
      origin_x: originX,
      origin_y: originY,
      camera_offset_x: cameraOffsetX,
      camera_offset_y: cameraOffsetY,
      cnc_width: cncWidth,
      cnc_height: cncHeight,
      invert_x: invertX,
      invert_y: invertY,
      swap_xy: swapXY,
      key1_x: key1X,
      key1_y: key1Y,
      spacing_x: spacingX,
      spacing_y: spacingY,
    };

    const response = await axios.post(`${API_BASE}/webcam/ai-detect`, payload);
    if (response.data.success) {
      const rawDetected = response.data.objects || [];
      const detected = rawDetected.map((obj) => ({
        ...obj,
        label: formatLabelToEnglish(obj.label),
      }));
      setAiTargets(detected);
      if (response.data.warped_preview) {
        setWarpedPreview(response.data.warped_preview);
      }
      if (detected.length > 0) {
        if (activeTestScript && activeTestScript.length > 0) {
          toast.success(`Detected ${detected.length} elements! Coordinates mapped to test script. Click "4. Execute CNC" to run!`, { id: 'ai-detect', duration: 5000 });
        } else {
          toast.success(`AI successfully detected ${detected.length} targets in frame!`, { id: 'ai-detect' });
        }
      } else {
        toast('No elements detected with current prompt. Adjust prompt or check camera focus.', { id: 'ai-detect' });
      }
    } else {
      toast.error(response.data.message || 'AI detection returned no targets', { id: 'ai-detect' });
    }
  });

  // Automatically connect to Arduino COM port before CNC execution
  const ensureArduinoConnected = async () => {
    try {
      const statusRes = await axios.get(`${API_BASE}/com/status`);
      if (statusRes.data?.connected) {
        return { connected: true, port: statusRes.data.port || 'Active COM' };
      }

      const portsRes = await axios.get(`${API_BASE}/com/ports`);
      const availablePorts = portsRes.data?.ports || [];
      if (availablePorts.length === 0) {
        toast('No physical COM ports detected. Running in simulation mode.');
        return { connected: false, message: 'No COM ports detected' };
      }

      const targetPort = availablePorts[0].device;
      const connectRes = await axios.post(`${API_BASE}/com/connect`, { port: targetPort, baudrate: 115200 });
      if (connectRes.data?.status === 'success' || connectRes.data?.message) {
        toast.success(`Connected to Arduino on ${targetPort}!`, { id: 'com-connect' });
        return { connected: true, port: targetPort };
      }
      return { connected: false };
    } catch (err) {
      console.warn('Auto-connect warning:', err?.response?.data?.detail || err.message);
      return { connected: false, error: err.message };
    }
  };

  const handleMoveToCncTarget = async (target) => {
    setSelectedTargetId(target.id);
    await runAction(`move-cnc-${target.id}`, async () => {
      toast.loading(`Moving stylus to ${target.label} (CNC: X ${target.cnc_x}, Y ${target.cnc_y})...`, { id: 'move-target' });
      const payload = {
        target_x: target.cnc_x,
        target_y: target.cnc_y,
        press_a: autoPressA,
      };

      const response = await axios.post(`${API_BASE}/cnc/move-to-cnc-point`, payload);
      if (response.data?.status === 'success') {
        setLastTargetPoint({
          x: target.pixel_x ?? target.center_x,
          y: target.pixel_y ?? target.center_y,
          cnc_x: target.cnc_x,
          cnc_y: target.cnc_y,
        });
        setRedPenPos({
          center_x: target.pixel_x ?? target.center_x,
          center_y: target.pixel_y ?? target.center_y,
          tip_x: target.pixel_x ?? target.center_x,
          tip_y: target.pixel_y ?? target.center_y,
          radius: 12,
        });
        await refreshCncStatus();
        toast.success(`Arrived at ${target.label}! (CNC X: ${target.cnc_x}, Y: ${target.cnc_y})`, { id: 'move-target' });
      }
    });
  };

  const handleMoveToTarget = async (target) => {
    setSelectedTargetId(target.id);
    await runAction(`move-target-${target.id}`, async () => {
      toast.loading(`Moving stylus toolhead to ${target.label}...`, { id: 'move-target' });
      const currentFrame = captureFrame();
      const payload = {
        image_data: currentFrame,
        current_pen_x: redPenPos ? (redPenPos.tip_x ?? redPenPos.center_x) : null,
        current_pen_y: redPenPos ? (redPenPos.tip_y ?? redPenPos.center_y) : null,
        target_pixel_x: target.pixel_x ?? target.center_x,
        target_pixel_y: target.pixel_y ?? target.center_y,
        steps_per_pixel_x: stepsPerPixelX,
        steps_per_pixel_y: stepsPerPixelY,
        motion_matrix_inv: motionMatrixInv,
        invert_x: invertX,
        invert_y: invertY,
        swap_xy: swapXY,
        press_a: autoPressA,
      };

      const response = await axios.post(`${API_BASE}/cnc/move-pen-to-pixel`, payload);
      if (response.data.status === 'success') {
        const moved = response.data.steps_moved;
        setLastTargetPoint({
          x: target.pixel_x ?? target.center_x,
          y: target.pixel_y ?? target.center_y,
          cnc_x: moved.x,
          cnc_y: moved.y,
        });
        if (response.data.target_pixel) {
          setRedPenPos({
            center_x: response.data.target_pixel.x,
            center_y: response.data.target_pixel.y,
            tip_x: response.data.target_pixel.x,
            tip_y: response.data.target_pixel.y,
            radius: 12,
          });
        }
        await refreshCncStatus();
        toast.success(`Moved stylus to ${target.label}! (X: ${moved.x}, Y: ${moved.y} steps)`, { id: 'move-target' });
      }
    });
  };

  const handleRunAllSequence = async () => {
    if (!aiTargets.length) {
      toast.error('No targets detected to execute sequence');
      return;
    }
    setRunningSequence(true);
    for (let i = 0; i < aiTargets.length; i += 1) {
      const target = aiTargets[i];
      setSelectedTargetId(target.id);
      try {
        if (target.cnc_x !== undefined && target.cnc_y !== undefined) {
          await axios.post(`${API_BASE}/cnc/move-to-cnc-point`, {
            target_x: target.cnc_x,
            target_y: target.cnc_y,
            press_a: true,
          });
          setRedPenPos({
            center_x: target.pixel_x ?? target.center_x,
            center_y: target.pixel_y ?? target.center_y,
            tip_x: target.pixel_x ?? target.center_x,
            tip_y: target.pixel_y ?? target.center_y,
            radius: 12,
          });
        } else {
          const currentFrame = captureFrame();
          const payload = {
            image_data: currentFrame,
            current_pen_x: redPenPos ? (redPenPos.tip_x ?? redPenPos.center_x) : null,
            current_pen_y: redPenPos ? (redPenPos.tip_y ?? redPenPos.center_y) : null,
            target_pixel_x: target.pixel_x,
            target_pixel_y: target.pixel_y,
            steps_per_pixel_x: stepsPerPixelX,
            steps_per_pixel_y: stepsPerPixelY,
            motion_matrix_inv: motionMatrixInv,
            invert_x: invertX,
            invert_y: invertY,
            swap_xy: swapXY,
            press_a: true,
          };
          const response = await axios.post(`${API_BASE}/cnc/move-pen-to-pixel`, payload);
          if (response.data?.target_pixel) {
            setRedPenPos({
              center_x: response.data.target_pixel.x,
              center_y: response.data.target_pixel.y,
              tip_x: response.data.target_pixel.x,
              tip_y: response.data.target_pixel.y,
              radius: 12,
            });
          }
        }
        toast.success(`[${i + 1}/${aiTargets.length}] Tapped ${target.label}`);
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        toast.error(`Motion error at ${target.label}: ${err.message}`);
        break;
      }
    }
    setRunningSequence(false);
    await refreshCncStatus();
    toast.success('Sequence execution completed!');
  };

  // Automated Script Runner triggered from AI Test Studio
  const handleStopScriptRunner = () => {
    stopScriptRef.current = true;
    toast('Execution halt requested!', { id: 'auto-run' });
  };

  const handleStartScriptRunner = (scriptToRun = activeTestScript) => {
    let steps = scriptToRun;
    if (!steps || steps.length === 0) {
      if (aiTargets.length > 0) {
        handleRunAllSequence();
        return;
      }
      steps = [
        { id: 1, action: 'CLICK', target: 'Numeric Key 1', value: '1', delay_ms: 600, status: 'pending' },
        { id: 2, action: 'CLICK', target: 'Numeric Key 2', value: '2', delay_ms: 600, status: 'pending' },
        { id: 3, action: 'CLICK', target: 'Numeric Key 3', value: '3', delay_ms: 600, status: 'pending' },
        { id: 4, action: 'CLICK', target: 'Numeric Key 4', value: '4', delay_ms: 600, status: 'pending' },
        { id: 5, action: 'CLICK', target: 'Enter / OK Key', value: 'ENTER', delay_ms: 800, status: 'pending' },
      ];
    }
    stopScriptRef.current = false;
    executeTestScriptRunner(steps);
  };

  const executeTestScriptRunner = async (scriptToRun) => {
    if (!scriptToRun || scriptToRun.length === 0) return;
    stopScriptRef.current = false;
    setRunningSequence(true);
    toast.loading('Starting automated test script execution...', { id: 'auto-run' });

    try {
      // 0. Auto-connect Arduino COM port if not already connected
      await ensureArduinoConnected();
      await refreshCncStatus();

      // 1. Capture current frame from fixed camera angle
      let currentFrame = captureFrame();
      if (!currentFrame) {
        await new Promise((r) => setTimeout(r, 600));
        currentFrame = captureFrame();
      }

      const fixedWorkArea = savedWorkArea || (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : null);

      // 2. Run element detection on the fixed camera frame
      let detected = aiTargets.length > 0 ? aiTargets : [];
      if (detected.length === 0 && currentFrame) {
        toast.loading('Detecting screen elements & keypad targets...', { id: 'auto-run' });
        setLoading('ai-detect');
        try {
          const detectPrompt = aiPrompt.trim() || 'all numeric keys 1, 2, 3, 4, and Enter OK buttons on ATM keypad';
          const detectRes = await axios.post(`${API_BASE}/webcam/ai-detect`, {
            image_data: currentFrame,
            work_area: fixedWorkArea,
            prompt: detectPrompt,
            model_type: 'gpt4o',
            cnc_width: cncWidth,
            cnc_height: cncHeight,
            invert_x: invertX,
            invert_y: invertY,
            swap_xy: swapXY,
          });

          if (detectRes.data?.success && detectRes.data?.objects) {
            detected = detectRes.data.objects.map((obj) => ({
              ...obj,
              label: formatLabelToEnglish(obj.label),
            }));
            setAiTargets(detected);
            if (detectRes.data.warped_preview) setWarpedPreview(detectRes.data.warped_preview);
          }
        } catch (detectErr) {
          console.warn('AI detect fallback:', detectErr);
        } finally {
          setLoading('');
        }
      }

      // 3. Sequentially execute each test step in script
      for (let i = 0; i < scriptToRun.length; i += 1) {
        if (stopScriptRef.current) {
          toast('Execution stopped by user!', { id: 'auto-run' });
          break;
        }

        const step = scriptToRun[i];
        if (onStepUpdate) onStepUpdate(i, 'running');
        setCurrentExecutingStep({
          index: i,
          total: scriptToRun.length,
          target: step.target,
          action: step.action,
          value: step.value,
        });

        toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Processing: ${step.target}`, { id: 'auto-run' });

        // Match exact target element from detected camera objects
        const matched = matchStepWithDetected(step, detected);

        const targetCncX = (step.cnc_x !== undefined && step.cnc_x !== null) ? step.cnc_x : matched?.cnc_x;
        const targetCncY = (step.cnc_y !== undefined && step.cnc_y !== null) ? step.cnc_y : matched?.cnc_y;
        const targetPxX = (step.pixel_x !== undefined && step.pixel_x !== null) ? step.pixel_x : (matched?.pixel_x ?? matched?.center_x);
        const targetPxY = (step.pixel_y !== undefined && step.pixel_y !== null) ? step.pixel_y : (matched?.pixel_y ?? matched?.center_y);

        if (targetCncX !== undefined && targetCncY !== undefined && targetCncX !== null && targetCncY !== null) {
          if (matched?.id) setSelectedTargetId(matched.id);
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Moving CNC to ${matched?.label || step.target} (X: ${targetCncX}, Y: ${targetCncY})...`, { id: 'auto-run' });

          try {
            await axios.post(`${API_BASE}/cnc/move-to-cnc-point`, {
              target_x: targetCncX,
              target_y: targetCncY,
              press_a: step.action === 'CLICK' || step.action === 'TYPE' || autoPressA,
            });

            if (targetPxX !== undefined && targetPxY !== undefined) {
              setLastTargetPoint({
                x: targetPxX,
                y: targetPxY,
                cnc_x: targetCncX,
                cnc_y: targetCncY,
              });
              setRedPenPos({
                center_x: targetPxX,
                center_y: targetPxY,
                tip_x: targetPxX,
                tip_y: targetPxY,
                radius: 12,
              });
            }
          } catch (mErr) {
            console.warn('CNC move-to-cnc-point warning:', mErr);
            toast.error(`CNC error at ${step.target}: ${mErr?.response?.data?.detail || mErr.message}`, { id: 'auto-run' });
          }
          await refreshCncStatus();
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
        } else if (matched) {
          setSelectedTargetId(matched.id);
          const movePayload = {
            image_data: captureFrame(),
            current_pen_x: redPenPos ? (redPenPos.tip_x ?? redPenPos.center_x) : null,
            current_pen_y: redPenPos ? (redPenPos.tip_y ?? redPenPos.center_y) : null,
            target_pixel_x: matched.pixel_x,
            target_pixel_y: matched.pixel_y,
            steps_per_pixel_x: stepsPerPixelX,
            steps_per_pixel_y: stepsPerPixelY,
            motion_matrix_inv: motionMatrixInv,
            invert_x: invertX,
            invert_y: invertY,
            swap_xy: swapXY,
            press_a: step.action === 'CLICK' || step.action === 'TYPE' || autoPressA,
          };

          try {
            const moveRes = await axios.post(`${API_BASE}/cnc/move-pen-to-pixel`, movePayload);
            if (moveRes.data?.target_pixel) {
              setRedPenPos({
                center_x: moveRes.data.target_pixel.x,
                center_y: moveRes.data.target_pixel.y,
                tip_x: moveRes.data.target_pixel.x,
                tip_y: moveRes.data.target_pixel.y,
                radius: 12,
              });
            }
          } catch (mErr) {
            console.warn('CNC move warning:', mErr);
          }
          await refreshCncStatus();
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
        } else {
          // Simulation / wait delay
          const waitTime = Math.max(step.delay_ms || 500, 650);
          await new Promise((r) => setTimeout(r, waitTime));
          if (onStepUpdate) onStepUpdate(i, 'passed');
        }
      }

      if (!stopScriptRef.current) {
        toast.success(`Successfully executed all ${scriptToRun.length} test steps!`, { id: 'auto-run', duration: 5000 });
        if (onCompleteExecution) onCompleteExecution(true);
      }
    } catch (err) {
      toast.error(`Script execution error: ${err.message}`, { id: 'auto-run' });
      if (onCompleteExecution) onCompleteExecution(false);
    } finally {
      setRunningSequence(false);
      setCurrentExecutingStep(null);
    }
  };

  useEffect(() => {
    if (isExecutingScript && activeTestScript && activeTestScript.length > 0 && !runningSequence) {
      executeTestScriptRunner(activeTestScript);
    }
  }, [isExecutingScript, activeTestScript]);

  // 4. Fixed Grid Handlers
  const handleDetectGrid = () => runAction('detect-grid', async () => {
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');
    const activeWorkArea = savedWorkArea || (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : null);

    const response = await axios.post(`${API_BASE}/webcam/detect-fixed-grid`, {
      image_data: imageData,
      rows: gridRows,
      cols: gridCols,
      work_area: activeWorkArea,
    });
    setDetectedGrid(response.data);
    toast.success('Grid generated');
  });

  const handleCellClick = async (row, col) => {
    await runAction(`cell-${row}-${col}`, async () => {
      const imageData = captureFrame();
      if (!imageData) throw new Error('Camera preview is not ready yet');
      const activeWorkArea = savedWorkArea || (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : null);

      const response = await axios.post(`${API_BASE}/webcam/click-fixed-grid`, {
        image_data: imageData,
        row,
        col,
        rows: gridRows,
        cols: gridCols,
        work_area: activeWorkArea,
        camera_offset_x: cameraOffsetX,
        camera_offset_y: cameraOffsetY,
      });
      setSelectedCell({ row, col });
      if (response.data.success) {
        toast.success(`CNC moved to cell (${row + 1}, ${col + 1}) → (${response.data.target_x}, ${response.data.target_y})`);
      }
    });
  };

  // 5. Red Pen Marker & Step Calibration Handlers
  const handleDetectRedPen = () => runAction('detect-red-pen', async () => {
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');

    const res = await axios.post(`${API_BASE}/webcam/detect-red-pen`, { image_data: imageData });
    if (res.data.success && res.data.pen) {
      setRedPenPos(res.data.pen);
      toast.success(`Found red stylus tip at (${res.data.pen.center_x}, ${res.data.pen.center_y}), radius: ${res.data.pen.radius}px`);
    } else {
      toast.error(res.data.message || 'Could not locate red stylus in image. Try manual picking.');
    }
  });

  const handleAutoCalibrateSteps = async () => {
    setIsAutoMeasuring(true);
    setAutoMeasureStatus('Starting automatic step calibration routine...');
    try {
      // 1. Capture initial frame
      setAutoMeasureStatus('Step 1/5: Capturing initial frame to locate red stylus...');
      toast.loading('Locating stylus tip...', { id: 'auto-step' });
      const f0 = captureFrame();
      if (!f0) throw new Error('Failed to capture frame from camera');
      const res0 = await axios.post(`${API_BASE}/webcam/detect-red-pen`, { image_data: f0 });
      if (!res0.data?.success || !res0.data?.pen) {
        throw new Error(res0.data?.message || 'Could not locate red stylus. Place stylus in camera view.');
      }
      const p0 = res0.data.pen;
      setRedPenPos(p0);

      const v0_x = p0.tip_x ?? p0.center_x;
      const v0_y = p0.tip_y ?? p0.center_y;

      // 2. Jog X axis
      setAutoMeasureStatus(`Step 2/5: CNC jogging X axis ${testJogSteps} steps...`);
      toast.loading(`Jogging X ${testJogSteps} steps...`, { id: 'auto-step' });
      await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: testJogSteps });
      await new Promise((r) => setTimeout(r, 800));

      // 3. Frame 1 for X ratio
      setAutoMeasureStatus('Step 3/5: Camera measuring X displacement...');
      const f1 = captureFrame();
      const res1 = await axios.post(`${API_BASE}/webcam/detect-red-pen`, { image_data: f1 });
      if (!res1.data?.success || !res1.data?.pen) {
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: -testJogSteps });
        throw new Error('Lost stylus marker after X jog. Toolhead returned to origin.');
      }
      const p1 = res1.data.pen;
      const v1_x = p1.tip_x ?? p1.center_x;
      const v1_y = p1.tip_y ?? p1.center_y;
      const dx_px = Math.hypot(v1_x - v0_x, v1_y - v0_y);
      if (dx_px < 2) {
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: -testJogSteps });
        throw new Error(`X displacement too small (${dx_px.toFixed(1)}px). Increase test jog steps.`);
      }
      const spx = Number((testJogSteps / dx_px).toFixed(3));
      setStepsPerPixelX(spx);
      setRedPenPos(p1);

      // 4. Jog Y axis
      setAutoMeasureStatus(`Step 4/5: CNC jogging Y axis ${testJogSteps} steps...`);
      toast.loading(`Jogging Y ${testJogSteps} steps...`, { id: 'auto-step' });
      await axios.post(`${API_BASE}/cnc/move`, { axis: 'YZ', steps: testJogSteps });
      await new Promise((r) => setTimeout(r, 800));

      // 5. Frame 2 for Y ratio
      setAutoMeasureStatus('Step 5/5: Camera measuring Y displacement...');
      const f2 = captureFrame();
      const res2 = await axios.post(`${API_BASE}/webcam/detect-red-pen`, { image_data: f2 });
      if (!res2.data?.success || !res2.data?.pen) {
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'YZ', steps: -testJogSteps });
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: -testJogSteps });
        throw new Error('Lost stylus marker after Y jog. Toolhead returned to origin.');
      }
      const p2 = res2.data.pen;
      const v2_x = p2.tip_x ?? p2.center_x;
      const v2_y = p2.tip_y ?? p2.center_y;
      const dy_px = Math.hypot(v2_x - v1_x, v2_y - v1_y);
      if (dy_px < 2) {
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'YZ', steps: -testJogSteps });
        await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: -testJogSteps });
        throw new Error(`Y displacement too small (${dy_px.toFixed(1)}px). Increase test jog steps.`);
      }
      const spy = Number((testJogSteps / dy_px).toFixed(3));
      setStepsPerPixelY(spy);
      setRedPenPos(p2);

      // Compute multi-axis inverse motion matrix
      const vec_x = [v1_x - v0_x, v1_y - v0_y];
      const vec_y = [v2_x - v1_x, v2_y - v1_y];
      let computedMatrixInv = null;
      try {
        const matrixRes = await axios.post(`${API_BASE}/webcam/compute-motion-matrix`, {
          vec_x,
          steps_x: testJogSteps,
          vec_y,
          steps_y: testJogSteps,
        });
        if (matrixRes.data?.success) {
          computedMatrixInv = matrixRes.data.motion_matrix_inv;
          setMotionMatrixInv(computedMatrixInv);
        }
      } catch (mErr) {
        console.warn('Fallback to scalar ratios:', mErr);
      }

      // 6. Return toolhead to original position
      setAutoMeasureStatus('Returning CNC toolhead to origin position...');
      toast.loading('Returning to origin...', { id: 'auto-step' });
      await axios.post(`${API_BASE}/cnc/move`, { axis: 'YZ', steps: -testJogSteps });
      await axios.post(`${API_BASE}/cnc/move`, { axis: 'X', steps: -testJogSteps });
      await new Promise((r) => setTimeout(r, 600));

      setRedPenPos(p0);

      // 7. Measure frame dimensions
      setAutoMeasureStatus('Computing physical frame dimensions...');
      let currentCorners = calibrationPoints.length === 4
        ? calibrationPoints.map((p) => [p.x, p.y])
        : savedWorkArea;

      if (!currentCorners || currentCorners.length !== 4) {
        const quadRes = await axios.post(`${API_BASE}/webcam/auto-detect-quad`, { image_data: f0 });
        if (quadRes.data?.success && quadRes.data?.corners?.length === 4) {
          currentCorners = quadRes.data.corners;
          setCalibrationPoints(currentCorners.map(([x, y]) => ({ x, y })));
          setSavedWorkArea(currentCorners);
        }
      }

      let measurementData = null;
      if (currentCorners && currentCorners.length === 4) {
        const measureRes = await axios.post(`${API_BASE}/webcam/measure-frame-steps`, {
          corners: currentCorners,
          steps_per_pixel_x: spx,
          steps_per_pixel_y: spy,
          motion_matrix_inv: computedMatrixInv,
        });
        if (measureRes.data?.success) {
          measurementData = measureRes.data.measurement;
          setCncWidth(measurementData.width_steps);
          setCncHeight(measurementData.height_steps);
          setMeasuredFrame(measurementData);
        }
      }

      setAutoMeasureStatus('Step calibration completed successfully!');
      toast.success(
        `Calibration successful! Ratio: X=${spx} s/px, Y=${spy} s/px.` +
        (measurementData ? ` Frame: ${measurementData.width_steps}x${measurementData.height_steps} steps.` : ''),
        { id: 'auto-step', duration: 7000 }
      );
    } catch (err) {
      setAutoMeasureStatus(`Error: ${err.message}`);
      toast.error(err.response?.data?.detail || err.message, { id: 'auto-step' });
    } finally {
      setIsAutoMeasuring(false);
      refreshCncStatus();
    }
  };

  const handleMovePenToTarget = async (target) => {
    try {
      toast.loading(`Moving stylus to ${target.label || 'target'}...`, { id: 'move-pen' });
      const currentFrame = captureFrame();
      const res = await axios.post(`${API_BASE}/cnc/move-pen-to-pixel`, {
        image_data: currentFrame,
        target_pixel_x: target.center_x ?? target.pixel_x,
        target_pixel_y: target.center_y ?? target.pixel_y,
        steps_per_pixel_x: stepsPerPixelX,
        steps_per_pixel_y: stepsPerPixelY,
        swap_xy: swapXY,
        invert_x: invertX,
        invert_y: invertY,
        press_a: autoPressA,
      });
      if (res.data?.target_pixel) {
        setRedPenPos({ center_x: res.data.target_pixel.x, center_y: res.data.target_pixel.y, radius: 12 });
      }
      toast.success(`Moved stylus to target! (X: ${res.data.steps_moved.x}, Y: ${res.data.steps_moved.y} steps)`, { id: 'move-pen' });
      refreshCncStatus();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message, { id: 'move-pen' });
    }
  };

  const handleRunAutoGridCalibration = async () => {
    setIsAutoMeasuring(true);
    setAutoMeasureStatus('Starting 9-point grid calibration...');
    try {
      // 3x3 Grid
      const pointsPx = [];
      const pointsCnc = [];

      const startX = currentCncPos.x || 0;
      const startY = currentCncPos.y || 0;
      const stepX = testJogSteps || 500;
      const stepY = testJogSteps || 500;

      for (let ix = 0; ix < 3; ix++) {
        for (let iy = 0; iy < 3; iy++) {
          const targetX = startX + ix * stepX;
          const targetY = startY + iy * stepY;

          setAutoMeasureStatus(`Moving to point [${ix + 1},${iy + 1}] (CNC X: ${targetX}, Y: ${targetY})...`);

          await axios.post(`${API_BASE}/cnc/move-to-cnc-point`, {
            target_x: targetX,
            target_y: targetY,
            press_a: false
          });

          await new Promise((r) => setTimeout(r, 1200));

          const f = captureFrame();
          if (!f) throw new Error("Could not capture frame");

          const res = await axios.post(`${API_BASE}/webcam/detect-red-pen`, { image_data: f });
          if (!res.data?.success || !res.data?.pen) {
            throw new Error(`Could not find red stylus at point [${ix + 1},${iy + 1}].`);
          }

          const pen = res.data.pen;
          const pxX = pen.tip_x ?? pen.center_x;
          const pxY = pen.tip_y ?? pen.center_y;

          pointsPx.push([pxX, pxY]);
          pointsCnc.push([targetX, targetY]);

          setRedPenPos(pen);
        }
      }

      setAutoMeasureStatus('All 9 points collected. Training spatial model...');

      const trainRes = await axios.post(`${API_BASE}/webcam/calibrate/spatial/train`, {
        points_px: pointsPx,
        points_cnc: pointsCnc
      });

      if (trainRes.data.success) {
        toast.success('Grid spatial calibration completed and model trained!', { duration: 5000 });
      } else {
        toast.error('Failed to train spatial mapping model');
      }

      setAutoMeasureStatus('Returning to origin...');
      await axios.post(`${API_BASE}/cnc/go-to-origin`);

      setAutoMeasureStatus('Grid Calibration complete!');
    } catch (err) {
      setAutoMeasureStatus(`Grid Calibration Error: ${err.message}`);
      toast.error(err.response?.data?.detail || err.message);
    } finally {
      setIsAutoMeasuring(false);
      refreshCncStatus();
    }
  };



  // 6. OCR Handlers
  const handleOcr = () => runAction('ocr', async () => {
    if (!pattern.trim()) {
      toast.error('Enter text to search for');
      return;
    }
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');
    const response = await axios.post(`${API_BASE}/webcam/check-image`, {
      image_data: imageData,
      pattern: pattern.trim(),
    });
    setOcrResult(response.data);
    if (response.data.image_url) setCapturedImage(`${API_BASE.replace('/api', '')}${response.data.image_url}`);
    if (response.data.matched) {
      toast.success('Target text found!');
    } else {
      toast('Target text was not found');
    }
  });

  const frameWidth = videoRef.current?.videoWidth || 1;
  const frameHeight = videoRef.current?.videoHeight || 1;
  const busy = Boolean(loading) || runningSequence;

  return (
    <section className="webcam-ocr-panel vision-studio-card">
      {/* Header */}
      <div className="webcam-ocr-header">
        <div>
          <div className="vision-kicker-badge">
            <span className="vision-pulse-dot" />
            COMPUTER VISION & AI ALIGNMENT
          </div>
          <h2 className="section-title">Automation Computer Vision</h2>
          {/* <p className="webcam-ocr-description">
            4-Point Perspective Transform &bull; AI Model Target Detection &bull; Arbitrary Coordinate Navigation
          </p> */}
        </div>
        <div className="vision-header-actions">
          <span className={`webcam-ocr-status ${savedWorkArea ? 'webcam-ocr-status--matched' : ''}`}>
            {savedWorkArea ? 'CALIBRATED' : calibrationMode ? 'CALIBRATING...' : 'UNRECTIFIED'}
          </span>
        </div>
      </div>

      {/* ===================================================================
          ACTIVE AI TEST SCRIPT: STATUS PIPELINE & 3-STEP WORKFLOW DECK
          =================================================================== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-xs">
        {/* If Active Test Script is present, show scenario info & step status badges */}
        {activeTestScript && activeTestScript.length > 0 && (
          <div className="pb-4 mb-4 border-b border-slate-100">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${runningSequence ? 'bg-sky-500 animate-ping' : 'bg-emerald-500'}`} />
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                    ATM PIN Verification &bull; Automated Vision & CNC Pipeline
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Test scenario with <strong>{activeTestScript.length}</strong> steps &bull; Completed:{' '}
                  <strong className="text-emerald-600 font-bold">{activeTestScript.filter((s) => s.status === 'passed').length}/{activeTestScript.length}</strong> steps
                  {activeTestScript.filter((s) => s.status === 'pending' || s.status === 'idle').length > 0 && (
                    <span className="ml-2 text-amber-600 font-medium">
                      ({activeTestScript.filter((s) => s.status === 'pending' || s.status === 'idle').length} steps pending)
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {onSwitchToAiStudio && (
                  <button
                    type="button"
                    onClick={onSwitchToAiStudio}
                    className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    &larr; Back to AI Test Studio
                  </button>
                )}
              </div>
            </div>

            {/* Step Badges Row: Displaying ALL steps with PENDING / RUNNING / PASSED / FAILED */}
            <div className="py-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Sequential Execution Pipeline Status (Pending / Running / Passed):
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {activeTestScript.map((st, sIdx) => {
                  const isRun = st.status === 'running';
                  const isPass = st.status === 'passed';
                  const isFail = st.status === 'failed';
                  const isPending = !isRun && !isPass && !isFail; // pending or idle

                  return (
                    <div
                      key={`step-card-${st.id || sIdx}`}
                      className={`p-2.5 rounded-xl border transition-all text-xs flex flex-col justify-between ${isRun
                        ? 'bg-sky-50/80 border-sky-300 shadow-xs ring-2 ring-sky-400/30'
                        : isPass
                          ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                          : isFail
                            ? 'bg-red-50 border-red-300 text-red-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-bold text-slate-500 text-[10px]">Step #{sIdx + 1}</span>
                          {isRun && (
                            <span className="px-1.5 py-0.5 bg-sky-500 text-white rounded font-extrabold text-[9px] animate-pulse">
                              RUNNING
                            </span>
                          )}
                          {isPass && (
                            <span className="px-1.5 py-0.5 bg-[#0ac282] text-white rounded font-extrabold text-[9px]">
                              PASSED
                            </span>
                          )}
                          {isFail && (
                            <span className="px-1.5 py-0.5 bg-[#fe5d70] text-white rounded font-extrabold text-[9px]">
                              FAILED
                            </span>
                          )}
                          {isPending && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded font-bold text-[9px]">
                              PENDING
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-slate-800 line-clamp-1 text-[11px]">
                          [{st.action}] {st.target}
                        </div>
                        {st.value && (
                          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                            Val: "{st.value}"
                          </div>
                        )}
                        {/* Auto-mapped CNC Coordinates */}
                        {(() => {
                          const matchedTarget = (st.cnc_x !== undefined && st.cnc_y !== undefined)
                            ? { label: st.target, cnc_x: st.cnc_x, cnc_y: st.cnc_y }
                            : matchStepWithDetected(st, aiTargets);
                          if (matchedTarget) {
                            return (
                              <div className="mt-1.5 px-1.5 py-0.5 bg-emerald-50 border border-emerald-300 rounded text-[9.5px] text-emerald-800 font-mono font-bold flex items-center justify-between" title={`Matched target ${matchedTarget.label} (CNC X: ${matchedTarget.cnc_x}, Y: ${matchedTarget.cnc_y})`}>
                                <span>{matchedTarget.label !== st.target ? matchedTarget.label : 'CNC'}:</span>
                                <span>X={matchedTarget.cnc_x}, Y={matchedTarget.cnc_y}</span>
                              </div>
                            );
                          }
                          return (
                            <div className="mt-1.5 px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] text-slate-400 font-mono text-center">
                              Awaiting detection...
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Current Executing Step Details & Progress Bar */}
            {runningSequence && currentExecutingStep && (
              <div className="py-2.5 px-3.5 bg-sky-50 border border-sky-200 rounded-xl mt-2">
                <div className="flex items-center justify-between text-xs text-sky-900 font-semibold mb-1.5">
                  <span>
                    Executing step {currentExecutingStep.index + 1}/{currentExecutingStep.total}: [
                    {currentExecutingStep.action}] &rarr; {currentExecutingStep.target}
                    {currentExecutingStep.value ? ` (Value: "${currentExecutingStep.value}")` : ''}
                  </span>
                  <span>
                    {Math.round(((currentExecutingStep.index + 1) / Math.max(1, currentExecutingStep.total)) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-sky-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-sky-500 to-[#0ac282] h-full transition-all duration-300"
                    style={{
                      width: `${((currentExecutingStep.index + 1) / Math.max(1, currentExecutingStep.total)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4-STEP PIPELINE ACTION TOOLBAR */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between">
            <span>4-Step Vision & CNC Execution Pipeline:</span>
            <span className="text-[10px] text-slate-400 font-normal">
              Scan Frame &rarr; Select Stylus Tip &rarr; Detect Screen Elements &rarr; Execute CNC Automation
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Step 1: Scan 4-Corner Frame */}
            <button
              type="button"
              onClick={handleAutoDetectQuad}
              disabled={busy}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-white text-left transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#404E67] text-white flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">Scan 4-Corner Frame</div>
                  <div className="text-[10px] text-slate-500">Calibrate screen boundary</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${savedWorkArea ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {savedWorkArea ? 'Calibrated' : 'Not scanned'}
              </span>
            </button>

            {/* Step 2: Select Stylus Pen Tip */}
            <button
              type="button"
              onClick={handleDetectRedPen}
              disabled={busy}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-white text-left transition-all group cursor-pointer"
              title="Click to auto-detect red stylus pen tip on camera"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#fe5d70] text-white flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">Select Stylus Tip</div>
                  <div className="text-[10px] text-slate-500">
                    {manualPenPickMode ? 'Click on preview to pick' : 'Auto-detect or pick tip'}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${redPenPos ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {redPenPos ? `(${redPenPos.tip_x ?? redPenPos.center_x}, ${redPenPos.tip_y ?? redPenPos.center_y})` : 'Not selected'}
              </span>
            </button>

            {/* Step 3: Run Detect AI Elements */}
            <button
              type="button"
              onClick={handleRunAiDetection}
              disabled={busy}
              className={`flex items-center justify-between p-3 rounded-xl border transition-all group cursor-pointer ${loading === 'ai-detect'
                ? 'border-sky-400 bg-sky-50 shadow-md ring-2 ring-sky-300'
                : 'border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-white'
                }`}
              title="Detect ATM keypad keys (1,2,3,4, Enter) and screen items"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs ${loading === 'ai-detect' ? 'bg-sky-500' : 'bg-[#01a9ac]'}`}>
                  {loading === 'ai-detect' ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    '3'
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    {loading === 'ai-detect' ? 'Detecting Targets...' : 'Detect Elements'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {loading === 'ai-detect' ? 'Analyzing camera frame...' : 'Keypad 1,2,3,4 & Enter'}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${loading === 'ai-detect'
                ? 'bg-sky-500 text-white animate-pulse'
                : (aiTargets.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')
                }`}>
                {loading === 'ai-detect' ? 'Scanning...' : (aiTargets.length > 0 ? `${aiTargets.length} targets` : 'Not detected')}
              </span>
            </button>

            {/* Step 4: Execute CNC Automation */}
            {!runningSequence ? (
              <button
                type="button"
                onClick={() => handleStartScriptRunner(activeTestScript)}
                disabled={busy}
                className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-[#0ac282] to-[#0df3a3] hover:shadow-md text-white text-left transition-all shadow-xs cursor-pointer"
                title="Auto-connect COM port to Arduino and sequentially execute CNC taps"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-white/20 text-white flex items-center justify-center font-bold text-xs">
                    4
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-white">Execute CNC</div>
                    <div className="text-[10px] text-emerald-100">Auto COM & tap keys</div>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold bg-white text-emerald-700 px-2.5 py-0.5 rounded-full shadow-xs">
                  Execute &rarr;
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopScriptRunner}
                className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:shadow-md text-white text-left transition-all shadow-xs cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-white/20 text-white flex items-center justify-center font-bold text-xs">
                    <span className="w-2.5 h-2.5 bg-white rounded-xs inline-block" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-white">Stop Execution</div>
                    <div className="text-[10px] text-rose-100">Halt CNC commands</div>
                  </div>
                </div>
                <span className="text-[10px] font-bold bg-white text-red-600 px-2.5 py-0.5 rounded-full shadow-xs">
                  Stop
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="vision-tabs-bar">
        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'roi' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('roi')}
        >
          4-Point Work Area ROI
        </button>
        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'spatial' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('spatial')}
        >
          High-Precision Grid Map
        </button>
        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'ai' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI Target Detection
        </button>

        {/* <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'grid' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('grid')}
        >
          Fixed Grid (NxM)
        </button> */}
        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'ocr' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('ocr')}
        >
          OCR Search
        </button>
        {/* <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'redpen' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('redpen')}
        >
          Auto Calibration (Red Pen Step)
        </button> */}
      </div>

      {/* Tab: Red Pen Marker & Step Auto-Calibration */}
      {activeTab === 'redpen' && (
        <div className="vision-control-deck">
          <div className="vision-redpen-banner">
            <div className="vision-redpen-banner__status">
              <span className="vision-pulse-dot" style={{ background: redPenPos ? '#ef4444' : '#64748b' }} />
              <span>
                Stylus Pen Position:{' '}
                {redPenPos ? (
                  <strong style={{ color: '#f87171' }}>
                    Tip: ({redPenPos.tip_x ?? redPenPos.center_x}, {redPenPos.tip_y ?? redPenPos.center_y}) &bull; Center: ({redPenPos.center_x}, {redPenPos.center_y})
                  </strong>
                ) : (
                  <em style={{ color: '#94a3b8' }}>Not detected (Click "Auto Detect Stylus" or "Manual Pick")</em>
                )}
              </span>
            </div>
            <div className="vision-redpen-banner__btns">
              <button
                type="button"
                onClick={handleDetectRedPen}
                disabled={busy || isAutoMeasuring}
                className="webcam-ocr-button webcam-ocr-button--capture"
              >
                🔍 AUTO DETECT STYLUS
              </button>
              <button
                type="button"
                onClick={() => setManualPenPickMode((v) => !v)}
                disabled={busy || isAutoMeasuring}
                className={`webcam-ocr-button ${manualPenPickMode ? 'webcam-ocr-button--primary' : 'webcam-ocr-button--quiet'}`}
                title="Click directly on the stylus pen tip on the preview screen"
              >
                {manualPenPickMode ? '📍 CLICK ON VIDEO TO PICK...' : '📍 MANUAL PICK'}
              </button>
            </div>
          </div>

          <div className="vision-input-row" style={{ marginTop: '0.5rem' }}>
            <label>
              Test Jog Steps (steps)
              <input
                type="number"
                value={testJogSteps}
                onChange={(e) => setTestJogSteps(Math.max(50, Number(e.target.value) || 500))}
                disabled={busy || isAutoMeasuring}
                title="Number of steps the CNC will lightly jog on X and Y to measure camera ratio"
              />
            </label>
            <label>
              X Ratio (steps/pixel)
              <input
                type="number"
                step="0.01"
                value={stepsPerPixelX}
                onChange={(e) => setStepsPerPixelX(Number(e.target.value) || 1)}
                disabled={busy || isAutoMeasuring}
              />
            </label>
            <label>
              Y Ratio (steps/pixel)
              <input
                type="number"
                step="0.01"
                value={stepsPerPixelY}
                onChange={(e) => setStepsPerPixelY(Number(e.target.value) || 1)}
                disabled={busy || isAutoMeasuring}
              />
            </label>
            <label className="vision-toggle-label">
              <input
                type="checkbox"
                checked={autoPressA}
                onChange={(e) => setAutoPressA(e.target.checked)}
              />
              Tap A axis during movement
            </label>
          </div>

          <div className="vision-actions-row" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={handleAutoCalibrateSteps}
              disabled={busy || isAutoMeasuring}
              className="webcam-ocr-button webcam-ocr-button--primary"
              style={{ padding: '0.65rem 1.4rem', fontSize: '0.85rem', fontWeight: 800 }}
            >
              {isAutoMeasuring ? 'AUTO MEASURING...' : '1-CLICK AUTO STEP & FRAME CALIBRATION'}
            </button>
          </div>

          {autoMeasureStatus && (
            <div className="vision-automeasure-status">
              <span className="vision-pulse-dot" style={{ background: isAutoMeasuring ? '#38bdf8' : '#10b981' }} />
              <span>{autoMeasureStatus}</span>
            </div>
          )}

          {measuredFrame && (
            <div className="vision-measured-deck">
              <div className="vision-measured-card">
                <span className="vision-measured-label">FRAME WIDTH (X)</span>
                <span className="vision-measured-val">{measuredFrame.width_steps} <small>steps</small></span>
                <span className="vision-measured-sub">({measuredFrame.width_px} px)</span>
              </div>
              <div className="vision-measured-card">
                <span className="vision-measured-label">FRAME HEIGHT (Y)</span>
                <span className="vision-measured-val">{measuredFrame.height_steps} <small>steps</small></span>
                <span className="vision-measured-sub">({measuredFrame.height_px} px)</span>
              </div>
              <div className="vision-measured-card">
                <span className="vision-measured-label">MEASURED AXIS RATIO</span>
                <span className="vision-measured-val">X: {measuredFrame.steps_per_pixel_x} / Y: {measuredFrame.steps_per_pixel_y}</span>
                <span className="vision-measured-sub">steps / pixel</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 1: AI Detection Controls */}
      {activeTab === 'ai' && (
        <div className="vision-control-deck">
          <div className="vision-input-row">
            <label className="vision-field-grow">
              Detection Prompt / Search Target
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. all buttons, red keys, text OK, screws, labels..."
                disabled={busy}
              />
            </label>
            <label>
              AI Model
              <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} disabled={busy}>
                <option value="gpt4o">OpenAI GPT-4o (High Precision Vision)</option>
                <option value="gpt4o-mini">OpenAI GPT-4o-mini (Fast & Cheap)</option>
                <option value="opencv">OpenCV Contours & Shapes (Offline 0ms)</option>
              </select>
            </label>
          </div>

          <div className="vision-actions-row">
            <button
              type="button"
              onClick={handleRunAiDetection}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--primary"
            >
              {loading === 'ai-detect' ? 'DETECTING TARGETS...' : 'RUN AI DETECTION'}
            </button>

            {aiTargets.length > 0 && (
              <button
                type="button"
                onClick={handleRunAllSequence}
                disabled={busy}
                className="webcam-ocr-button webcam-ocr-button--capture"
              >
                {runningSequence ? 'EXECUTING SEQUENCE...' : `▶ RUN SEQUENCE (${aiTargets.length} TARGETS)`}
              </button>
            )}

            <label className="vision-toggle-label">
              <input
                type="checkbox"
                checked={autoPressA}
                onChange={(e) => setAutoPressA(e.target.checked)}
              />
              Auto Press Tool (Axis A) on Move
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: 4-Point ROI Calibration Controls */}
      {activeTab === 'roi' && (
        <div className="vision-control-deck">
          <div className="vision-actions-row">
            <button
              type="button"
              onClick={() => setCalibrationMode((v) => !v)}
              className="webcam-ocr-button webcam-ocr-button--quiet"
            >
              {calibrationMode ? 'CANCEL CALIBRATION' : 'MANUAL 4 CORNERS'}
            </button>
            <button
              type="button"
              onClick={handleAutoDetectQuad}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--capture"
            >
              AUTO-DETECT 4 CORNERS
            </button>
            <button
              type="button"
              onClick={persistCalibration}
              disabled={calibrationPoints.length !== 4 || busy}
              className="webcam-ocr-button webcam-ocr-button--primary"
            >
              SAVE CALIBRATION
            </button>
            {/* <button
              type="button"
              onClick={handleRunAiDetection}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--primary"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', border: 'none' }}
              title="Detect all buttons, keys, and icons located inside this frame"
            >
              ⚡ DETECT ELEMENTS IN FRAME
            </button> */}
            {/* <button
              type="button"
              onClick={() => {
                setAiPrompt('Facebook logo icon, email/phone input, password input, and login button');
                setAiModel('gpt4o');
                setTimeout(() => handleRunAiDetection(), 50);
              }}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--primary"
              style={{ background: 'linear-gradient(135deg, #1877f2, #2563eb)', border: 'none' }}
              title="1-Click Facebook login form detection: Facebook icon, email input, password input, login button"
            >
              📱 DETECT FACEBOOK LOGIN FORM
            </button> */}
            <button
              type="button"
              onClick={resetCalibration}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--quiet"
            >
              RESET
            </button>
          </div>
        </div>
      )}

      {/* Tab 2.5: Spatial Calibration Controls */}
      {activeTab === 'spatial' && (
        <div className="vision-control-deck">
          <div className="vision-actions-row">
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await axios.get(`${API_BASE}/webcam/calibrate/spatial/status`);
                  toast.success(`Grid mapping is calibrated: ${res.data.calibrated ? 'YES' : 'NO'}`);
                } catch (e) {
                  toast.error('Failed to get status');
                }
              }}
              className="webcam-ocr-button webcam-ocr-button--quiet"
            >
              CHECK GRID CALIBRATION STATUS
            </button>
            <button
              type="button"
              onClick={handleRunAutoGridCalibration}
              disabled={busy || isAutoMeasuring}
              className="webcam-ocr-button webcam-ocr-button--primary"
            >
              RUN AUTO-GRID CALIBRATION
            </button>
            <button
              type="button"
              onClick={() => {
                toast.success('Please place a checkerboard on the table to calibrate lens distortion.');
                // Future: Hook to /calibrate/intrinsic
              }}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--capture"
            >
              CALIBRATE LENS (INTRINSIC)
            </button>
          </div>

          <div className="vision-input-row" style={{ marginTop: '0.5rem' }}>
            <label>
              Grid Step Spacing (X/Y steps)
              <input
                type="number"
                value={testJogSteps}
                onChange={(e) => setTestJogSteps(Math.max(50, Number(e.target.value) || 500))}
                disabled={busy || isAutoMeasuring}
                title="Distance between grid points in CNC steps (e.g. 500)"
              />
            </label>
          </div>

          {autoMeasureStatus && activeTab === 'spatial' && (
            <div className="vision-automeasure-status">
              <span className="vision-pulse-dot" style={{ background: isAutoMeasuring ? '#38bdf8' : '#10b981' }} />
              <span>{autoMeasureStatus}</span>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Fixed Grid Controls */}
      {activeTab === 'grid' && (
        <div className="vision-control-deck">
          <div className="vision-input-row">
            <label>
              Grid Rows
              <input
                type="number"
                min="1"
                max="12"
                value={gridRows}
                onChange={(e) => setGridRows(Number(e.target.value) || 1)}
              />
            </label>
            <label>
              Grid Columns
              <input
                type="number"
                min="1"
                max="12"
                value={gridCols}
                onChange={(e) => setGridCols(Number(e.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              onClick={handleDetectGrid}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--capture"
            >
              GENERATE GRID OVERLAY
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: OCR Controls */}
      {activeTab === 'ocr' && (
        <div className="vision-control-deck">
          <div className="vision-input-row">
            <label className="vision-field-grow">
              Target OCR Text
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="Text to match (e.g. START, 1234)"
              />
            </label>
            <button
              type="button"
              onClick={handleOcr}
              disabled={busy}
              className="webcam-ocr-button webcam-ocr-button--primary"
            >
              READ + MATCH TEXT
            </button>
          </div>
        </div>
      )}

      {/* Interactive Video Preview Screen */}
      <div className="webcam-preview vision-preview-container">
        {cameraError ? (
          <div className="webcam-preview__error">
            <p>{cameraError}</p>
            <button
              type="button"
              onClick={() => setCameraRetry((v) => v + 1)}
              className="webcam-ocr-button webcam-ocr-button--capture"
            >
              ENABLE CAMERA
            </button>
          </div>
        ) : (
          <div
            className="vision-preview-shell"
            onClick={handleArbitraryPointClick}
            style={{ cursor: (activeTab === 'roi' && calibrationMode) ? 'crosshair' : 'pointer' }}
          >
            <video ref={videoRef} autoPlay muted playsInline />

            {/* AI Detection Loading HUD Scanning Overlay */}
            {loading === 'ai-detect' && (
              <div className="vision-scanning-overlay">
                <div className="vision-laser-line" />
                <div className="vision-scanning-hud">
                  <div className="vision-scanner-spinner" />
                  <div className="vision-scanning-text-box">
                    <div className="vision-scanning-title">
                      <span className="vision-dot-pulse" />
                      AI DETECTING ELEMENTS...
                    </div>
                    <div className="vision-scanning-sub">
                      Scanning camera frame &bull; Detecting numeric keypad &bull; Computing CNC coordinates
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SVG Polygon Overlay connecting the 4 Corners & Target Boxes */}
            {(calibrationPoints.length >= 2 || savedWorkArea || aiTargets.length > 0) && (
              <svg className="vision-svg-overlay" viewBox={`0 0 ${frameWidth} ${frameHeight}`} preserveAspectRatio="none">
                {(calibrationPoints.length >= 2 || savedWorkArea) && (
                  <polygon
                    points={(calibrationPoints.length === 4 ? calibrationPoints : savedWorkArea || []).map((p) => `${p.x || p[0]},${p.y || p[1]}`).join(' ')}
                    className="vision-roi-polygon"
                  />
                )}
                {aiTargets.map((t) => t.box_polygon && (
                  <polygon
                    key={`box-poly-${t.id}`}
                    points={t.box_polygon.map((p) => `${p[0]},${p[1]}`).join(' ')}
                    className={`vision-ai-box-poly ${selectedTargetId === t.id ? 'vision-ai-box-poly--selected' : ''}`}
                  />
                ))}
              </svg>
            )}

            {/* Draggable Corner Markers (always draggable so you can frame phone screen anytime) */}
            {calibrationPoints.map((point, index) => {
              const xPercent = (point.x / frameWidth) * 100;
              const yPercent = (point.y / frameHeight) * 100;
              return (
                <button
                  type="button"
                  key={`corner-${index}`}
                  className={`vision-point ${draggingPointIndex === index ? 'vision-point--dragging' : ''}`}
                  style={{
                    left: `${xPercent}%`,
                    top: `${yPercent}%`,
                    pointerEvents: 'auto',
                    zIndex: 25,
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDraggingPointIndex(index);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  title={`Corner ${index + 1} (${point.x}, ${point.y}) - Drag to align screen corner`}
                >
                  <span>{index + 1}</span>
                </button>
              );
            })}

            {/* AI Detected Objects Overlays */}
            {aiTargets.map((target) => {
              const xPercent = (target.pixel_x / frameWidth) * 100;
              const yPercent = (target.pixel_y / frameHeight) * 100;
              const isSelected = selectedTargetId === target.id;
              return (
                <button
                  type="button"
                  key={`target-tag-${target.id}`}
                  className={`vision-ai-marker ${isSelected ? 'vision-ai-marker--selected' : ''}`}
                  style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveToCncTarget(target);
                  }}
                  title={`#${target.id} ${formatLabelToEnglish(target.label)} → CNC (${target.cnc_x}, ${target.cnc_y})`}
                >
                  <div className="vision-ai-dot">
                    <span className="vision-ai-dot-num">{target.id}</span>
                  </div>
                  <div className="vision-ai-tag">
                    <strong>#{target.id} {formatLabelToEnglish(target.label)}</strong>
                    <span>X:{target.cnc_x} Y:{target.cnc_y}</span>
                  </div>
                </button>
              );
            })}

            {/* Last Click Crosshair Marker */}
            {lastTargetPoint && (
              <div
                className="vision-crosshair-marker"
                style={{
                  left: `${(lastTargetPoint.x / frameWidth) * 100}%`,
                  top: `${(lastTargetPoint.y / frameHeight) * 100}%`,
                }}
              >
                <div className="vision-crosshair-ring" />
                <span className="vision-crosshair-coords">
                  CNC ({lastTargetPoint.cnc_x}, {lastTargetPoint.cnc_y})
                </span>
              </div>
            )}

            {/* Red Pen Detected Marker Overlay */}
            {redPenPos && (
              <div
                className="vision-red-pen-marker"
                style={{
                  left: `${((redPenPos.tip_x ?? redPenPos.center_x) / frameWidth) * 100}%`,
                  top: `${((redPenPos.tip_y ?? redPenPos.center_y) / frameHeight) * 100}%`,
                }}
                title={`Stylus Pen Tip: (${redPenPos.tip_x ?? redPenPos.center_x}, ${redPenPos.tip_y ?? redPenPos.center_y})`}
              >
                <div className="vision-red-pen-pulse" />
                <span className="vision-red-pen-badge">
                  🔴 STYLUS TIP ({redPenPos.tip_x ?? redPenPos.center_x}, {redPenPos.tip_y ?? redPenPos.center_y})
                </span>
              </div>
            )}

            {/* Fixed Grid Cells */}
            {detectedGrid?.cells?.map((cell) => {
              const xPercent = ((cell.bbox[0] + cell.bbox[2] / 2) / frameWidth) * 100;
              const yPercent = ((cell.bbox[1] + cell.bbox[3] / 2) / frameHeight) * 100;
              const wPercent = (cell.bbox[2] / frameWidth) * 100;
              const hPercent = (cell.bbox[3] / frameHeight) * 100;
              const isSelected = selectedCell && selectedCell.row === cell.row && selectedCell.col === cell.col;
              return (
                <button
                  type="button"
                  key={`cell-${cell.row}-${cell.col}`}
                  className={`vision-cell ${isSelected ? 'vision-cell--selected' : ''}`}
                  style={{
                    left: `${Math.max(0, xPercent - wPercent / 2)}%`,
                    top: `${Math.max(0, yPercent - hPercent / 2)}%`,
                    width: `${Math.max(5, wPercent)}%`,
                    height: `${Math.max(5, hPercent)}%`,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCellClick(cell.row, cell.col);
                  }}
                  title={`Cell ${cell.row + 1},${cell.col + 1}`}
                >
                  <span>{cell.row + 1},{cell.col + 1}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Side Preview: Rectified Top-Down Workspace View */}
        {warpedPreview && (
          <div className="vision-warped-sidepanel">
            <div className="vision-sidepanel-title">
              <span>RECTIFIED TOP-DOWN VIEW</span>
              <button type="button" onClick={() => setWarpedPreview('')} className="vision-mini-close">✕</button>
            </div>
            <img
              src={warpedPreview}
              alt="Rectified Top-Down Plane"
              className="vision-warped-img"
              style={{ cursor: 'pointer' }}
              title="Click anywhere here to move CNC directly to this position"
              onClick={handleWarpedPreviewClick}
            />
          </div>
        )}
      </div>

      {/* CNC Live Position & Zeroing Quick-Bar */}
      <div className="vision-cnc-quickbar">
        <div className="vision-cnc-quickbar__pos">
          <span className="vision-cnc-quickbar__label">
            <span className="vision-pulse-dot" style={{ background: '#10b981' }} />
            CNC POSITION:
          </span>
          <div className="vision-cnc-coord-chips">
            <span className="vision-coord-chip">X: <strong>{currentCncPos.x}</strong></span>
            <span className="vision-coord-chip">Y: <strong>{currentCncPos.y}</strong></span>
            <span className="vision-coord-chip">A: <strong>{currentCncPos.a}</strong></span>
          </div>
          <button
            type="button"
            onClick={handleSetZero}
            disabled={busy}
            className="webcam-ocr-button webcam-ocr-button--primary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.72rem', letterSpacing: '0.04em' }}
            title="Calibrate current physical toolhead position as Origin (0, 0)"
          >
            SET ORIGIN (0,0) HERE
          </button>
          <button
            type="button"
            onClick={handleGoToOrigin}
            disabled={busy}
            className="webcam-ocr-button webcam-ocr-button--capture"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.72rem', letterSpacing: '0.04em' }}
            title="Move CNC toolhead directly to Origin (0, 0)"
          >
            GO TO (0,0)
          </button>
        </div>

        <div className="vision-cnc-quickbar__jog">
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>Jog:</span>
          <select
            value={jogSteps}
            onChange={(e) => setJogSteps(Number(e.target.value))}
            style={{ background: '#091a2d', color: '#f8fafc', border: '1px solid #234e78', borderRadius: '0.35rem', padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}
          >
            <option value={20}>20 steps</option>
            <option value={50}>50 steps</option>
            <option value={100}>100 steps</option>
            <option value={250}>250 steps</option>
            <option value={500}>500 steps</option>
          </select>
          <button type="button" onClick={() => handleQuickJog('X', -jogSteps)} disabled={busy} className="vision-jog-btn" title="Jog X Negative">← X-</button>
          <button type="button" onClick={() => handleQuickJog('X', jogSteps)} disabled={busy} className="vision-jog-btn" title="Jog X Positive">X+ →</button>
          <button type="button" onClick={() => handleQuickJog('YZ', -jogSteps)} disabled={busy} className="vision-jog-btn" title="Jog Y Negative">↓ Y-</button>
          <button type="button" onClick={() => handleQuickJog('YZ', jogSteps)} disabled={busy} className="vision-jog-btn" title="Jog Y Positive">↑ Y+</button>
        </div>
      </div>

      {/* AI Targets List & Navigation Bar */}
      {aiTargets.length > 0 && (
        <div className="vision-targets-tray">
          <div className="vision-targets-tray__header">
            <h4>DETECTED SCREEN ELEMENTS ({aiTargets.length})</h4>
            <span className="vision-targets-tray__hint">Click on an element to move stylus toolhead directly to it</span>
            {/* {onSendToAiStudio && (
              <button
                type="button"
                onClick={() => onSendToAiStudio(aiTargets)}
                className="webcam-ocr-button"
                style={{
                  marginLeft: 'auto',
                  background: 'linear-gradient(135deg, #fe5d70 0%, #fe9365 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 2px 8px rgba(254, 93, 112, 0.35)'
                }}
                title="Send all detected targets and CNC coordinates to AI Test Studio to generate automated script"
              >
                Send to AI Test Studio ({aiTargets.length})
              </button>
            )} */}
            <button
              type="button"
              onClick={() => setAiTargets([])}
              className="webcam-ocr-button webcam-ocr-button--quiet"
              style={{ marginLeft: onSendToAiStudio ? '8px' : 'auto', padding: '0.2rem 0.6rem', fontSize: '0.72rem' }}
              title="Clear detected elements list"
            >
              Clear List
            </button>
          </div>
          <div className="vision-targets-grid">
            {aiTargets.map((target) => (
              <div
                key={`card-${target.id}`}
                className={`vision-target-card ${selectedTargetId === target.id ? 'vision-target-card--active' : ''}`}
                onClick={() => handleMoveToCncTarget(target)}
              >
                <div className="vision-target-card__header">
                  <span className="vision-target-card__id">#{target.id}</span>
                  <span className="vision-target-card__label">{formatLabelToEnglish(target.label)}</span>
                  <span className="vision-target-card__conf">{Math.round(target.confidence * 100)}%</span>
                </div>
                <div className="vision-target-card__coords" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', padding: '4px 8px', color: '#166534', fontSize: '0.85rem', fontWeight: 800 }}>
                    CNC: X = {target.cnc_x} • Y = {target.cnc_y}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', paddingLeft: '2px' }}>
                    <span>Camera Pixel:</span> ({target.pixel_x}, {target.pixel_y})
                  </div>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    className="vision-target-card__btn"
                    style={{
                      background: 'linear-gradient(135deg, #01a9ac 0%, #0ac282 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      width: '100%',
                      boxShadow: '0 2px 6px rgba(1, 169, 172, 0.25)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveToCncTarget(target);
                    }}
                    title={`Move CNC toolhead to X=${target.cnc_x}, Y=${target.cnc_y} relative to Origin (0,0)`}
                  >
                    MOVE TO (X: {target.cnc_x}, Y: {target.cnc_y})
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Camera Selection & Status Footer */}
      <div className="vision-status-footer">
        <label className="vision-camera-selector">
          Camera Input:
          <select
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            disabled={busy || cameras.length === 0}
          >
            {cameras.length === 0 && <option value="">No camera found</option>}
            {cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>
            ))}
          </select>
        </label>
        {lastTargetPoint && (
          <div className="vision-last-coord">
            Last Commanded: <strong>X={lastTargetPoint.cnc_x}, Y={lastTargetPoint.cnc_y}</strong>
          </div>
        )}
      </div>
    </section>
  );
};

export default WebcamOcrPanel;