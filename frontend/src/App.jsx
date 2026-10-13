import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/layout/Sidebar';
import TopHeader from './components/layout/TopHeader';
import AiTestWorkbench from './components/AiTestWorkbench';
import WebcamOcrPanel from './components/WebcamOcrPanel';
import SettingsTab from './components/SettingsTab';

function App() {
  const [activeTab, setActiveTab] = useState('ai-studio');
  const [isConnected, setIsConnected] = useState(false);

  // Centralized Camera Management (Single stream shared across tabs to eliminate lag and driver locking)
  const [sharedStream, setSharedStream] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(true);
  const streamRef = useRef(null);

  // Enumerate cameras once
  const refreshCameraList = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
      setCameras(videoDevs);
      return videoDevs;
    } catch {
      return [];
    }
  }, []);

  // Start single camera stream
  const startCamera = useCallback(async (deviceId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('WebRTC Camera is unavailable in this browser.');
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const constraints = {
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setSharedStream(stream);
      setCameraError('');

      const available = await refreshCameraList();
      if (!deviceId && available.length > 0) {
        const preferred = available.find((c) => /iriun|usb|external|webcam|camera/i.test(c.label)) || available[0];
        setSelectedCameraId(preferred.deviceId);
      }
    } catch (err) {
      console.warn('Camera stream error:', err);
      setCameraError(err.message || 'Unable to open camera');
      setSharedStream(null);
    }
  }, [refreshCameraList]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setSharedStream(null);
    setIsCameraActive(false);
  }, []);

  const toggleCamera = useCallback(() => {
    if (isCameraActive) {
      stopCamera();
    } else {
      setIsCameraActive(true);
      startCamera(selectedCameraId);
    }
  }, [isCameraActive, stopCamera, startCamera, selectedCameraId]);

  const handleSelectCamera = useCallback((newId) => {
    setSelectedCameraId(newId);
    if (isCameraActive) {
      startCamera(newId);
    }
  }, [isCameraActive, startCamera]);

  useEffect(() => {
    if (isCameraActive) {
      startCamera(selectedCameraId);
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Shared test script state
  const [testScript, setTestScript] = useState([]);
  const [aiTargets, setAiTargets] = useState([]);
  const [isExecutingScript, setIsExecutingScript] = useState(false);
  const [executionProgress, setExecutionProgress] = useState({
    current: 0,
    total: 0,
    stepName: '',
  });

  // Step update handler called by WebcamOcrPanel runner
  const handleStepUpdate = (index, status) => {
    setTestScript((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status };
      }
      return next;
    });

    if (status === 'running') {
      setExecutionProgress((prev) => ({
        ...prev,
        current: index + 1,
        total: testScript.length,
        stepName: testScript[index]?.target || `Step ${index + 1}`,
      }));
    }
  };

  const handleCompleteExecution = () => {
    setIsExecutingScript(false);
  };

  // Transfer detected vision elements to AI Test Studio
  const handleSendTargetsToStudio = (targetsToSend = aiTargets) => {
    const list = targetsToSend.length > 0 ? targetsToSend : aiTargets;
    if (!list || list.length === 0) {
      return;
    }
    const convertedSteps = list.map((target, idx) => ({
      id: idx + 1,
      action: 'CLICK',
      target: target.label || `Target #${target.id || idx + 1}`,
      value: '',
      delay_ms: 600,
      description: `Tap ${target.label} (CNC X: ${target.cnc_x}, Y: ${target.cnc_y})`,
      status: 'idle',
      cnc_x: target.cnc_x,
      cnc_y: target.cnc_y,
      pixel_x: target.pixel_x,
      pixel_y: target.pixel_y,
    }));
    setTestScript(convertedSteps);
    setActiveTab('ai-studio');
  };

  // Called when user clicks Execute in Tab 1 (AI Test Studio)
  const handleExecuteFromAiStudio = (scriptToExecute) => {
    const pendingScript = scriptToExecute.map((s) => ({
      ...s,
      status: 'pending',
    }));
    setTestScript(pendingScript);
    // Switch to Tab 2: Computer Vision & AI Alignment (wait for user frame setup, zero origin and detect before executing)
    setActiveTab('vision-alignment');
    setIsExecutingScript(false);
    setExecutionProgress({
      current: 0,
      total: scriptToExecute.length,
      stepName: 'Waiting for Setup & Vision Detection',
    });
  };

  const passedCount = testScript.filter((s) => s.status === 'passed').length;

  return (
    <div className="min-h-screen bg-[#f4f7fa] text-slate-800 flex flex-col md:flex-row font-sans">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          icon: null,
          style: {
            borderRadius: '10px',
            fontWeight: '600',
            fontSize: '13.5px',
            padding: '12px 18px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            background: '#ffffff',
            color: '#2c3e50',
            border: '1px solid #e2e8f0',
          },
          success: {
            icon: null,
            style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
          },
          error: {
            icon: null,
            style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' },
          },
          loading: {
            icon: null,
          },
        }}
      />

      {/* Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isConnected={isConnected}
        testScript={testScript}
        isExecutingScript={isExecutingScript}
        passedCount={passedCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar Header */}
        <TopHeader activeTab={activeTab} isConnected={isConnected} />

        {/* Main Body */}
        <main className="flex-1 p-5 md:p-8 overflow-y-auto space-y-6">
          {/* ===============================================================
              TAB CONTENT SECTIONS
              =============================================================== */}
          {/* Tab 1: AI Test Studio */}
          <div style={{ display: activeTab === 'ai-studio' ? 'block' : 'none' }}>
            <AiTestWorkbench
              testScript={testScript}
              setTestScript={setTestScript}
              aiTargets={aiTargets}
              setAiTargets={setAiTargets}
              onImportFromVision={handleSendTargetsToStudio}
              onExecuteTest={handleExecuteFromAiStudio}
              isExecuting={isExecutingScript}
              executionProgress={executionProgress}
              switchToVisionTab={() => setActiveTab('vision-alignment')}
              sharedStream={sharedStream}
              cameras={cameras}
              selectedCameraId={selectedCameraId}
              onSelectCamera={handleSelectCamera}
              onRefreshCameras={refreshCameraList}
              isCameraActive={isCameraActive}
              onToggleCamera={toggleCamera}
              cameraError={cameraError}
            />
          </div>

          {/* Tab 2: Computer Vision & AI Alignment */}
          <div style={{ display: activeTab === 'vision-alignment' ? 'block' : 'none' }}>
            <WebcamOcrPanel
              activeTestScript={testScript}
              setTestScript={setTestScript}
              aiTargets={aiTargets}
              setAiTargets={setAiTargets}
              onSendToAiStudio={handleSendTargetsToStudio}
              onStepUpdate={handleStepUpdate}
              onCompleteExecution={handleCompleteExecution}
              isExecutingScript={isExecutingScript}
              onSwitchToAiStudio={() => setActiveTab('ai-studio')}
              sharedStream={sharedStream}
              cameras={cameras}
              cameraId={selectedCameraId}
              setCameraId={handleSelectCamera}
            />
          </div>

          {/* Tab 3: CNC Settings & Hardware Control */}
          <div style={{ display: activeTab === 'cnc-settings' ? 'block' : 'none' }}>
            <SettingsTab
              isConnected={isConnected}
              setIsConnected={setIsConnected}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
