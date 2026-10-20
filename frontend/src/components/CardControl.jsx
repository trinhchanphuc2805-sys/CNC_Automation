import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE = 'http://localhost:8000/api';

const CardControl = () => {
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudrate, setBaudrate] = useState(115200);
  const [isConnected, setIsConnected] = useState(false);
  const [activePort, setActivePort] = useState(null);
  const [loading, setLoading] = useState(false);

  // Settings for Servos (Supports float values < 1 like 0.2, 0.5)
  const [insertSeconds, setInsertSeconds] = useState(2);
  const [ejectSeconds, setEjectSeconds] = useState(2);
  const [swipeSeconds, setSwipeSeconds] = useState(2);
  const [holdSeconds, setHoldSeconds] = useState(2);

  // Settings for SG90 NFC Micro Servo (0 - 180 degrees)
  const [nfcAngle, setNfcAngle] = useState(90);

  // Flag to only initialize durations from backend ONCE, avoiding polling overwrite
  const isInitializedRef = useRef(false);

  // Raw command & action status
  const [rawCmd, setRawCmd] = useState('');
  const [actionInProgress, setActionInProgress] = useState('');

  const parseSec = (val, fallback = 2) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0 ? num : fallback;
  };

  const syncConfig = async (field, val) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      try {
        await axios.post(`${API_BASE}/card/config`, { [field]: num });
      } catch (err) {
        console.warn('Failed to sync card config:', err);
      }
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/card/status`);
      if (res.data) {
        setIsConnected(Boolean(res.data.connected));
        setActivePort(res.data.port || null);
        if (!isInitializedRef.current) {
          isInitializedRef.current = true;
          if (res.data.default_insert_seconds != null) setInsertSeconds(res.data.default_insert_seconds);
          if (res.data.default_eject_seconds != null) setEjectSeconds(res.data.default_eject_seconds);
          if (res.data.default_swipe_seconds != null) setSwipeSeconds(res.data.default_swipe_seconds);
        }
      }
    } catch {
      // ignore if backend not reachable yet
    }
  };

  const fetchPorts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/card/ports`);
      const list = res.data?.ports || [];
      setPorts(list);
      if (list.length > 0 && !selectedPort) {
        setSelectedPort(list[0].device);
      }
    } catch (err) {
      console.warn('Unable to list card COM ports:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchPorts();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    if (!selectedPort) {
      toast.error('Please select the ESP32 Servo COM port');
      return;
    }
    setLoading(true);
    const toastId = toast.loading(`Connecting to ESP32 at ${selectedPort}...`);
    try {
      await axios.post(`${API_BASE}/card/connect`, { port: selectedPort, baudrate });
      setIsConnected(true);
      setActivePort(selectedPort);
      toast.success(`Successfully connected to ESP32 Servo on ${selectedPort}!`, { id: toastId });
      fetchStatus();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Connection failed: ${msg}`, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/card/disconnect`);
      setIsConnected(false);
      setActivePort(null);
      toast.success('Disconnected from ESP32 Servo');
      fetchStatus();
    } catch (err) {
      toast.error('Error disconnecting: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  // High-level Actions: Option 1 (Insert Card - Pin 18)
  const handleInsertCard = async () => {
    const sec = parseSec(insertSeconds, 0.5);
    setActionInProgress('insert');
    const toastId = toast.loading(`Inserting card (Servo D18 - ${sec}s)...`);
    try {
      await axios.post(`${API_BASE}/card/insert`, { seconds: sec });
      toast.success(`Card inserted successfully! (${sec}s)`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error inserting card', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  const handleEjectCard = async () => {
    const sec = parseSec(ejectSeconds, 0.5);
    setActionInProgress('eject');
    const toastId = toast.loading(`Ejecting card (Servo D18 - ${sec}s)...`);
    try {
      await axios.post(`${API_BASE}/card/eject`, { seconds: sec });
      toast.success(`Card ejected successfully! (${sec}s)`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error ejecting card', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  const handleInsertAndEjectCycle = async () => {
    const insSec = parseSec(insertSeconds, 0.5);
    const hldSec = !isNaN(parseFloat(holdSeconds)) && parseFloat(holdSeconds) >= 0 ? parseFloat(holdSeconds) : 1;
    const ejSec = parseSec(ejectSeconds, 0.5);
    setActionInProgress('cycle_insert');
    const toastId = toast.loading(`Running cycle: Insert -> Hold ${hldSec}s -> Eject...`);
    try {
      await axios.post(`${API_BASE}/card/insert-and-eject`, {
        insert_seconds: insSec,
        hold_seconds: hldSec,
        eject_seconds: ejSec,
      });
      toast.success('Completed insert and eject cycle!', { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Card cycle error', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  // High-level Actions: Option 2 (Swipe Card - Pin 33)
  const handleSwipeCard = async (dir = 'a') => {
    const sec = parseSec(swipeSeconds, 0.5);
    const dirLabel = dir === 'a' ? 'Tiến (A)' : 'Lùi (B)';
    setActionInProgress(`swipe_${dir}`);
    const toastId = toast.loading(`Swiping card ${dirLabel} (Servo D33 - ${sec}s)...`);
    try {
      await axios.post(`${API_BASE}/card/swipe`, { seconds: sec, direction: dir });
      toast.success(`Card swiped successfully! (${dirLabel})`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error swiping card', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  const handleSwipeAndReturnCycle = async () => {
    const sec = parseSec(swipeSeconds, 0.5);
    setActionInProgress('cycle_swipe');
    const toastId = toast.loading(`Two-way card swipe cycle (Servo D33: Swipe -> Return)...`);
    try {
      await axios.post(`${API_BASE}/card/swipe-and-return`, {
        swipe_seconds: sec,
        return_seconds: sec,
      });
      toast.success('Completed two-way swipe cycle!', { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Swipe cycle error', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  // High-level Actions: Option 3 (SG90 NFC Micro Servo - Pin 19)
  const handleNfcTap = async (customAngle) => {
    const ang = customAngle !== undefined ? customAngle : Math.max(0, Math.min(180, parseInt(nfcAngle) || 90));
    setActionInProgress('nfc_tap');
    const toastId = toast.loading(`SG90 (D19): Tapping NFC card at ${ang}°...`);
    try {
      await axios.post(`${API_BASE}/card/nfc/tap`, { angle: ang });
      toast.success(`NFC Tap executed successfully! (${ang}° -> Hold 1s -> 0°)`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error tapping NFC card', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  const handleNfcSetAngle = async (targetAngle) => {
    const ang = targetAngle !== undefined ? targetAngle : Math.max(0, Math.min(180, parseInt(nfcAngle) || 0));
    if (targetAngle !== undefined) setNfcAngle(targetAngle);
    setActionInProgress('nfc_angle');
    const toastId = toast.loading(`SG90 (D19): Moving to angle ${ang}°...`);
    try {
      await axios.post(`${API_BASE}/card/nfc/angle`, { angle: ang });
      toast.success(`SG90 rotated to ${ang}°!`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error moving SG90', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  // Low-level Servo Jog
  const handleServoJog = async (servoPin, dir, sec) => {
    setActionInProgress(`servo_${servoPin}_${dir}`);
    const endpoint = servoPin === 33 ? `${API_BASE}/card/servo33` : `${API_BASE}/card/servo12`;
    const toastId = toast.loading(`Servo D${servoPin}: Command '${dir}' for ${sec}s...`);
    try {
      await axios.post(endpoint, { direction: dir, seconds: sec });
      toast.success(`D${servoPin} executed '${dir}' (${sec}s)`, { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Servo control error', { id: toastId });
    } finally {
      setActionInProgress('');
    }
  };

  // Send Raw String Command
  const handleSendRaw = async (e) => {
    e.preventDefault();
    if (!rawCmd.trim()) return;
    const cmd = rawCmd.trim();
    const toastId = toast.loading(`Sending command '${cmd}'...`);
    try {
      const res = await axios.post(`${API_BASE}/card/command`, { command: cmd });
      toast.success(`Response: ${res.data?.message || 'OK'}`, { id: toastId });
      setRawCmd('');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Command error', { id: toastId });
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Serial COM Connection */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />
        <div className="pb-4 mb-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                ESP32 3x SERVO CONTROLLER (CARD POS & NFC)
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                Insert, Swipe & NFC Tap
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              D18 (MG996R Insert / Eject) • D33 (MG996R Swipe Card) • D19 (SG90 180° Micro Servo - Vẫy chạm thẻ NFC)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold text-white flex items-center gap-1.5 shadow-xs ${
                isConnected ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-white animate-ping' : 'bg-white/60'}`} />
              {isConnected ? `CONNECTED: ${activePort}` : 'ESP32 DISCONNECTED'}
            </span>
          </div>
        </div>

        {/* COM Port Selector */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-slate-50/80 p-4 rounded-xl border border-slate-200">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">
              ESP32 SERIAL COM PORT
            </label>
            <div className="flex gap-2">
              <select
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                disabled={isConnected || loading}
                className="flex-1 bg-white border border-slate-300 rounded-lg py-2.5 px-3 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Select ESP32 COM Port --</option>
                {ports.map((p) => (
                  <option key={p.device} value={p.device}>
                    {p.device} - {p.description || 'USB Serial Device'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={fetchPorts}
                disabled={loading}
                title="Refresh COM ports"
                className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700 text-xs font-bold transition-all cursor-pointer"
              >
                Refresh
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase">Baudrate</label>
            <select
              value={baudrate}
              onChange={(e) => setBaudrate(Number(e.target.value))}
              disabled={isConnected || loading}
              className="w-full bg-white border border-slate-300 rounded-lg py-2.5 px-3 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={115200}>115200 bps (Default ESP32)</option>
              <option value={9600}>9600 bps</option>
              <option value={57600}>57600 bps</option>
            </select>
          </div>

          <div>
            {isConnected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={loading}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all shadow cursor-pointer active:scale-98"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={loading || !selectedPort}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all shadow cursor-pointer active:scale-98 flex items-center justify-center gap-1.5"
              >
                <span>Connect ESP32</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main 3 Options Grid: INSERT CARD | SWIPE CARD | NFC TAP */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* OPTION 1: INSERT CARD (D18) */}
        <div className="bg-white rounded-2xl border border-blue-200 p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 to-cyan-400" />
          <div>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-blue-100">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-blue-100 text-blue-700 text-xs font-bold">SLOT</span>
                <div>
                  <h3 className="text-sm font-extrabold text-blue-900 tracking-tight">OPTION 1: INSERT CARD</h3>
                  <p className="text-[11px] text-blue-600 font-medium">Servo D18 (Chèn / Rút Thẻ)</p>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                PIN D18 (l, r)
              </span>
            </div>

            {/* Time Settings */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-100">
                <label className="block text-[11px] font-bold text-blue-800 mb-1">Insert Duration (s)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="30"
                    value={insertSeconds}
                    onChange={(e) => setInsertSeconds(e.target.value)}
                    onBlur={(e) => syncConfig('default_insert_seconds', e.target.value)}
                    className="w-full bg-white border border-blue-200 rounded-lg p-1.5 text-center text-xs font-bold font-mono text-blue-900 outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="text-[11px] font-bold text-blue-700">s</span>
                </div>
              </div>
              <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-100">
                <label className="block text-[11px] font-bold text-blue-800 mb-1">Eject Duration (s)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="30"
                    value={ejectSeconds}
                    onChange={(e) => setEjectSeconds(e.target.value)}
                    onBlur={(e) => syncConfig('default_eject_seconds', e.target.value)}
                    className="w-full bg-white border border-blue-200 rounded-lg p-1.5 text-center text-xs font-bold font-mono text-blue-900 outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="text-[11px] font-bold text-blue-700">s</span>
                </div>
              </div>
            </div>

            {/* Direct Action Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={handleInsertCard}
                disabled={!isConnected || actionInProgress !== ''}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-3 px-2 rounded-xl text-xs transition-all shadow active:scale-95 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
              >
                <span>INSERT CARD</span>
                <span className="text-[10px] font-mono opacity-80">(Cmd: l{insertSeconds})</span>
              </button>

              <button
                type="button"
                onClick={handleEjectCard}
                disabled={!isConnected || actionInProgress !== ''}
                className="bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-3 px-2 rounded-xl text-xs transition-all shadow active:scale-95 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
              >
                <span>EJECT CARD</span>
                <span className="text-[10px] font-mono opacity-80">(Cmd: r{ejectSeconds})</span>
              </button>
            </div>

            {/* Automated Cycle */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 p-2.5 rounded-xl border border-blue-200/80 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-900">Chu Trình Tự Động</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-blue-700">Giữ thẻ:</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={holdSeconds}
                    onChange={(e) => setHoldSeconds(e.target.value)}
                    className="w-12 bg-white border border-blue-300 rounded px-1 py-0.5 text-center text-[11px] font-mono font-bold outline-none"
                  />
                  <span className="text-[10px] text-blue-700">s</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleInsertAndEjectCycle}
                disabled={!isConnected || actionInProgress !== ''}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-bold py-2 px-3 rounded-lg text-xs transition-all shadow active:scale-98 flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>INSERT &rarr; HOLD &rarr; EJECT</span>
              </button>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 italic text-center">
            * D18 quay Trái (l) đưa thẻ vào slot, quay Phải (r) để nhả thẻ ra.
          </div>
        </div>

        {/* OPTION 2: SWIPE CARD (D33) */}
        <div className="bg-white rounded-2xl border border-purple-200 p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 to-pink-500" />
          <div>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-purple-100">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-purple-100 text-purple-700 text-xs font-bold">SWIPE</span>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-900 tracking-tight">OPTION 2: SWIPE CARD</h3>
                  <p className="text-[11px] text-purple-600 font-medium">Servo D33 (Quẹt Thẻ Từ POS)</p>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                PIN D33 (a, b)
              </span>
            </div>

            {/* Time Settings */}
            <div className="bg-purple-50/60 p-2.5 rounded-xl border border-purple-100 mb-4">
              <label className="block text-[11px] font-bold text-purple-800 mb-1">Swipe Duration (s)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="30"
                  value={swipeSeconds}
                  onChange={(e) => setSwipeSeconds(e.target.value)}
                  onBlur={(e) => syncConfig('default_swipe_seconds', e.target.value)}
                  className="w-full bg-white border border-purple-200 rounded-lg p-1.5 text-center text-xs font-bold font-mono text-purple-900 outline-none focus:ring-2 focus:ring-purple-400"
                />
                <span className="text-[11px] font-bold text-purple-700">s</span>
              </div>
            </div>

            {/* Direct Action Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => handleSwipeCard('a')}
                disabled={!isConnected || actionInProgress !== ''}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-3 px-2 rounded-xl text-xs transition-all shadow active:scale-95 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
              >
                <span>QUẸT TIẾN</span>
                <span className="text-[10px] font-mono opacity-80">(Cmd: a{swipeSeconds})</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwipeCard('b')}
                disabled={!isConnected || actionInProgress !== ''}
                className="bg-pink-600 hover:bg-pink-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-3 px-2 rounded-xl text-xs transition-all shadow active:scale-95 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
              >
                <span>QUẸT LÙI</span>
                <span className="text-[10px] font-mono opacity-80">(Cmd: b{swipeSeconds})</span>
              </button>
            </div>

            {/* Automated Cycle */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50/50 p-2.5 rounded-xl border border-purple-200/80 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-purple-900">Quẹt Thẻ 2 Chiều</span>
                <span className="text-[10px] text-purple-700">Tiến &rarr; Chờ &rarr; Về</span>
              </div>
              <button
                type="button"
                onClick={handleSwipeAndReturnCycle}
                disabled={!isConnected || actionInProgress !== ''}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-bold py-2 px-3 rounded-lg text-xs transition-all shadow active:scale-98 flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>QUẸT TIẾN &rarr; THU VỀ</span>
              </button>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 italic text-center">
            * D33 quay Tiến (a) kéo thẻ qua rãnh quẹt, quay Lùi (b) để trả về vị trí chờ.
          </div>
        </div>

        {/* OPTION 3: NFC TAP / CONTACTLESS CARD (SG90 - D19) */}
        <div className="bg-white rounded-2xl border border-emerald-200 p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-emerald-100">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-bold">NFC</span>
                <div>
                  <h3 className="text-sm font-extrabold text-emerald-900 tracking-tight">OPTION 3: NFC TAP CARD</h3>
                  <p className="text-[11px] text-emerald-600 font-medium">Micro SG90 180° (Vẫy Thẻ Chạm POS)</p>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                PIN D19 (n, g)
              </span>
            </div>

            {/* Target Angle Slider & Input */}
            <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-emerald-900">Góc Vẫy / Quay (0° - 180°)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={nfcAngle}
                    onChange={(e) => setNfcAngle(Math.max(0, Math.min(180, parseInt(e.target.value) || 0)))}
                    className="w-14 bg-white border border-emerald-300 rounded px-1.5 py-0.5 text-center text-xs font-mono font-bold text-emerald-900 outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                  <span className="text-xs font-bold text-emerald-700">°</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="180"
                value={nfcAngle}
                onChange={(e) => setNfcAngle(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-emerald-700 mt-1">
                <span>0° (Thu về)</span>
                <span>45°</span>
                <span>90° (Vuông góc)</span>
                <span>135°</span>
                <span>180° (Tối đa)</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 mb-3">
              <button
                type="button"
                onClick={() => handleNfcTap(nfcAngle)}
                disabled={!isConnected || actionInProgress !== ''}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-extrabold py-3 px-3 rounded-xl text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>VẪY THẺ CHẠM NFC (TAP & RETURN)</span>
                <span className="text-[10px] font-mono opacity-85">(Cmd: n{nfcAngle})</span>
              </button>

              <button
                type="button"
                onClick={() => handleNfcSetAngle(nfcAngle)}
                disabled={!isConnected || actionInProgress !== ''}
                className="w-full bg-white hover:bg-emerald-50 border border-emerald-300 disabled:bg-slate-100 disabled:text-slate-400 text-emerald-800 font-bold py-2 px-3 rounded-xl text-xs transition-all shadow-xs active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Quay SG90 Cố Định Đến Góc {nfcAngle}°</span>
                <span className="text-[10px] font-mono text-emerald-600">(Cmd: g{nfcAngle})</span>
              </button>
            </div>

            {/* Quick Angle Presets */}
            <div className="grid grid-cols-5 gap-1">
              {[0, 45, 90, 120, 180].map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => handleNfcSetAngle(deg)}
                  disabled={!isConnected || actionInProgress !== ''}
                  className="bg-emerald-100/70 hover:bg-emerald-200 text-emerald-800 font-bold py-1 px-1 rounded text-[10px] transition-all cursor-pointer text-center"
                >
                  {deg === 0 ? 'Home 0°' : `${deg}°`}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-2 italic text-center">
            * SG90 vươn ra góc đặt, giữ 1 giây cho POS đọc NFC, rồi tự thu về góc 0°.
          </div>
        </div>
      </div>

      {/* 3. Diagnostic & Manual Jog Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
        <div className="pb-3 mb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 tracking-tight uppercase">
              3-SERVO MANUAL DIAGNOSTICS & RAW SERIAL
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Kiểm tra nhanh từng động cơ Servo hoặc gửi lệnh Serial trực tiếp xuống ESP32
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* D18 Jog */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center">
            <h4 className="font-extrabold text-[11px] text-slate-700 uppercase mb-2">D18 (MG996R Insert)</h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleServoJog(18, 'l', 0.5)}
                disabled={!isConnected}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Trái (l0.5)
              </button>
              <button
                type="button"
                onClick={() => handleServoJog(18, 'r', 0.5)}
                disabled={!isConnected}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Phải (r0.5)
              </button>
            </div>
          </div>

          {/* D33 Jog */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center">
            <h4 className="font-extrabold text-[11px] text-slate-700 uppercase mb-2">D33 (MG996R Swipe)</h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleServoJog(33, 'a', 0.5)}
                disabled={!isConnected}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Tiến (a0.5)
              </button>
              <button
                type="button"
                onClick={() => handleServoJog(33, 'b', 0.5)}
                disabled={!isConnected}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Lùi (b0.5)
              </button>
            </div>
          </div>

          {/* D19 SG90 Quick */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center">
            <h4 className="font-extrabold text-[11px] text-slate-700 uppercase mb-2">D19 (SG90 NFC)</h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleNfcSetAngle(0)}
                disabled={!isConnected}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Về 0° (g0)
              </button>
              <button
                type="button"
                onClick={() => handleNfcTap(90)}
                disabled={!isConnected}
                className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-bold py-1.5 px-1.5 rounded-lg text-[11px] cursor-pointer active:scale-95 transition-all"
              >
                Vẫy (n90)
              </button>
            </div>
          </div>

          {/* Raw Command Sender */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <h4 className="font-extrabold text-[11px] text-slate-700 uppercase mb-1.5">Direct Raw Serial</h4>
            <form onSubmit={handleSendRaw} className="flex gap-1.5">
              <input
                type="text"
                value={rawCmd}
                onChange={(e) => setRawCmd(e.target.value)}
                placeholder="l0.5, a0.8, n90, g45..."
                disabled={!isConnected}
                className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={!isConnected || !rawCmd.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold px-3 py-1 rounded-lg text-xs cursor-pointer transition-all"
              >
                Send
              </button>
            </form>
            <p className="text-[9px] text-slate-500 mt-1 font-mono">
              l/r(D18) • a/b(D33) • g[0-180]/n[0-180](D19)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardControl;
