import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE = 'http://localhost:8000/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Lightweight luma sampling helpers (used by the execution displacement watchdog) ----
const WATCH_SAMPLE_DIM = 128;
const WATCH_GRID_SIZE = 8;
const WATCH_BLOCK_SIZE = WATCH_SAMPLE_DIM / WATCH_GRID_SIZE;
const WATCH_BLOCK_CHANGE_THRESHOLD = 9.0;

function getWorkAreaCropRect(video, workArea) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  if (Array.isArray(workArea) && workArea.length >= 4) {
    const xs = workArea.map((p) => (Array.isArray(p) ? p[0] : (p?.x ?? 0)));
    const ys = workArea.map((p) => (Array.isArray(p) ? p[1] : (p?.y ?? 0)));
    const minX = Math.max(0, Math.min(...xs));
    const minY = Math.max(0, Math.min(...ys));
    const maxX = Math.min(vw, Math.max(...xs));
    const maxY = Math.min(vh, Math.max(...ys));
    if (maxX - minX >= 40 && maxY - minY >= 40) {
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return { x: 0, y: 0, w: vw, h: vh };
}

function sampleWorkAreaLuma(video, workArea, ctx) {
  if (!video || video.readyState < 2 || !video.videoWidth || !ctx) return null;
  const crop = getWorkAreaCropRect(video, workArea);
  ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, WATCH_SAMPLE_DIM, WATCH_SAMPLE_DIM);
  const data = ctx.getImageData(0, 0, WATCH_SAMPLE_DIM, WATCH_SAMPLE_DIM).data;
  const luma = new Uint8Array(WATCH_SAMPLE_DIM * WATCH_SAMPLE_DIM);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    luma[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return luma;
}

function lumaMeanDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// 64-block spatial diff: separates global changes (POS moved / new page) from local ones (stylus on a key)
function lumaBlockDiff(curr, base) {
  if (!curr || !base || curr.length !== base.length) {
    return { avgDiff: 0, changedBlockRatio: 0, changedBlocks: 0 };
  }
  let totalDiff = 0;
  let changedBlocks = 0;
  for (let by = 0; by < WATCH_GRID_SIZE; by += 1) {
    for (let bx = 0; bx < WATCH_GRID_SIZE; bx += 1) {
      let blockSum = 0;
      for (let y = 0; y < WATCH_BLOCK_SIZE; y += 1) {
        const rowStart = (by * WATCH_BLOCK_SIZE + y) * WATCH_SAMPLE_DIM;
        for (let x = 0; x < WATCH_BLOCK_SIZE; x += 1) {
          const idx = rowStart + (bx * WATCH_BLOCK_SIZE + x);
          blockSum += Math.abs(curr[idx] - base[idx]);
        }
      }
      totalDiff += blockSum;
      if (blockSum / (WATCH_BLOCK_SIZE * WATCH_BLOCK_SIZE) >= WATCH_BLOCK_CHANGE_THRESHOLD) changedBlocks += 1;
    }
  }
  return {
    avgDiff: totalDiff / (WATCH_SAMPLE_DIM * WATCH_SAMPLE_DIM),
    changedBlockRatio: changedBlocks / (WATCH_GRID_SIZE * WATCH_GRID_SIZE),
    changedBlocks,
  };
}

export function formatLabelToEnglish(label) {
  if (!label) return 'Target Element';
  // Strip the backend multi-device prefix ("D1 Purchase", "D2 Refund"): its digit must never be read as a key number
  const l = String(label).trim().replace(/^d\d+\s+/i, '');
  const lower = l.toLowerCase();

  // Normalize numbers 0-9 ONLY when the whole label is a key: "nut 1", "nút 1", "phím 1", "key 1", "button 1", "btn_1", "1".
  // (Previously any label containing a lone digit, e.g. "D1 Purchase" or "Pay 100", was turned into "Key N".)
  const m = lower.match(/^(?:nut|nút|phim|phím|key|button|btn|số|so)?\s*[-_#]?\s*([0-9])$/);
  if (m) {
    return `Key ${m[1]}`;
  }

  if (lower.includes('pay now') || lower.includes('paynow')) return 'Pay Now Button';
  if (lower.includes('tap to pay') || lower.includes('contactless') || lower.includes('tap')) return 'Tap to Pay';
  if (lower.includes('insert card') || lower.includes('insert')) return 'Insert Card';
  if (lower.includes('swipe card') || lower.includes('swipe')) return 'Swipe Card';
  if (lower.includes('purchase')) return 'Purchase';
  if (lower.includes('payment')) return 'Payment Icon';
  if (lower.includes('thanh toan') || lower.includes('thanh toán') || lower.includes('pay')) return 'Pay Button';
  if (lower.includes('huy') || lower.includes('hủy') || lower.includes('cancel')) return 'Cancel Button';
  if (lower.includes('enter') || lower.includes('ok')) return 'Enter / OK Key';
  if (lower.includes('tiep tuc') || lower.includes('tiếp tục') || lower.includes('continue') || lower.includes('next')) return 'Next / Continue Button';
  if (lower.includes('xac nhan') || lower.includes('xác nhận') || lower.includes('confirm')) return 'Confirm Button';
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

  // Next / Continue / Confirm button for screen transitions
  if (
    targetClean.includes('tiep tuc') ||
    targetClean.includes('continue') ||
    targetClean.includes('next') ||
    targetClean.includes('xac nhan') ||
    targetClean.includes('confirm') ||
    targetClean.includes('dong y') ||
    targetClean.includes('submit') ||
    targetClean.includes('hoan tat')
  ) {
    const nextMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return (
        dLabel.includes('tiep tuc') ||
        dLabel.includes('continue') ||
        dLabel.includes('next') ||
        dLabel.includes('xac nhan') ||
        dLabel.includes('confirm') ||
        dLabel.includes('dong y') ||
        dLabel.includes('submit') ||
        dLabel.includes('hoan tat')
      );
    });
    if (nextMatch) return nextMatch;
  }

  // POS Specific buttons: Payment Icon, Purchase, Tap/Insert/Swipe, Pay Now
  if (targetClean.includes('payment') || targetClean.includes('purchase') || targetClean.includes('tap') || targetClean.includes('insert') || targetClean.includes('swipe') || targetClean.includes('pay now') || targetClean.includes('paynow')) {
    const posMatch = detectedList.find((d) => {
      const dLabel = (d.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (targetClean.includes('purchase') && dLabel.includes('purchase')) return true;
      if (targetClean.includes('payment') && dLabel.includes('payment')) return true;
      if (targetClean.includes('tap') && (dLabel.includes('tap') || dLabel.includes('contactless'))) return true;
      if (targetClean.includes('insert') && dLabel.includes('insert')) return true;
      if (targetClean.includes('swipe') && dLabel.includes('swipe')) return true;
      if ((targetClean.includes('pay now') || targetClean.includes('paynow')) && (dLabel.includes('pay now') || dLabel.includes('paynow') || dLabel.includes('pay'))) return true;
      return false;
    });
    if (posMatch) return posMatch;
  }

  // Amount input field or denomination buttons (e.g. 500k, 100k, 200k)
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
  setTestScript = null,
  aiTargets: externalAiTargets = null,
  setAiTargets: setExternalAiTargets = null,
  onSendToAiStudio = null,
  onStepUpdate = null,
  onCompleteExecution = null,
  isExecutingScript = false,
  onSwitchToAiStudio = null,
  sharedStream = null,
  cameras: propCameras = null,
  cameraId: propCameraId = '',
  setCameraId: propSetCameraId = null,
}) => {
  const stopScriptRef = useRef(false);
  // Navigation tabs: 'ai' | 'roi' | 'grid' | 'ocr'
  const [activeTab, setActiveTab] = useState('ai');
  const [currentExecutingStep, setCurrentExecutingStep] = useState(null);

  // Camera & preview states
  const [localCameras, setLocalCameras] = useState([]);
  const cameras = propCameras && propCameras.length > 0 ? propCameras : localCameras;
  const setCameras = setLocalCameras;
  const [localCameraId, setLocalCameraId] = useState('');
  const cameraId = propCameraId !== undefined && propCameraId !== '' ? propCameraId : localCameraId;
  const setCameraId = propSetCameraId || setLocalCameraId;
  const [cameraRetry, setCameraRetry] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [capturedImage, setCapturedImage] = useState('');
  const [loading, setLoading] = useState('');

  // 4-Point ROI Calibration states
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [cncCalibrationPoints, setCncCalibrationPoints] = useState([null, null, null, null]);
  const [draggingPointIndex, setDraggingPointIndex] = useState(null);
  const [savedWorkArea, setSavedWorkArea] = useState(null);

  // CNC Machine physical bounds & offset
  const [originX, setOriginX] = useState(-200);
  const [originY, setOriginY] = useState(0);
  const [cncWidth, setCncWidth] = useState(-380);
  const [cncHeight, setCncHeight] = useState(-460);
  const [cameraOffsetX, setCameraOffsetX] = useState(0);
  const [cameraOffsetY, setCameraOffsetY] = useState(0);
  const [autoPressA, setAutoPressA] = useState(false);
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(true);
  const [swapXY, setSwapXY] = useState(false);
  const [key1X, setKey1X] = useState(-50);
  const [key1Y, setKey1Y] = useState(-170);
  const [spacingX, setSpacingX] = useState(-100);
  const [spacingY, setSpacingY] = useState(-100);
  const [jogSteps, setJogSteps] = useState(100);
  const [currentCncPos, setCurrentCncPos] = useState({ x: 0, y: 0, a: 0 });

  // AI Target Detection states
  const [aiPrompt, setAiPrompt] = useState('All keypad keys 0-9, Clear C, Backspace, Cancel button, Pay button, and app icons on POS screen');
  const [aiModel, setAiModel] = useState('hybrid');
  const [openaiApiKey, setOpenaiApiKey] = useState(() => localStorage.getItem('cnc_openai_api_key') || '');
  const [openaiStatus, setOpenaiStatus] = useState({ configured: false, masked_key: '' });
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
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
  const [overlayMode, setOverlayMode] = useState(() => localStorage.getItem('cnc_overlay_mode') || 'box');
  const handleSetOverlayMode = (mode) => {
    setOverlayMode(mode);
    localStorage.setItem('cnc_overlay_mode', mode);
  };
  const handleDeleteTarget = (id) => {
    setAiTargets(aiTargets.filter((t) => t.id !== id));
    setSelectedTargetId((cur) => (cur === id ? null : cur));
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' || selectedTargetId == null) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      handleDeleteTarget(selectedTargetId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTargetId, aiTargets]);
  const [lastTargetPoint, setLastTargetPoint] = useState(null);
  const [runningSequence, setRunningSequence] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedSnapshot, setLockedSnapshot] = useState(null);
  const [parkCornerIndex, setParkCornerIndex] = useState(0);

  // Load persisted setup lock from backend on mount
  useEffect(() => {
    axios.get(`${API_BASE}/webcam/setup-lock`)
      .then((res) => {
        if (res.data?.is_locked && res.data?.data) {
          const d = res.data.data;
          if (d.targets && d.targets.length > 0) {
            setAiTargets(d.targets);
            setIsLocked(true);
            if (d.snapshot) setLockedSnapshot(d.snapshot);
            if (d.work_area && d.work_area.length === 4) {
              setSavedWorkArea(d.work_area);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

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

  // Model AI YOLO Preload & Warmup states
  const [modelStatus, setModelStatus] = useState(null);
  const [isWarmingUp, setIsWarmingUp] = useState(false);

  const fetchModelStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/webcam/model-status`);
      if (res.data) {
        setModelStatus(res.data);
        return res.data;
      }
    } catch {
      // Ignore
    }
    return null;
  };

  const handleWarmupModel = async (showToast = true) => {
    setIsWarmingUp(true);
    let tId = null;
    if (showToast) tId = toast.loading('Pre-loading YOLO model & OpenAI GPT-4o...');
    try {
      const res = await axios.post(`${API_BASE}/webcam/model-warmup`);
      if (res.data) {
        setModelStatus((prev) => ({
          ...prev,
          yolo_element_loaded: Boolean(res.data.yolo_element),
          openai_ready: Boolean(res.data.openai),
          hybrid_ready: Boolean(res.data.yolo_element && res.data.openai),
        }));
        if (showToast) {
          const gptPart = res.data.openai ? ' & OpenAI GPT-4o' : '';
          toast.success(`YOLO model (best.pt)${gptPart} pre-loaded! Detection will respond instantly.`, { id: tId });
        }
      }
    } catch (err) {
      if (showToast) toast.error('Unable to load model: ' + (err.message || 'Server error'), { id: tId });
    } finally {
      setIsWarmingUp(false);
      fetchModelStatus();
    }
  };

  // Target renaming & mapping to script steps
  const handleUpdateTargetLabel = (targetId, newLabel) => {
    const updated = aiTargets.map((t) => (t.id === targetId ? { ...t, label: newLabel } : t));
    setAiTargets(updated);
  };

  const handleMapTargetToStep = (target, stepIdxStr) => {
    if (stepIdxStr === '' || stepIdxStr == null) return;
    const sIdx = Number(stepIdxStr);
    const step = activeTestScript && activeTestScript[sIdx];
    if (!step) return;

    const assignedLabel = step.target || target.label;
    const updatedTargets = aiTargets.map((t) =>
      t.id === target.id
        ? { ...t, label: assignedLabel, mappedStepIndex: sIdx, mappedStepName: step.target }
        : t
    );
    setAiTargets(updatedTargets);

    if (setTestScript) {
      setTestScript((prev) => {
        const next = [...prev];
        if (next[sIdx]) {
          next[sIdx] = {
            ...next[sIdx],
            cnc_x: target.cnc_x,
            cnc_y: target.cnc_y,
            pixel_x: target.pixel_x,
            pixel_y: target.pixel_y,
            mappedTargetId: target.id,
          };
        }
        return next;
      });
    }

    toast.success(`Assigned Target #${target.id} (${assignedLabel}) to Step #${sIdx + 1} (CNC Coords: X=${target.cnc_x}, Y=${target.cnc_y})`);
  };

  const handleAutoMapToScript = () => {
    if (!activeTestScript || !Array.isArray(activeTestScript) || activeTestScript.length === 0) {
      toast.error('No test script found to map!');
      return;
    }
    if (!aiTargets || aiTargets.length === 0) {
      toast.error('No targets detected on camera yet!');
      return;
    }

    const clickSteps = activeTestScript
      .map((s, idx) => ({ ...s, originalIdx: idx }))
      .filter((s) => s.action === 'CLICK' || s.action === 'TYPE');

    let mappedCount = 0;
    const updatedTargets = [...aiTargets];
    const updatedScript = setTestScript ? [...activeTestScript] : null;

    // Sort targets by reading order: top to bottom, left to right
    const sortedTargets = [...updatedTargets].sort((a, b) => {
      const yDiff = (a.pixel_y || 0) - (b.pixel_y || 0);
      if (Math.abs(yDiff) > 30) return yDiff;
      return (a.pixel_x || 0) - (b.pixel_x || 0);
    });

    sortedTargets.forEach((target, orderIdx) => {
      if (orderIdx < clickSteps.length) {
        const step = clickSteps[orderIdx];
        const sIdx = step.originalIdx;
        const targetIdx = updatedTargets.findIndex((t) => t.id === target.id);
        if (targetIdx >= 0) {
          updatedTargets[targetIdx] = {
            ...updatedTargets[targetIdx],
            label: step.target || updatedTargets[targetIdx].label,
            mappedStepIndex: sIdx,
            mappedStepName: step.target,
          };
          if (updatedScript && updatedScript[sIdx]) {
            updatedScript[sIdx] = {
              ...updatedScript[sIdx],
              cnc_x: target.cnc_x,
              cnc_y: target.cnc_y,
              pixel_x: target.pixel_x,
              pixel_y: target.pixel_y,
              mappedTargetId: target.id,
            };
          }
          mappedCount += 1;
        }
      }
    });

    setAiTargets(updatedTargets);
    if (updatedScript && setTestScript) {
      setTestScript(updatedScript);
    }
    toast.success(`Automatically mapped ${mappedCount} targets to script steps!`);
  };

  useEffect(() => {
    axios.get(`${API_BASE}/webcam/ocr-engine`)
      .then((response) => setEngine(response.data.engine))
      .catch(() => { });
    axios.get(`${API_BASE}/webcam/openai-status`)
      .then((res) => { if (res.data) setOpenaiStatus(res.data); })
      .catch(() => { });
    fetchModelStatus().then((status) => {
      if (!status?.yolo_element_loaded) {
        handleWarmupModel(false);
      }
    });
    refreshCncStatus();
    const timer = setInterval(refreshCncStatus, 2500);
    return () => clearInterval(timer);
  }, []);

  const handleSaveOpenAiKey = async () => {
    if (!openaiApiKey.trim()) {
      toast.error('Please enter an API Key');
      return;
    }
    setIsSavingKey(true);
    const toastId = toast.loading('Verifying and saving OpenAI API Key...');
    try {
      const res = await axios.post(`${API_BASE}/webcam/openai-key`, { api_key: openaiApiKey.trim() });
      localStorage.setItem('cnc_openai_api_key', openaiApiKey.trim());
      toast.success(res.data.message || 'API Key saved successfully!', { id: toastId });
      setShowKeyInput(false);
      const statusRes = await axios.get(`${API_BASE}/webcam/openai-status`);
      if (statusRes.data) setOpenaiStatus(statusRes.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save API Key', { id: toastId });
    } finally {
      setIsSavingKey(false);
    }
  };

  useEffect(() => {
    if (sharedStream) {
      if (videoRef.current) {
        videoRef.current.srcObject = sharedStream;
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    let active = true;
    const startCamera = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
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
  }, [sharedStream, cameraId, cameraRetry]);

  const cncActiveUntilRef = useRef(0);
  const markCncMoving = (extraMs = 1800) => {
    cncActiveUntilRef.current = Date.now() + extraMs;
  };

  const runAction = async (action, callback) => {
    const isCncMotion = /jog|move|cnc|point|zero|origin|calibrate/i.test(action);
    if (isCncMotion) {
      markCncMoving(15000);
    }
    setLoading(action);
    try {
      await callback();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || 'Action failed');
    } finally {
      setLoading('');
      if (isCncMotion) {
        markCncMoving(1800);
      }
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

  // Dragging AI-detected target markers (manual correction)
  const [draggingTargetId, setDraggingTargetId] = useState(null);
  const dragTargetMovedRef = useRef(false);
  const dragTargetLastRef = useRef(null);

  useEffect(() => {
    if (draggingTargetId === null) return undefined;

    const handlePointerMove = (event) => {
      const point = getPointerPosition(event);
      dragTargetMovedRef.current = true;
      dragTargetLastRef.current = point;
      setAiTargets((targets) => targets.map((t) => {
        if (t.id !== draggingTargetId) return t;
        const dx = point.x - t.pixel_x;
        const dy = point.y - t.pixel_y;
        return {
          ...t,
          pixel_x: point.x,
          pixel_y: point.y,
          center_x: point.x,
          center_y: point.y,
          box_polygon: t.box_polygon ? t.box_polygon.map((p) => [p[0] + dx, p[1] + dy]) : t.box_polygon,
        };
      }));
    };

    const handlePointerUp = async () => {
      const id = draggingTargetId;
      const point = dragTargetLastRef.current;
      setDraggingTargetId(null);
      if (!dragTargetMovedRef.current || !point) return;
      try {
        const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
        const res = await axios.post(`${API_BASE}/webcam/map-pixel`, {
          pixel_x: point.x,
          pixel_y: point.y,
          work_area: activeWorkArea,
          origin_x: originX,
          origin_y: originY,
          camera_offset_x: cameraOffsetX,
          camera_offset_y: cameraOffsetY,
          cnc_width: cncWidth,
          cnc_height: cncHeight,
        });
        setAiTargets((targets) => targets.map((t) => (
          t.id === id ? { ...t, cnc_x: res.data.cnc_x, cnc_y: res.data.cnc_y } : t
        )));
      } catch (err) {
        toast.error(err.response?.data?.detail || 'Failed to update CNC coordinates after drag');
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingTargetId]);

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

    // Click-to-add manual target mode
    if (addCustomTargetMode) {
      setAddCustomTargetMode(false);
      const label = window.prompt('Enter element name (e.g., Key 7, OK, Cancel):', `Target ${aiTargets.length + 1}`);
      if (label && label.trim()) {
        try {
          const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
          const res = await axios.post(`${API_BASE}/webcam/map-pixel`, {
            pixel_x: x,
            pixel_y: y,
            work_area: activeWorkArea,
            origin_x: originX,
            origin_y: originY,
            camera_offset_x: cameraOffsetX,
            camera_offset_y: cameraOffsetY,
            cnc_width: cncWidth,
            cnc_height: cncHeight,
          });
          const newTarget = {
            id: aiTargets.length > 0 ? Math.max(...aiTargets.map((t) => t.id || 0)) + 1 : 1,
            label: formatLabelToEnglish(label.trim()),
            pixel_x: Math.round(x),
            pixel_y: Math.round(y),
            cnc_x: res.data.cnc_x,
            cnc_y: res.data.cnc_y,
            width: 44,
            height: 44,
            confidence: 1.0,
            manual: true,
            box_polygon: [
              [Math.round(x) - 22, Math.round(y) - 22],
              [Math.round(x) + 22, Math.round(y) - 22],
              [Math.round(x) + 22, Math.round(y) + 22],
              [Math.round(x) - 22, Math.round(y) + 22],
            ],
          };
          setAiTargets((prev) => [...prev, newTarget]);
          toast.success(`Added "${newTarget.label}" at CNC (X: ${newTarget.cnc_x}, Y: ${newTarget.cnc_y})!`);
        } catch (err) {
          toast.error(err.response?.data?.detail || 'Failed to map coordinates for custom target');
        }
      }
      return;
    }

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

    const cncX = Math.round(originX + ratioX * cncWidth + cameraOffsetX);
    const cncY = Math.round(originY + ratioY * cncHeight + cameraOffsetY);

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
      toast.success('Origin Zero (0, 0) set at current physical toolhead position!');
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

  // Park CNC to Safe Corner (Default: Corner 0 / Top-Left of calibrated workbed)
  const handleParkToCorner = async (cornerIdx = 0) => {
    await runAction('park-cnc', async () => {
      const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
      if (!activeWorkArea || activeWorkArea.length < 4) {
        toast.error('Workspace 4-corner frame not found. Please click "Scan 4-Corner Frame" or calibrate the 4 corners first!');
        return;
      }
      const corner = activeWorkArea[cornerIdx];
      const px = Array.isArray(corner) ? corner[0] : (corner?.x ?? 0);
      const py = Array.isArray(corner) ? corner[1] : (corner?.y ?? 0);

      toast.loading(`Calculating coordinates and moving CNC to Corner ${cornerIdx + 1}...`, { id: 'park-cnc' });
      await ensureArduinoConnected();

      const mapRes = await axios.post(`${API_BASE}/webcam/map-pixel`, {
        pixel_x: px,
        pixel_y: py,
        work_area: activeWorkArea,
        origin_x: originX,
        origin_y: originY,
        cnc_width: cncWidth,
        cnc_height: cncHeight,
        camera_offset_x: cameraOffsetX,
        camera_offset_y: cameraOffsetY,
      });

      const { cnc_x, cnc_y } = mapRes.data;

      await axios.post(`${API_BASE}/cnc/park`, {
        target_x: cnc_x,
        target_y: cnc_y,
        lift_a: true,
      });

      await refreshCncStatus();
      setParkCornerIndex(cornerIdx);
      markCncMoving(2000);
      toast.success(`CNC parked safely at Corner ${cornerIdx + 1} (X: ${Math.round(cnc_x)}, Y: ${Math.round(cnc_y)}). Camera viewport is clear!`, { id: 'park-cnc', duration: 4000 });
    });
  };

  // Lock targets after clean detection
  const handleLockSetup = async () => {
    if (!aiTargets || aiTargets.length === 0) {
      toast.error('No targets detected yet! Please click Detect Elements first.');
      return;
    }
    const currentFrame = captureFrame();
    const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);

    try {
      await axios.post(`${API_BASE}/webcam/setup-lock`, {
        work_area: activeWorkArea,
        targets: aiTargets,
        snapshot: currentFrame,
        is_locked: true,
      });
    } catch (e) {
      console.warn('Backend setup-lock save notice:', e);
    }

    setIsLocked(true);
    setLockedSnapshot(currentFrame);
    setLiveDetect(false); // Disable live re-scan so Z motion never wipes targets
    toast.success(`Locked ${aiTargets.length} key targets. Execute mode will not be affected by Z-axis movement.`, { duration: 4500 });
  };

  // Unlock to allow re-detecting or editing
  const handleUnlockSetup = async () => {
    try {
      await axios.delete(`${API_BASE}/webcam/setup-lock`);
    } catch (e) {
      console.warn('Backend setup-lock clear notice:', e);
    }
    setIsLocked(false);
    toast('Configuration unlocked. You can Re-Scan or edit keys freely.');
  };

  // Handle Multi-Screen transition: Park to Corner 0, wait for settle, capture clean frame and detect new screen elements
  // Park CNC at the safe corner (clear camera view), wait for the screen to settle, then re-run AI detection.
  // Used for: initial scan at execution start, screen transitions, and re-scan after the POS is moved.
  const parkAndRescan = async ({ label = 'Rescan', settleMs = 1600, promptFallback } = {}) => {
    toast.loading(`[${label}] Parking CNC to corner for clear camera viewport...`, { id: 'auto-run' });

    // 1. Move CNC to safe park position (Corner 0) with A lifted
    markCncMoving(30000);
    try {
      const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
      if (activeWorkArea && activeWorkArea.length >= 4) {
        const corner = activeWorkArea[parkCornerIndex || 0];
        const px = Array.isArray(corner) ? corner[0] : (corner?.x ?? 0);
        const py = Array.isArray(corner) ? corner[1] : (corner?.y ?? 0);
        const mapRes = await axios.post(`${API_BASE}/webcam/map-pixel`, {
          pixel_x: px,
          pixel_y: py,
          work_area: activeWorkArea,
          origin_x: originX,
          origin_y: originY,
          cnc_width: cncWidth,
          cnc_height: cncHeight,
          camera_offset_x: cameraOffsetX,
          camera_offset_y: cameraOffsetY,
        });
        await axios.post(`${API_BASE}/cnc/park`, {
          target_x: mapRes.data.cnc_x,
          target_y: mapRes.data.cnc_y,
          lift_a: true,
        });
        await refreshCncStatus();
      }
    } catch (parkErr) {
      console.warn('Park on transition error:', parkErr);
    } finally {
      markCncMoving(900);
    }

    // 2. Wait for phone app transition animation to finish and screen to settle
    await sleep(settleMs);

    // 3. Capture fresh frame
    let newFrame = captureFrame();
    if (!newFrame) {
      await new Promise((r) => setTimeout(r, 500));
      newFrame = captureFrame();
    }
    if (!newFrame) return null;

    toast.loading(`[${label}] Viewport clear. AI Vision is scanning and detecting elements...`, { id: 'auto-run' });

    try {
      const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
      const detectPrompt = aiPrompt.trim() || promptFallback || 'All keypad keys 0-9, Clear C, Backspace, Cancel button, Pay button, and app icons on POS screen';
      const detectRes = await axios.post(`${API_BASE}/webcam/ai-detect`, {
        image_data: newFrame,
        work_area: activeWorkArea,
        prompt: detectPrompt,
        model_type: aiModel || 'hybrid',
        cnc_width: cncWidth,
        cnc_height: cncHeight,
        invert_x: invertX,
        invert_y: invertY,
        swap_xy: swapXY,
      });

      if (detectRes.data?.success && detectRes.data?.objects) {
        const newDetected = detectRes.data.objects.map((obj) => ({
          ...obj,
          label: formatLabelToEnglish(obj.label),
        }));
        setAiTargets(newDetected);
        if (detectRes.data.warped_preview) setWarpedPreview(detectRes.data.warped_preview);
        toast.success(`[${label}] Successfully detected ${newDetected.length} elements!`, { id: 'auto-run', duration: 4000 });
        return newDetected;
      }
    } catch (e) {
      console.warn('Screen transition AI detect warning:', e);
      toast.error(`[${label}] Unable to scan screen: ${e.message}`, { id: 'auto-run' });
    }
    return null;
  };

  const handlePerformScreenTransition = (stepIdx) => parkAndRescan({
    label: `Transition #${stepIdx + 1}`,
    settleMs: 1600,
  });



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
      prompt: aiPrompt.trim() || 'All keypad keys 0-9, Clear C, Backspace, Cancel button, Pay button, and app icons on POS screen',
      model_type: aiModel,
      api_key: openaiApiKey.trim() || undefined,
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

  // ---- Realtime YOLO over WebSocket: stream frames continuously, overlay updates live ----
  // ---- Smart Auto-Detect on Screen Change over WebSocket ----
  // Continuously monitors the screen area for transitions/motion.
  // When motion stops and screen settles (~400ms), triggers 2-pass consensus detection and locks coordinates.
  const [liveDetect, setLiveDetect] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [addCustomTargetMode, setAddCustomTargetMode] = useState(false);
  const liveCfgRef = useRef(null);
  const forceDetectRef = useRef(null);

  // freshest settings for the stream (sent to the server when detecting)
  liveCfgRef.current = {
    orig_width: videoRef.current?.videoWidth || 0,
    work_area: (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea),
    origin_x: originX,
    origin_y: originY,
    camera_offset_x: cameraOffsetX,
    camera_offset_y: cameraOffsetY,
    cnc_width: cncWidth,
    cnc_height: cncHeight,
  };

  useEffect(() => {
    if (!liveDetect || runningSequence || isExecutingScript) {
      setLiveStatus(liveDetect ? 'Paused (CNC running)' : '');
      forceDetectRef.current = null;
      return undefined;
    }

    const SEND_WIDTH = 640;
    const SAMPLE_DIM = 128;
    const GRID_SIZE = 8;             // 8x8 = 64 spatial blocks covering phone screen
    const BLOCK_SIZE = 16;           // 16x16 = 256 pixels per block
    const BLOCK_CHANGE_THRESHOLD = 9.0;  // Threshold for a single block to be considered modified
    const MIN_GLOBAL_BLOCK_RATIO = 0.28; // At least 28% of screen blocks (>= 18/64) must change to confirm a real page transition
    const MOTION_THRESHOLD = 7.5;    // Higher threshold: ignore camera noise and mechanical vibrations
    const MIN_SCREEN_CHANGE = 8.2;   // Significant difference from baseline to confirm real new page
    const SETTLE_DELAY_MS = 450;     // Wait 450ms stationary: page finished loading & stylus gone

    let stopped = false;
    let ws = null;
    let retryTimer = null;
    let checkInterval = null;
    let isDetecting = false;
    let justFinishedCncMotion = false;

    // Request tracking: watchdog (avoid freezing) + luma at send time (discard stale results)
    let detectWatchdog = null;
    let sentLuma = null;
    const clearWatchdog = () => { clearTimeout(detectWatchdog); detectWatchdog = null; };
    const setStatus = (text) => setLiveStatus((cur) => (cur === text ? cur : text));

    // Screen change tracking state
    let baselineLuma = null;
    let prevLuma = null;
    let stableStartTime = null;
    let screenState = 'INIT'; // 'INIT' | 'DETECTING' | 'STABLE' | 'CHANGING'

    // Off-screen sampling canvas (128x128 for lightweight ~0.2ms diff check)
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = SAMPLE_DIM;
    sampleCanvas.height = SAMPLE_DIM;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    // Detection frame canvas (640px)
    const sendCanvas = document.createElement('canvas');

    const getCropRect = (video, workArea) => {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      if (Array.isArray(workArea) && workArea.length >= 4) {
        const xs = workArea.map((p) => (Array.isArray(p) ? p[0] : (p?.x ?? 0)));
        const ys = workArea.map((p) => (Array.isArray(p) ? p[1] : (p?.y ?? 0)));
        const minX = Math.max(0, Math.min(...xs));
        const minY = Math.max(0, Math.min(...ys));
        const maxX = Math.min(vw, Math.max(...xs));
        const maxY = Math.min(vh, Math.max(...ys));
        const w = maxX - minX;
        const h = maxY - minY;
        if (w >= 40 && h >= 40) {
          return { x: minX, y: minY, w, h };
        }
      }
      return { x: 0, y: 0, w: vw, h: vh };
    };

    const extractSampleLuma = (video) => {
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const currentWorkArea = liveCfgRef.current?.work_area;
      const crop = getCropRect(video, currentWorkArea);
      sampleCtx.drawImage(
        video,
        crop.x, crop.y, crop.w, crop.h,
        0, 0, SAMPLE_DIM, SAMPLE_DIM
      );
      const data = sampleCtx.getImageData(0, 0, SAMPLE_DIM, SAMPLE_DIM).data;
      const luma = new Uint8Array(SAMPLE_DIM * SAMPLE_DIM);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
        luma[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      return luma;
    };

    const calcLumaDiff = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;
      let sum = 0;
      for (let i = 0; i < a.length; i += 1) {
        sum += Math.abs(a[i] - b[i]);
      }
      return sum / a.length;
    };

    // 64-Block Spatial Analysis: distinguishes global page transitions from local stylus obstructions
    const analyzeBlockDiff = (curr, base) => {
      if (!curr || !base || curr.length !== base.length) {
        return { avgDiff: 0, changedBlockRatio: 0, changedBlocks: 0 };
      }
      let totalDiff = 0;
      let changedBlocks = 0;

      for (let by = 0; by < GRID_SIZE; by += 1) {
        for (let bx = 0; bx < GRID_SIZE; bx += 1) {
          let blockSum = 0;
          for (let y = 0; y < BLOCK_SIZE; y += 1) {
            const rowStart = (by * BLOCK_SIZE + y) * SAMPLE_DIM;
            for (let x = 0; x < BLOCK_SIZE; x += 1) {
              const idx = rowStart + (bx * BLOCK_SIZE + x);
              blockSum += Math.abs(curr[idx] - base[idx]);
            }
          }
          totalDiff += blockSum;
          const blockAvg = blockSum / (BLOCK_SIZE * BLOCK_SIZE);
          if (blockAvg >= BLOCK_CHANGE_THRESHOLD) {
            changedBlocks += 1;
          }
        }
      }

      const totalBlocks = GRID_SIZE * GRID_SIZE; // 64
      const avgDiff = totalDiff / (SAMPLE_DIM * SAMPLE_DIM);
      const changedBlockRatio = changedBlocks / totalBlocks;

      return { avgDiff, changedBlockRatio, changedBlocks };
    };

    const sendFrameBlob = () => {
      if (stopped || !ws || ws.readyState !== WebSocket.OPEN) {
        isDetecting = false;
        return;
      }
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        isDetecting = false;
        return;
      }
      const w = Math.min(SEND_WIDTH, video.videoWidth);
      const h = Math.round((video.videoHeight / video.videoWidth) * w);
      sendCanvas.width = w;
      sendCanvas.height = h;
      sentLuma = extractSampleLuma(video);
      sendCanvas.getContext('2d').drawImage(video, 0, 0, w, h);

      sendCanvas.toBlob((blob) => {
        if (stopped || !blob || ws.readyState !== WebSocket.OPEN) {
          isDetecting = false;
          return;
        }
        ws.send(JSON.stringify({ ...liveCfgRef.current, orig_width: video.videoWidth }));
        ws.send(blob);
      }, 'image/jpeg', 0.72);
    };

    const triggerDetectNow = (reason = 'change') => {
      if (stopped || isDetecting || !ws || ws.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      isDetecting = true;
      screenState = 'DETECTING';
      setStatus(reason === 'init' ? 'Initial scan...' : 'Detecting screen...');

      // Never stay stuck waiting for the server: give up after 8s and re-scan
      clearWatchdog();
      detectWatchdog = setTimeout(() => {
        if (!isDetecting) return;
        isDetecting = false;
        baselineLuma = null; // forces a fresh scan on the next tick
        setStatus('Detect timeout, retrying...');
      }, 8000);

      sendFrameBlob();
    };

    forceDetectRef.current = () => triggerDetectNow('manual');

    const monitorLoop = () => {
      if (stopped || isDetecting || !ws || ws.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      // 1. Guard against CNC mechanical motion: Ignore camera motion while CNC is active or during post-move cooldown
      if (Date.now() < cncActiveUntilRef.current) {
        setLiveStatus('CNC moving (Detection paused)');
        stableStartTime = null;
        screenState = 'STABLE';
        justFinishedCncMotion = true;
        return;
      }

      const currLuma = extractSampleLuma(video);
      if (!currLuma) return;

      // First run: detect initial targets & set baseline
      if (!baselineLuma) {
        prevLuma = currLuma;
        triggerDetectNow('init');
        return;
      }

      // If CNC motion just finished and toolhead is now clear, synchronize prevLuma to prevent false triggers
      if (justFinishedCncMotion) {
        justFinishedCncMotion = false;
        prevLuma = currLuma;
      }

      const stepDiff = calcLumaDiff(currLuma, prevLuma);
      prevLuma = currLuma;

      // Case 1: Motion detected (screen transition or stylus actively moving)
      if (stepDiff > MOTION_THRESHOLD) {
        screenState = 'CHANGING';
        stableStartTime = null;
        setStatus('Screen changing...');
        return;
      }

      // Case 1b: slow transitions (fades/animations) never exceed the per-step threshold,
      // so also compare against the locked baseline while STABLE.
      if (screenState === 'STABLE') {
        const drift = analyzeBlockDiff(currLuma, baselineLuma);
        if (drift.avgDiff >= MIN_SCREEN_CHANGE && drift.changedBlockRatio >= MIN_GLOBAL_BLOCK_RATIO) {
          screenState = 'CHANGING';
          stableStartTime = null;
          setStatus('Screen changing...');
          return;
        }
      }

      // Case 2: Motion has paused / screen is currently stationary
      if (screenState === 'CHANGING') {
        const now = performance.now();
        if (stableStartTime === null) {
          stableStartTime = now;
        }
        const settledMs = Math.round(now - stableStartTime);
        setStatus('Settling...');

        if (settledMs >= SETTLE_DELAY_MS) {
          // Stationary long enough: perform 64-block spatial analysis to distinguish global page transition from local stylus obstruction
          const { avgDiff, changedBlockRatio, changedBlocks } = analyzeBlockDiff(currLuma, baselineLuma);

          if (avgDiff >= MIN_SCREEN_CHANGE && changedBlockRatio >= MIN_GLOBAL_BLOCK_RATIO) {
            if (isLocked) {
              screenState = 'STABLE';
              setLiveStatus('Targets Locked (Setup Mode)');
              return;
            }
            // True global screen transition: drop the old overlay immediately, then detect the new page
            setAiTargets([]);
            setSelectedTargetId(null);
            triggerDetectNow('screen_change');
          } else if (avgDiff >= MIN_SCREEN_CHANGE && changedBlockRatio < MIN_GLOBAL_BLOCK_RATIO) {
            // Localized obstruction (e.g. CNC toolhead / stylus resting at Key 6)
            // Screen beneath remains the same -> DO NOT re-detect, maintain locked targets
            screenState = 'STABLE';
            setLiveStatus(`Locked · Stylus at key (${changedBlocks}/64 blocks, screen unchanged)`);
          } else {
            // Reverted back to the original screen (transient stylus pass / hand shadow has gone)
            screenState = 'STABLE';
            setLiveStatus((curr) => (curr.startsWith('Locked') ? curr : 'Screen locked'));
          }
        }
      }
    };

    const connect = () => {
      if (stopped) return;
      setLiveStatus('Connecting...');
      ws = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/webcam/ws/live-detect`);

      ws.onopen = () => {
        setLiveStatus('Ready. Watching screen...');
        clearInterval(checkInterval);
        checkInterval = setInterval(monitorLoop, 120);
      };

      ws.onmessage = (event) => {
        try {
          clearWatchdog();
          const data = JSON.parse(event.data);
          if (data.error) {
            setStatus(`Error: ${data.error}`);
            isDetecting = false;
            return;
          }

          const video = videoRef.current;
          const nowLuma = video ? extractSampleLuma(video) : null;

          // The page changed while the server was detecting -> result is for a stale screen. Discard it
          // and let the monitor re-scan once the new screen settles.
          if (sentLuma && nowLuma) {
            const drift = analyzeBlockDiff(nowLuma, sentLuma);
            if (drift.avgDiff >= MIN_SCREEN_CHANGE && drift.changedBlockRatio >= MIN_GLOBAL_BLOCK_RATIO) {
              baselineLuma = sentLuma;
              prevLuma = nowLuma;
              screenState = 'CHANGING';
              stableStartTime = null;
              isDetecting = false;
              setStatus('Screen changed during scan, re-scanning...');
              return;
            }
          }

          const finalTargets = (data.objects || []).map((obj, idx) => ({
            ...obj,
            id: idx + 1,
            label: formatLabelToEnglish(obj.label),
          }));
          setAiTargets(finalTargets);
          setSelectedTargetId(null);

          // Lock new baseline after successful detection
          if (nowLuma) {
            baselineLuma = nowLuma;
            prevLuma = nowLuma;
          }
          screenState = 'STABLE';
          setStatus(`Locked · ${finalTargets.length} targets`);
          isDetecting = false;
        } catch {
          /* ignore malformed message */
          isDetecting = false;
        }
      };

      ws.onclose = () => {
        isDetecting = false;
        clearWatchdog();
        clearInterval(checkInterval);
        if (stopped) return;
        setLiveStatus('Reconnecting...');
        retryTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      stopped = true;
      forceDetectRef.current = null;
      clearInterval(checkInterval);
      clearTimeout(retryTimer);
      clearWatchdog();
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDetect, runningSequence, isExecutingScript]);

  // Re-scan current screen on demand (works for both live detect WebSocket and 1-shot API)
  const handleReScanCurrentScreen = () => {
    if (liveDetect && forceDetectRef.current) {
      toast.loading('Re-scanning current screen with 2-pass consensus...', { id: 'rescan', duration: 1500 });
      forceDetectRef.current();
    } else {
      handleRunAiDetection();
    }
  };

  // Toggle X coordinate sign between positive and negative
  const handleToggleInvertXSign = () => {
    setOriginX((prev) => -prev);
    setCncWidth((prev) => -prev);
    setKey1X((prev) => -prev);
    setSpacingX((prev) => -prev);

    setAiTargets((prevTargets) =>
      prevTargets.map((t) => ({
        ...t,
        cnc_x: typeof t.cnc_x === 'number' ? Math.round(-t.cnc_x * 10) / 10 : t.cnc_x,
      }))
    );
    toast.success('Đã đảo ngược dấu trục X (CNC X sign inverted)!');
  };

  // Smart Auto-Fill for Missing Keypad Numbers (1..9, 0) based on detected matrix grid spacing
  const handleAutoFillMissingKeys = async () => {
    if (!aiTargets || aiTargets.length < 2) {
      toast.error('Need at least 2 detected numeric keys to deduce keypad grid geometry!');
      return;
    }

    const keyGridMap = {
      1: { r: 0, c: 0 },
      2: { r: 0, c: 1 },
      3: { r: 0, c: 2 },
      4: { r: 1, c: 0 },
      5: { r: 1, c: 1 },
      6: { r: 1, c: 2 },
      7: { r: 2, c: 0 },
      8: { r: 2, c: 1 },
      9: { r: 2, c: 2 },
      0: { r: 3, c: 1 },
    };

    const existingDigits = {};
    for (const t of aiTargets) {
      const m = (t.label || '').match(/(?:key|phim|nut|nút|phím|số)?\s*([0-9])\b/i);
      if (m && keyGridMap[m[1]] !== undefined) {
        existingDigits[m[1]] = t;
      }
    }

    const foundDigits = Object.keys(existingDigits).map(Number);
    if (foundDigits.length < 2) {
      toast.error('Not enough numeric keys (0-9) detected to compute keypad matrix.');
      return;
    }

    let colDeltaX = 0;
    let colDeltaY = 0;
    let colDeltaCount = 0;

    let rowDeltaX = 0;
    let rowDeltaY = 0;
    let rowDeltaCount = 0;

    // Calculate column step and row step from all matching pairs
    for (let i = 0; i < foundDigits.length; i += 1) {
      for (let j = i + 1; j < foundDigits.length; j += 1) {
        const d1 = foundDigits[i];
        const d2 = foundDigits[j];
        const p1 = keyGridMap[d1];
        const p2 = keyGridMap[d2];
        const t1 = existingDigits[d1];
        const t2 = existingDigits[d2];

        const dc = p2.c - p1.c;
        const dr = p2.r - p1.r;

        // Same row, different columns
        if (dr === 0 && dc !== 0) {
          colDeltaX += (t2.pixel_x - t1.pixel_x) / dc;
          colDeltaY += (t2.pixel_y - t1.pixel_y) / dc;
          colDeltaCount += 1;
        }
        // Same column, different rows
        if (dc === 0 && dr !== 0) {
          rowDeltaX += (t2.pixel_x - t1.pixel_x) / dr;
          rowDeltaY += (t2.pixel_y - t1.pixel_y) / dr;
          rowDeltaCount += 1;
        }
      }
    }

    // Fallback if no exact same-row/column pair exists
    const avgW = aiTargets.reduce((s, t) => s + (t.width || 44), 0) / aiTargets.length;
    const avgH = aiTargets.reduce((s, t) => s + (t.height || 44), 0) / aiTargets.length;

    if (colDeltaCount > 0) {
      colDeltaX /= colDeltaCount;
      colDeltaY /= colDeltaCount;
    } else {
      colDeltaX = avgW * 1.45;
      colDeltaY = 0;
    }

    if (rowDeltaCount > 0) {
      rowDeltaX /= rowDeltaCount;
      rowDeltaY /= rowDeltaCount;
    } else {
      rowDeltaX = 0;
      rowDeltaY = avgH * 1.45;
    }

    // Anchor point from first found digit
    const anchorDigit = foundDigits[0];
    const anchorTarget = existingDigits[anchorDigit];
    const anchorGrid = keyGridMap[anchorDigit];

    const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
    const missingDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].filter((d) => !existingDigits[d]);

    if (missingDigits.length === 0) {
      toast.success('Keypad already contains all numeric keys 0-9!');
      return;
    }

    const toastId = toast.loading(`Auto-calculating coordinates for ${missingDigits.length} missing keys...`);
    const newItems = [];
    let nextId = Math.max(...aiTargets.map((t) => t.id || 0), 0) + 1;

    for (const d of missingDigits) {
      const g = keyGridMap[d];
      const dc = g.c - anchorGrid.c;
      const dr = g.r - anchorGrid.r;
      const px = Math.round(anchorTarget.pixel_x + dc * colDeltaX + dr * rowDeltaX);
      const py = Math.round(anchorTarget.pixel_y + dc * colDeltaY + dr * rowDeltaY);

      try {
        const res = await axios.post(`${API_BASE}/webcam/map-pixel`, {
          pixel_x: px,
          pixel_y: py,
          work_area: activeWorkArea,
          origin_x: originX,
          origin_y: originY,
          camera_offset_x: cameraOffsetX,
          camera_offset_y: cameraOffsetY,
          cnc_width: cncWidth,
          cnc_height: cncHeight,
        });

        newItems.push({
          id: nextId++,
          label: `Key ${d}`,
          pixel_x: px,
          pixel_y: py,
          cnc_x: res.data.cnc_x,
          cnc_y: res.data.cnc_y,
          width: anchorTarget.width || 44,
          height: anchorTarget.height || 44,
          confidence: 0.9,
          autoFilled: true,
          box_polygon: [
            [px - 22, py - 22],
            [px + 22, py - 22],
            [px + 22, py + 22],
            [px - 22, py + 22],
          ],
        });
      } catch (err) {
        console.error(`Map pixel error for Key ${d}:`, err);
      }
    }

    if (newItems.length > 0) {
      setAiTargets((prev) => [...prev, ...newItems]);
      toast.success(`Auto-filled ${newItems.length} missing keys (${newItems.map((i) => i.label).join(', ')})!`, { id: toastId });
    } else {
      toast.error('Could not auto-fill missing keys.', { id: toastId });
    }
  };

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
    markCncMoving(2200);
    await refreshCncStatus();
    toast.success('Sequence execution completed!');
  };

  // ---- Execution displacement watchdog ----
  // Live-detect is paused while a script runs (to avoid re-detecting every time the toolhead covers the screen).
  // This watchdog only samples the work area while the CNC is idle (outside cncActiveUntilRef), and re-anchors
  // its reference frame after every CNC move. So the toolhead resting on a key is part of the reference and is
  // never counted as a change. A GLOBAL change that appears while the CNC is idle (POS moved by hand, or the
  // screen changed on its own) marks the detected targets as stale -> runner re-parks & re-detects.
  const createDisplacementWatchdog = () => {
    const MOTION_THRESHOLD = 7.5;        // per-tick mean luma diff = something is moving
    const MIN_SCREEN_CHANGE = 8.2;       // mean diff vs reference to count as a real change
    const MIN_GLOBAL_BLOCK_RATIO = 0.28; // >= 18/64 blocks changed = global (not a local stylus obstruction)
    const SETTLE_MS = 500;
    const TICK_MS = 150;

    const canvas = document.createElement('canvas');
    canvas.width = WATCH_SAMPLE_DIM;
    canvas.height = WATCH_SAMPLE_DIM;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let refLuma = null;
    let prevLuma = null;
    let motionActive = false;
    let lastMotionAt = 0;
    let displaced = null;
    let paused = false;

    const resetAnchor = () => { refLuma = null; prevLuma = null; motionActive = false; };

    const tick = () => {
      if (paused) return;
      // CNC moving (or post-move cooldown): ignore, re-anchor once it stops
      if (Date.now() < cncActiveUntilRef.current) { resetAnchor(); return; }

      const curr = sampleWorkAreaLuma(videoRef.current, liveCfgRef.current?.work_area, ctx);
      if (!curr) return;
      if (!refLuma) { refLuma = curr; prevLuma = curr; return; }

      const now = performance.now();
      const stepDiff = lumaMeanDiff(curr, prevLuma);
      prevLuma = curr;

      if (stepDiff > MOTION_THRESHOLD) { motionActive = true; lastMotionAt = now; return; }

      if (!motionActive) {
        // Slow push / slide that never exceeds the per-tick threshold
        const drift = lumaBlockDiff(curr, refLuma);
        if (drift.avgDiff >= MIN_SCREEN_CHANGE && drift.changedBlockRatio >= MIN_GLOBAL_BLOCK_RATIO) {
          motionActive = true;
          lastMotionAt = now;
        }
        return;
      }

      if (now - lastMotionAt < SETTLE_MS) return;

      // Motion stopped and scene is still: compare against the reference taken at the same toolhead position
      motionActive = false;
      const d = lumaBlockDiff(curr, refLuma);
      if (d.avgDiff >= MIN_SCREEN_CHANGE && d.changedBlockRatio >= MIN_GLOBAL_BLOCK_RATIO) {
        displaced = d;
      }
      refLuma = curr;
    };

    const timer = setInterval(tick, TICK_MS);

    return {
      isMoving: () => motionActive,
      takeDisplaced: () => { const d = displaced; displaced = null; return d; },
      waitUntilSettled: async (maxMs = 5000) => {
        const start = Date.now();
        while (motionActive && !paused && Date.now() - start < maxMs && !stopScriptRef.current) {
          await sleep(120);
        }
      },
      reset: () => { displaced = null; resetAnchor(); },
      pause: () => { paused = true; resetAnchor(); },
      resume: () => { paused = false; },
      stop: () => clearInterval(timer),
    };
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

    const watchdog = createDisplacementWatchdog();
    // Park + re-detect with the watchdog paused (park motion / settle wait must not count as displacement)
    const rescanWithWatchdog = async (opts) => {
      watchdog.pause();
      try {
        return await parkAndRescan(opts);
      } finally {
        watchdog.reset();
        watchdog.resume();
      }
    };

    try {
      // 0. Auto-connect Arduino COM port if not already connected
      await ensureArduinoConnected();
      await refreshCncStatus();

      // 1-2. ALWAYS park & re-detect at start: the POS may have been moved since the last detection.
      // Falls back to the previous targets only if the fresh scan fails.
      setLoading('ai-detect');
      let detected = [];
      try {
        const fresh = await rescanWithWatchdog({
          label: 'Initial scan',
          settleMs: 700,
          promptFallback: 'all numeric keys 1, 2, 3, 4, and Enter OK buttons on ATM keypad',
        });
        detected = (fresh && fresh.length > 0) ? fresh : aiTargets;
      } finally {
        setLoading('');
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

        // If step is a dedicated TRANSITION_SCREEN step, perform park & scan and proceed
        if (step.action === 'TRANSITION_SCREEN') {
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Screen transition: Parking CNC to corner & scanning new screen...`, { id: 'auto-run' });
          const nextDetected = await rescanWithWatchdog({ label: `Transition #${i + 1}`, settleMs: 1600 });
          if (nextDetected && nextDetected.length > 0) {
            detected = nextDetected;
          }
          if (onStepUpdate) onStepUpdate(i, 'passed');
          continue;
        }

        // Dedicated Card Servo Actions (Insert / Eject / Swipe Card)
        if (step.action === 'INSERT_CARD') {
          const sec = parseInt(step.value) || 2;
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Inserting card (Servo D33 - ${sec}s)...`, { id: 'auto-run' });
          try {
            await axios.post(`${API_BASE}/card/insert`, { seconds: sec });
            toast.success(`Card inserted successfully!`, { id: 'auto-run' });
          } catch (cErr) {
            console.warn('Card insert error:', cErr);
            toast.error(`Error inserting card: ${cErr?.response?.data?.detail || cErr.message}`, { id: 'auto-run' });
          }
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
          continue;
        }

        if (step.action === 'EJECT_CARD') {
          const sec = parseInt(step.value) || 2;
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Ejecting card (Servo D33 - ${sec}s)...`, { id: 'auto-run' });
          try {
            await axios.post(`${API_BASE}/card/eject`, { seconds: sec });
            toast.success(`Card ejected successfully!`, { id: 'auto-run' });
          } catch (cErr) {
            console.warn('Card eject error:', cErr);
            toast.error(`Error ejecting card: ${cErr?.response?.data?.detail || cErr.message}`, { id: 'auto-run' });
          }
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
          continue;
        }

        if (step.action === 'SWIPE_CARD') {
          const sec = parseInt(step.value) || 2;
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Swiping card (Servo D12 - ${sec}s)...`, { id: 'auto-run' });
          try {
            await axios.post(`${API_BASE}/card/swipe`, { seconds: sec });
            toast.success(`Card swiped successfully!`, { id: 'auto-run' });
          } catch (cErr) {
            console.warn('Card swipe error:', cErr);
            toast.error(`Error swiping card: ${cErr?.response?.data?.detail || cErr.message}`, { id: 'auto-run' });
          }
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
          continue;
        }

        // Displacement watchdog: if the POS was moved (or the screen changed by itself) while the CNC was idle,
        // the current coordinates are stale -> wait for the hand to stop, then park & re-detect before clicking.
        if (watchdog.isMoving()) {
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Movement detected in work area, waiting to settle...`, { id: 'auto-run' });
          await watchdog.waitUntilSettled(5000);
        }
        const displacement = watchdog.takeDisplaced();
        if (displacement && !stopScriptRef.current) {
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] POS moved / screen changed (${displacement.changedBlocks}/64 blocks). Re-detecting...`, { id: 'auto-run' });
          const reDetected = await rescanWithWatchdog({ label: `Re-detect before step ${i + 1}`, settleMs: 700 });
          if (reDetected && reDetected.length > 0) {
            detected = reDetected;
          }
        }
        if (stopScriptRef.current) {
          toast('Execution stopped by user!', { id: 'auto-run' });
          break;
        }

        // Match exact target element from detected camera objects
        const matched = matchStepWithDetected(step, detected);

        // Prefer matched freshest coordinates on active screen, fallback to pre-recorded step coordinates
        const targetCncX = (matched?.cnc_x !== undefined && matched?.cnc_x !== null) ? matched.cnc_x : step.cnc_x;
        const targetCncY = (matched?.cnc_y !== undefined && matched?.cnc_y !== null) ? matched.cnc_y : step.cnc_y;
        const targetPxX = (matched?.pixel_x ?? matched?.center_x) ?? step.pixel_x;
        const targetPxY = (matched?.pixel_y ?? matched?.center_y) ?? step.pixel_y;

        if (targetCncX !== undefined && targetCncY !== undefined && targetCncX !== null && targetCncY !== null) {
          if (matched?.id) setSelectedTargetId(matched.id);
          toast.loading(`[Step ${i + 1}/${scriptToRun.length}] Moving CNC to ${matched?.label || step.target} (X: ${targetCncX}, Y: ${targetCncY})...`, { id: 'auto-run' });

          markCncMoving(30000);
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
          } finally {
            markCncMoving(1200);
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

          markCncMoving(30000);
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
          } finally {
            markCncMoving(1200);
          }
          await refreshCncStatus();
          if (step.delay_ms) await new Promise((r) => setTimeout(r, step.delay_ms));
          if (onStepUpdate) onStepUpdate(i, 'passed');
        } else {
          // Simulation / wait delay
          const waitTime = Math.max(step.delay_ms || 500, 650);
          if (onStepUpdate) onStepUpdate(i, 'passed');
        }

        // Auto transition to next screen if step specifies park_after (e.g. clicking Enter/Next/Continue)
        if (step.park_after && i < scriptToRun.length - 1 && !stopScriptRef.current) {
          const nextDetected = await rescanWithWatchdog({ label: `Transition #${i + 1}`, settleMs: 1600 });
          if (nextDetected && nextDetected.length > 0) {
            detected = nextDetected;
          }
        }
      }

      if (!stopScriptRef.current) {
        toast.success(`Successfully executed all ${scriptToRun.length} test steps!`, { id: 'auto-run', duration: 5000 });
        if (onCompleteExecution) onCompleteExecution(true);
        // Automatically return CNC to safe park position (Corner 0)
        try {
          const activeWorkArea = (calibrationPoints.length === 4 ? calibrationPoints.map((p) => [p.x, p.y]) : savedWorkArea);
          if (activeWorkArea && activeWorkArea.length >= 4) {
            const corner = activeWorkArea[parkCornerIndex || 0];
            const px = Array.isArray(corner) ? corner[0] : (corner?.x ?? 0);
            const py = Array.isArray(corner) ? corner[1] : (corner?.y ?? 0);
            const mapRes = await axios.post(`${API_BASE}/webcam/map-pixel`, {
              pixel_x: px,
              pixel_y: py,
              work_area: activeWorkArea,
              origin_x: originX,
              origin_y: originY,
              cnc_width: cncWidth,
              cnc_height: cncHeight,
              camera_offset_x: cameraOffsetX,
              camera_offset_y: cameraOffsetY,
            });
            await axios.post(`${API_BASE}/cnc/park`, {
              target_x: mapRes.data.cnc_x,
              target_y: mapRes.data.cnc_y,
              lift_a: true,
            });
            await refreshCncStatus();
          }
        } catch (parkErr) {
          console.warn('Auto return to park notice:', parkErr);
        }
      }
    } catch (err) {
      toast.error(`Script execution error: ${err.message}`, { id: 'auto-run' });
      if (onCompleteExecution) onCompleteExecution(false);
    } finally {
      watchdog.stop();
      setRunningSequence(false);
      setCurrentExecutingStep(null);
      markCncMoving(2200);
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



  const handleSaveSnapshot = () => runAction('snapshot', async () => {
    const imageData = captureFrame();
    if (!imageData) throw new Error('Camera preview is not ready yet');
    
    toast.loading('Saving snapshot...', { id: 'snapshot' });
    const response = await axios.post(`${API_BASE}/webcam/save-snapshot`, {
      image_data: imageData,
    });
    
    if (response.data.success) {
      toast.success(`Snapshot saved to pictures folder!`, { id: 'snapshot' });
    } else {
      toast.error('Failed to save snapshot', { id: 'snapshot' });
    }
  });

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

        {/* HAPPY CASE WORKFLOW: 4-STEP ZERO-OBSTRUCTION PIPELINE ACTION TOOLBAR */}
        <div className="bg-white/80 backdrop-blur-xs p-3.5 rounded-2xl border border-slate-200 shadow-xs mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>Execution Pipeline (Zero-Obstruction):</span>
              {isLocked && (
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                  LOCKED ({aiTargets.length} TARGETS)
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">
              1. Park Corner &rarr; 2. Scan Viewport &rarr; 3. Lock Targets &rarr; 4. Execute Smoothly
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Step 1: Park to Corner (Move CNC to corner for clear camera viewport) */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-50 transition-all">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                1
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-indigo-950 flex items-center justify-between">
                  <span>Park to Corner</span>
                  <select
                    className="text-[10px] bg-white border border-indigo-300 rounded px-1 py-0.5 text-indigo-900 font-semibold cursor-pointer"
                    value={parkCornerIndex}
                    onChange={(e) => setParkCornerIndex(Number(e.target.value))}
                    disabled={busy}
                    title="Select corner to park CNC away from camera viewport"
                  >
                    <option value={0}>Corner 1 (TL)</option>
                    <option value={1}>Corner 2 (TR)</option>
                    <option value={2}>Corner 3 (BR)</option>
                    <option value={3}>Corner 4 (BL)</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => handleParkToCorner(parkCornerIndex)}
                  disabled={busy}
                  className="mt-1.5 w-full text-center text-[11px] font-bold py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white transition-all shadow-xs cursor-pointer"
                >
                  Park Z to Corner {parkCornerIndex + 1}
                </button>
              </div>
            </div>

            {/* Step 2: Detect Elements (Capture when Z is parked outside) */}
            <div className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${
              loading === 'ai-detect'
                ? 'border-sky-400 bg-sky-50 shadow-md ring-2 ring-sky-300'
                : 'border-slate-200 bg-slate-50/80 hover:bg-white'
            }`}>
              <div className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shrink-0 ${
                loading === 'ai-detect' ? 'bg-sky-500' : 'bg-[#01a9ac]'
              }`}>
                {loading === 'ai-detect' ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  '2'
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
                  <span>{loading === 'ai-detect' ? 'Scanning...' : 'Detect Elements'}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                    aiTargets.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {aiTargets.length > 0 ? `${aiTargets.length} targets` : '0 targets'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[9px] font-semibold mt-1">
                  <span className="flex items-center gap-1.5 text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      {aiModel === 'hybrid'
                        ? 'Hybrid: YOLO (Coords) + GPT-4o'
                        : aiModel.startsWith('gpt')
                          ? (aiModel === 'gpt4o-mini' ? 'GPT-4o-mini (~0.8s)' : 'GPT-4o Vision')
                          : 'YOLO (RAM Cached)'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleWarmupModel(true)}
                    disabled={isWarmingUp}
                    className="text-[9px] px-1.5 py-0.5 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded font-bold cursor-pointer transition-colors"
                    title="Preload models into memory for instant detection response"
                  >
                    {isWarmingUp ? 'Preloading...' : 'Preload'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleRunAiDetection}
                  disabled={busy}
                  className="mt-1.5 w-full text-center text-[11px] font-bold py-1.5 px-2 rounded-lg bg-[#01a9ac] hover:bg-[#019497] active:scale-95 text-white transition-all shadow-xs cursor-pointer"
                  title="Capture image when camera is unobstructed and detect keys"
                >
                  AI Vision Scan
                </button>
              </div>
            </div>

            {/* Step 3: Lock Script / Unlock */}
            <div className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${
              isLocked
                ? 'border-emerald-300 bg-emerald-50/80 shadow-xs ring-1 ring-emerald-300'
                : 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
            }`}>
              <div className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shrink-0 ${
                isLocked ? 'bg-emerald-600' : 'bg-amber-500'
              }`}>
                3
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
                  <span>{isLocked ? 'Targets Locked' : 'Lock Script'}</span>
                  <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                    isLocked ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {isLocked ? 'LOCKED' : 'READY'}
                  </span>
                </div>
                {!isLocked ? (
                  <button
                    type="button"
                    onClick={handleLockSetup}
                    disabled={busy || aiTargets.length === 0}
                    className="mt-1.5 w-full text-center text-[11px] font-bold py-1.5 px-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:scale-95 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
                    title="Lock target positions so moving Z does not trigger re-detection errors"
                  >
                    Lock Key Positions
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUnlockSetup}
                    disabled={busy}
                    className="mt-1.5 w-full text-center text-[11px] font-bold py-1.5 px-2 rounded-lg bg-white border border-emerald-400 hover:bg-emerald-100 active:scale-95 text-emerald-800 transition-all shadow-xs cursor-pointer"
                    title="Unlock to change screen or re-scan targets"
                  >
                    Unlock / Re-scan
                  </button>
                )}
              </div>
            </div>

            {/* Step 4: Execute CNC */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-400 bg-gradient-to-br from-emerald-500/10 to-teal-500/20">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-r from-[#0ac282] to-[#0df3a3] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                4
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-extrabold text-slate-800 flex items-center justify-between">
                  <span>Execute CNC</span>
                  <span className="text-[9px] font-bold text-emerald-700 bg-white/80 px-1 rounded">
                    {runningSequence ? 'RUNNING' : 'AUTO RUN'}
                  </span>
                </div>
                {!runningSequence ? (
                  <button
                    type="button"
                    onClick={() => handleStartScriptRunner(activeTestScript)}
                    disabled={busy || aiTargets.length === 0}
                    className="mt-1.5 w-full text-center text-[11px] font-extrabold py-1.5 px-2 rounded-lg bg-gradient-to-r from-[#0ac282] to-[#0df3a3] hover:brightness-105 active:scale-95 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
                    title="Execute test script with locked coordinates (moving Z axis has no interference)"
                  >
                    Execute Script &rarr;
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopScriptRunner}
                    className="mt-1.5 w-full text-center text-[11px] font-bold py-1.5 px-2 rounded-lg bg-red-500 hover:bg-red-600 active:scale-95 text-white transition-all shadow-xs cursor-pointer"
                  >
                    Emergency Stop
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="vision-tabs-bar">
        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'ai' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI Target Detection
        </button>

        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'roi' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => {
            setActiveTab('roi');
            if (calibrationPoints.length < 4) {
              const w = frameWidth || 640;
              const h = frameHeight || 480;
              setCalibrationPoints([
                { x: Math.round(w * 0.2), y: Math.round(h * 0.2) },
                { x: Math.round(w * 0.8), y: Math.round(h * 0.2) },
                { x: Math.round(w * 0.8), y: Math.round(h * 0.8) },
                { x: Math.round(w * 0.2), y: Math.round(h * 0.8) },
              ]);
            }
          }}
        >
          4-Point ROI & CNC Mapping
        </button>

        <button
          type="button"
          className={`vision-tab-btn ${activeTab === 'ocr' ? 'vision-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('ocr')}
        >
          OCR Search
        </button>
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
                AUTO DETECT STYLUS
              </button>
              <button
                type="button"
                onClick={() => setManualPenPickMode((v) => !v)}
                disabled={busy || isAutoMeasuring}
                className={`webcam-ocr-button ${manualPenPickMode ? 'webcam-ocr-button--primary' : 'webcam-ocr-button--quiet'}`}
                title="Click directly on the stylus pen tip on the preview screen"
              >
                {manualPenPickMode ? 'CLICK ON VIDEO TO PICK...' : 'MANUAL PICK'}
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
          {/* OpenAI API Key Status & Quick Config */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 rounded-xl border border-slate-700/60 text-xs">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${openaiStatus.configured ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="font-semibold text-slate-200">
                {openaiStatus.configured
                  ? `OpenAI API Key: ${openaiStatus.masked_key}`
                  : 'OpenAI API Key not configured'}
              </span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                (Using {aiModel === 'gpt4o' ? 'GPT-4o (High Accuracy)' : 'GPT-4o-mini (Fast)'} for button & screen detection)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowKeyInput((v) => !v)}
              className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
            >
              {showKeyInput ? 'Close' : 'Change / Enter API Key'}
            </button>
          </div>

          {showKeyInput && (
            <div className="flex items-center gap-2 p-2 bg-slate-800/90 rounded-xl border border-sky-500/40">
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder="Paste OpenAI API Key (sk-proj-...)"
                className="flex-1 bg-slate-950 px-3 py-1.5 rounded-lg text-xs text-white border border-slate-700 focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={handleSaveOpenAiKey}
                disabled={isSavingKey}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {isSavingKey ? 'Saving...' : 'Save Key'}
              </button>
            </div>
          )}

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
                <option value="hybrid">Hybrid: YOLO (100% Precise Coords) + GPT-4o (Button Names)</option>
                <option value="gpt4o">OpenAI GPT-4o (High Resolution - ~2s)</option>
                <option value="gpt4o-mini">OpenAI GPT-4o-mini (Fast ~0.8s & Accurate Text)</option>
                <option value="yolo">YOLO Offline Model (best.pt - Precise Coords)</option>
                <option value="opencv">OpenCV Contours & Shapes (Offline)</option>
              </select>
            </label>
            <label>
              Display Style
              <select
                value={overlayMode}
                onChange={(e) => handleSetOverlayMode(e.target.value)}
                disabled={busy}
              >
                <option value="box">Bounding Box</option>
                <option value="circle">Numbered Circle</option>
                <option value="both">Both (Box + Circle)</option>
              </select>
            </label>
          </div>

          <div className="vision-actions-row">
            <button
              type="button"
              onClick={() => handleWarmupModel(true)}
              disabled={busy || isWarmingUp}
              className="webcam-ocr-button"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                fontWeight: 700,
              }}
              title="Preload AI models into memory/network for instant subsequent detection"
            >
              {isWarmingUp ? 'PRELOADING...' : 'PRELOAD MODEL (WARMUP)'}
            </button>

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
              DETECT ELEMENTS IN FRAME
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
              DETECT FACEBOOK LOGIN FORM
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

          {calibrationPoints.length !== 4 && (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px dashed #94a3b8', borderRadius: '0.75rem', textAlign: 'center', background: '#f8fafc' }}>
              <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
                Workspace 4-corner frame not found on video. Click button below to create 4 draggable calibration points:
              </p>
              <button
                type="button"
                className="webcam-ocr-button webcam-ocr-button--primary"
                onClick={() => {
                  const w = frameWidth || 640;
                  const h = frameHeight || 480;
                  setCalibrationPoints([
                    { x: Math.round(w * 0.2), y: Math.round(h * 0.2) },
                    { x: Math.round(w * 0.8), y: Math.round(h * 0.2) },
                    { x: Math.round(w * 0.8), y: Math.round(h * 0.8) },
                    { x: Math.round(w * 0.2), y: Math.round(h * 0.8) },
                  ]);
                }}
              >
                GENERATE 4 SAMPLE CORNERS
              </button>
            </div>
          )}

          {calibrationPoints.length === 4 && (
            <div className="vision-physical-mapping" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.75rem', background: '#f8fafc' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#334155', marginBottom: '0.75rem' }}>PHYSICAL CNC MAPPING (OPTIONAL)</h4>
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem' }}>Jog the CNC to each of the 4 corners on the camera and save its physical position to create a highly accurate mapping matrix.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {calibrationPoints.map((pt, idx) => (
                  <div key={`cnc-calib-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '0.5rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>Corner {idx + 1}</span>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.7rem', color: '#64748b' }}>
                          X:
                          <input
                            type="number"
                            value={cncCalibrationPoints[idx]?.x ?? ''}
                            onChange={(e) => {
                              const newPoints = [...cncCalibrationPoints];
                              newPoints[idx] = { ...newPoints[idx], x: Number(e.target.value) };
                              setCncCalibrationPoints(newPoints);
                            }}
                            style={{ width: '45px', marginLeft: '2px', padding: '1px 2px', border: '1px solid #cbd5e1', borderRadius: '3px' }}
                          />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.7rem', color: '#64748b' }}>
                          Y:
                          <input
                            type="number"
                            value={cncCalibrationPoints[idx]?.y ?? ''}
                            onChange={(e) => {
                              const newPoints = [...cncCalibrationPoints];
                              newPoints[idx] = { ...newPoints[idx], y: Number(e.target.value) };
                              setCncCalibrationPoints(newPoints);
                            }}
                            style={{ width: '45px', marginLeft: '2px', padding: '1px 2px', border: '1px solid #cbd5e1', borderRadius: '3px' }}
                          />
                        </label>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="webcam-ocr-button webcam-ocr-button--quiet"
                        style={{ padding: '0.25rem 0.4rem', fontSize: '0.7rem' }}
                        onClick={() => {
                          const newCncPoints = [...cncCalibrationPoints];
                          newCncPoints[idx] = { x: currentCncPos.x, y: currentCncPos.y };
                          setCncCalibrationPoints(newCncPoints);
                          toast.success(`Corner ${idx + 1} updated to CNC X:${currentCncPos.x}, Y:${currentCncPos.y}`);
                        }}
                        title="Read current CNC machine position"
                      >
                        READ POS
                      </button>
                      <button
                        type="button"
                        className="webcam-ocr-button"
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.7rem', background: '#4f46e5', color: 'white', fontWeight: 700 }}
                        onClick={() => handleParkToCorner(idx)}
                        title={`Park CNC directly to Corner ${idx + 1}`}
                      >
                        PARK HERE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="webcam-ocr-button webcam-ocr-button--primary"
                  disabled={cncCalibrationPoints.some(p => p === null) || busy}
                  onClick={async () => {
                    try {
                      await runAction('calibrate-cnc', async () => {
                        await axios.post(`${API_BASE}/webcam/calibrate-cnc-mapping`, {
                          camera_points: calibrationPoints.map(p => [p.x, p.y]),
                          cnc_points: cncCalibrationPoints.map(p => [p.x, p.y])
                        });
                        toast.success('Physical CNC Mapping calibrated successfully!');
                      });
                    } catch (err) {}
                  }}
                >
                  CALIBRATE PHYSICAL MAPPING
                </button>
              </div>
            </div>
          )}
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
            style={{ cursor: ((activeTab === 'roi' && calibrationMode) || addCustomTargetMode) ? 'crosshair' : 'pointer' }}
          >
            {addCustomTargetMode && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 60,
                  backgroundColor: 'rgba(15, 23, 42, 0.92)',
                  color: '#38bdf8',
                  border: '1px solid #38bdf8',
                  padding: '8px 16px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <span>Click anywhere on camera preview to place missing element</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setAddCustomTargetMode(false); }}
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            <video ref={videoRef} autoPlay muted playsInline />
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const next = overlayMode === 'box' ? 'circle' : overlayMode === 'circle' ? 'both' : 'box';
                handleSetOverlayMode(next);
              }}
              style={{
                position: 'absolute',
                top: '10px',
                right: '120px',
                zIndex: 50,
                backgroundColor: 'rgba(15, 23, 42, 0.75)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                transition: 'all 0.2s ease-in-out'
              }}
              title="Toggle display overlay: Bounding Box / Numbered Circle / Both"
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.75)'}
            >
              {overlayMode === 'box' ? 'Bounding Box' : overlayMode === 'circle' ? 'Numbered Circle' : 'Box + Circle'}
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleSaveSnapshot(); }}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 50,
                backgroundColor: 'rgba(15, 23, 42, 0.7)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                transition: 'all 0.2s ease-in-out'
              }}
              title="Save Snapshot to /pictures folder"
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 23, 42, 0.7)'}
            >
              Capture
            </button>

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
            {(calibrationPoints.length >= 2 || savedWorkArea || (overlayMode !== 'circle' && aiTargets.length > 0)) && (
              <svg className="vision-svg-overlay" viewBox={`0 0 ${frameWidth} ${frameHeight}`} preserveAspectRatio="none">
                {(calibrationPoints.length >= 2 || savedWorkArea) && (
                  <polygon
                    points={(calibrationPoints.length === 4 ? calibrationPoints : savedWorkArea || []).map((p) => `${p.x || p[0]},${p.y || p[1]}`).join(' ')}
                    className="vision-roi-polygon"
                  />
                )}
                {overlayMode !== 'circle' && aiTargets.map((t) => t.box_polygon && (
                  <polygon
                    key={`box-poly-${t.id}`}
                    points={t.box_polygon.map((p) => `${p[0]},${p[1]}`).join(' ')}
                    className={`vision-ai-box-poly ${selectedTargetId === t.id ? 'vision-ai-box-poly--selected' : ''}`}
                    style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTargetId(t.id);
                      handleMoveToCncTarget(t);
                    }}
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

            {/* YOLO-style box labels: "label conf" at the top-left corner of each box */}
            {overlayMode !== 'circle' && aiTargets.map((t) => {
              if (!t.box_polygon) return null;
              const minX = Math.min(...t.box_polygon.map((p) => p[0]));
              const minY = Math.min(...t.box_polygon.map((p) => p[1]));
              return (
                <div
                  key={`box-label-${t.id}`}
                  className={`vision-ai-box-label ${selectedTargetId === t.id ? 'vision-ai-box-label--selected' : ''}`}
                  style={{ left: `${(minX / frameWidth) * 100}%`, top: `${(minY / frameHeight) * 100}%`, pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTargetId(t.id);
                    handleMoveToCncTarget(t);
                  }}
                >
                  {t.mappedStepName ? `[Step] ${t.mappedStepName}` : formatLabelToEnglish(t.label)} {Number(t.confidence || 0).toFixed(2)}
                </div>
              );
            })}

            {/* AI Detected Objects Overlays */}
            {aiTargets.map((target) => {
              const xPercent = (target.pixel_x / frameWidth) * 100;
              const yPercent = (target.pixel_y / frameHeight) * 100;
              const isSelected = selectedTargetId === target.id;
              const showCircle = overlayMode === 'circle' || overlayMode === 'both';
              return (
                <button
                  type="button"
                  key={`target-tag-${target.id}`}
                  className={`vision-ai-marker ${isSelected ? 'vision-ai-marker--selected' : ''}`}
                  style={{
                    left: `${xPercent}%`,
                    top: `${yPercent}%`,
                    pointerEvents: 'auto',
                    touchAction: 'none',
                    cursor: draggingTargetId === target.id ? 'grabbing' : 'grab',
                    zIndex: draggingTargetId === target.id ? 30 : undefined,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dragTargetMovedRef.current = false;
                    dragTargetLastRef.current = null;
                    setSelectedTargetId(target.id);
                    setDraggingTargetId(target.id);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragTargetMovedRef.current) {
                      dragTargetMovedRef.current = false;
                      return;
                    }
                    handleMoveToCncTarget(target);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteTarget(target.id);
                  }}
                  title={`#${target.id} ${formatLabelToEnglish(target.label)} → CNC (${target.cnc_x}, ${target.cnc_y}) — drag to reposition, click to move stylus`}
                >
                  <div className="vision-ai-dot" style={{ opacity: showCircle ? 1 : 0 }}>
                    <span className="vision-ai-dot-num">{target.id}</span>
                  </div>
                  {showCircle && (
                    <div className="vision-ai-tag">
                      <strong>#{target.id} {target.mappedStepName ? `[Step] ${target.mappedStepName}` : formatLabelToEnglish(target.label)}</strong>
                      <span>X:{target.cnc_x} Y:{target.cnc_y}</span>
                    </div>
                  )}
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
                  STYLUS TIP ({redPenPos.tip_x ?? redPenPos.center_x}, {redPenPos.tip_y ?? redPenPos.center_y})
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

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleReScanCurrentScreen}
                disabled={busy}
                className="webcam-ocr-button"
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                }}
                title="Re-scan current screen now (Multi-Pass Consensus)"
              >
                Re-Scan Now
              </button>

              <button
                type="button"
                onClick={handleToggleInvertXSign}
                disabled={busy}
                className="webcam-ocr-button"
                style={{
                  background: originX < 0 ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : '#e2e8f0',
                  color: originX < 0 ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: originX < 0 ? '0 2px 6px rgba(245, 158, 11, 0.3)' : 'none',
                }}
                title="Đảo ngược dấu trục X (âm/dương) cho toạ độ CNC (Toggle X axis coordinate sign)"
              >
                {originX < 0 ? '± X: (-) Âm' : '± X: (+) Dương'}
              </button>

              <button
                type="button"
                onClick={handleAutoFillMissingKeys}
                disabled={busy}
                className="webcam-ocr-button"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(139, 92, 246, 0.25)',
                }}
                title="Automatically infer keypad matrix and interpolate missing numeric keys (1-9, 0)"
              >
                Auto-Fill Keys
              </button>

              <button
                type="button"
                onClick={handleAutoMapToScript}
                disabled={busy || !activeTestScript || activeTestScript.length === 0}
                className="webcam-ocr-button"
                style={{
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
                }}
                title="Automatically link detected targets to test script steps"
              >
                Auto Map Script
              </button>

              <button
                type="button"
                onClick={() => setAddCustomTargetMode((v) => !v)}
                disabled={busy}
                className="webcam-ocr-button"
                style={{
                  background: addCustomTargetMode ? '#ef4444' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
                }}
                title="Enable click on camera to manually add a target"
              >
                {addCustomTargetMode ? '✕ Cancel' : '+ Add Target'}
              </button>

              <button
                type="button"
                onClick={() => setAiTargets([])}
                className="webcam-ocr-button webcam-ocr-button--quiet"
                style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
                title="Clear detected elements list"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="vision-targets-grid">
            {aiTargets.map((target) => (
              <div
                key={`card-${target.id}`}
                className={`vision-target-card ${selectedTargetId === target.id ? 'vision-target-card--active' : ''} ${target.mappedStepIndex !== undefined ? 'ring-2 ring-emerald-400 bg-emerald-50/20' : ''}`}
                onClick={() => handleMoveToCncTarget(target)}
              >
                <div className="vision-target-card__header" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="vision-target-card__id">#{target.id}</span>
                  <input
                    type="text"
                    value={target.label || ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleUpdateTargetLabel(target.id, e.target.value)}
                    placeholder="Button name (e.g. Purchase)"
                    title="Rename target to identify and link to script"
                    style={{
                      flex: 1,
                      minWidth: '80px',
                      padding: '2px 6px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: '#0f172a',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      outline: 'none',
                    }}
                  />
                  <span className="vision-target-card__conf" style={{ fontSize: '0.7rem' }}>{Math.round(target.confidence * 100)}%</span>
                  <button
                    type="button"
                    title="Delete this item"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTarget(target.id);
                    }}
                    style={{ marginLeft: 'auto', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', width: '22px', height: '22px', lineHeight: '1', cursor: 'pointer', fontWeight: 800 }}
                  >
                    ×
                  </button>
                </div>

                {/* Dropdown assign to script step */}
                <div style={{ marginTop: '6px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569' }}>ASSIGN TO STEP:</span>
                    {target.mappedStepIndex !== undefined && (
                      <span style={{ fontSize: '0.68rem', color: '#059669', fontWeight: 800 }}>STEP #{target.mappedStepIndex + 1}</span>
                    )}
                  </div>
                  <select
                    value={target.mappedStepIndex ?? ''}
                    onChange={(e) => handleMapTargetToStep(target, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">-- Select script step to assign coordinates --</option>
                    {activeTestScript && Array.isArray(activeTestScript) && activeTestScript.map((s, sIdx) => (
                      <option key={s.id || sIdx} value={sIdx}>
                        Step #{sIdx + 1}: {s.screen ? `[${s.screen}] ` : ''}{s.target || s.action}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick POS button label suggestions */}
                <div style={{ marginTop: '6px', display: 'flex', gap: '3px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: '0.65rem', color: '#64748b', alignSelf: 'center', fontWeight: 600 }}>Quick Assign:</span>
                  {['Purchase', 'Refund', 'Cash', 'Simulated POS', 'Payment', '1', '2', '3', 'Pay', 'Enter'].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleUpdateTargetLabel(target.id, tag)}
                      style={{ fontSize: '0.68rem', padding: '1px 5px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', color: '#334155', fontWeight: 600 }}
                      title={`Set target label to "${tag}"`}
                    >
                      +{tag}
                    </button>
                  ))}
                </div>

                <div className="vision-target-card__coords" style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' }}>
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