import React, { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const ManualControl = () => {
  const [steps, setSteps] = useState(100);
  const [aSteps, setASteps] = useState(100);
  const [useSolenoid, setUseSolenoid] = useState(true);
  const [solenoidIndex, setSolenoidIndex] = useState(1);
  const [solenoidDelay, setSolenoidDelay] = useState(300);

  useEffect(() => {
    axios.get('http://localhost:8000/api/com/status').then((res) => {
      const d = res.data || {};
      if (d.a_press_steps) setASteps(d.a_press_steps);
      if (typeof d.press_use_solenoid === 'boolean') setUseSolenoid(d.press_use_solenoid);
      if (d.press_solenoid_index) setSolenoidIndex(d.press_solenoid_index);
      if (typeof d.press_solenoid_delay_ms === 'number') setSolenoidDelay(d.press_solenoid_delay_ms);
    }).catch(() => {});
  }, []);

  const savePressConfig = async (patch) => {
    try {
      await axios.post('http://localhost:8000/api/cnc/press-config', patch);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Unable to save press config');
    }
  };

  const setAOrigin = async () => {
    try {
      await axios.post('http://localhost:8000/api/cnc/a-origin');
      toast.success('Driver A origin set at the current position');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Unable to set Driver A origin');
    }
  };

  const saveASteps = async (value) => {
    setASteps(value);
    if (value < 1) return;
    try {
      await axios.post('http://localhost:8000/api/cnc/a-steps', { steps: value });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Unable to save Driver A steps');
    }
  };

  const handleMove = async (axis, stepsValue) => {
    const label = axis === 'A'
      ? (stepsValue < 0 ? 'A PRESS DOWN' : 'A RETRACT UP')
      : axis === 'X'
        ? (stepsValue > 0 ? 'X FORWARD' : 'X BACKWARD')
        : (stepsValue > 0 ? 'YZ FORWARD' : 'YZ BACKWARD');

    const toastId = toast.loading(`Moving: ${label}...`);
    try {
      await axios.post('http://localhost:8000/api/cnc/move', { axis, steps: stepsValue });
      toast.success(`Completed: ${label}`, { id: toastId });
    } catch (err) {
      const msg = err.response?.data?.detail || `Failed to move axis ${axis}`;
      toast.error(msg, { id: toastId });
    }
  };

  const handleSolenoid = async (index) => {
    const toastId = toast.loading(`Triggering Solenoid S${index}...`);
    try {
      await axios.post('http://localhost:8000/api/cnc/solenoid', { index });
      toast.success(`Solenoid S${index} Triggered`, { id: toastId });
    } catch (err) {
      const msg = err.response?.data?.detail || `Failed to trigger S${index}`;
      toast.error(msg, { id: toastId });
    }
  };

  return (
    <div className="manual-control bg-white p-6 rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Manual Control</h2>
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-600 mb-1">Steps per move</label>
        <input type="number" value={steps} onChange={(e) => setSteps(parseInt(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
      </div>

      <div className="manual-control__grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
          <h3 className="font-bold mb-3 text-gray-700">X AXIS</h3>
          <div className="flex gap-2 justify-center">
            <button onClick={() => handleMove('X', -steps)}
              className="manual-control__button flex-1 bg-red-500 text-white font-bold py-3 rounded-lg hover:bg-red-600 transition-colors shadow active:scale-95">
              ← BACKWARD
            </button>
            <button onClick={() => handleMove('X', steps)}
              className="manual-control__button flex-1 bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 transition-colors shadow active:scale-95">
              FORWARD →
            </button>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
          <h3 className="font-bold mb-3 text-gray-700">Y+Z AXIS</h3>
          <div className="flex gap-2 justify-center">
            <button onClick={() => handleMove('YZ', -steps)}
              className="manual-control__button flex-1 bg-red-500 text-white font-bold py-3 rounded-lg hover:bg-red-600 transition-colors shadow active:scale-95">
              ← BACKWARD
            </button>
            <button onClick={() => handleMove('YZ', steps)}
              className="manual-control__button flex-1 bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 transition-colors shadow active:scale-95">
              FORWARD →
            </button>
          </div>
        </div>

        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-center">
          <h3 className="font-bold mb-3 text-amber-800">DRIVER A (PRESS)</h3>
          <input type="number" min="1" value={aSteps}
            onChange={(e) => saveASteps(parseInt(e.target.value) || 0)}
            className="w-full border border-amber-300 rounded-lg p-2 mb-3 text-center font-mono" />
          <label className="flex items-center justify-center gap-2 text-sm font-semibold text-amber-800 mb-2">
            <input type="checkbox" checked={useSolenoid}
              onChange={(e) => { setUseSolenoid(e.target.checked); savePressConfig({ use_solenoid: e.target.checked }); }} />
            Fire solenoid after press down
          </label>
          {useSolenoid && (
            <div className="flex gap-2 mb-3">
              <select value={solenoidIndex}
                onChange={(e) => { const v = parseInt(e.target.value); setSolenoidIndex(v); savePressConfig({ solenoid_index: v }); }}
                className="flex-1 border border-amber-300 rounded-lg p-2 text-center font-mono">
                <option value={1}>S1</option>
                <option value={2}>S2</option>
              </select>
              <input type="number" min="0" step="50" value={solenoidDelay} title="Delay (ms) after firing, before lifting"
                onChange={(e) => { const v = Math.max(0, parseInt(e.target.value) || 0); setSolenoidDelay(v); savePressConfig({ solenoid_delay_ms: v }); }}
                className="flex-1 border border-amber-300 rounded-lg p-2 text-center font-mono" />
            </div>
          )}
          <div className="flex gap-2 justify-center">
            <button onClick={() => handleMove('A', -aSteps)}
              className="manual-control__button flex-1 bg-sky-500 text-white font-bold py-3 rounded-lg hover:bg-sky-600 transition-colors shadow active:scale-95">
              PRESS DOWN
            </button>
            <button onClick={() => handleMove('A', aSteps)}
              className="manual-control__button flex-1 bg-amber-500 text-white font-bold py-3 rounded-lg hover:bg-amber-600 transition-colors shadow active:scale-95">
              RETRACT UP
            </button>
          </div>
          <button onClick={setAOrigin}
            className="w-full mt-3 bg-gray-700 text-white font-bold py-2 rounded-lg hover:bg-gray-800 transition-colors">
            SET A ORIGIN
          </button>
        </div>

        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 text-center">
          <h3 className="font-bold mb-3 text-purple-800">SOLENOIDS (RELAYS)</h3>
          <p className="text-xs text-purple-600 mb-3 font-medium">Test active low solenoids</p>
          <div className="flex gap-2 justify-center h-[52px]">
            <button onClick={() => handleSolenoid(1)}
              className="manual-control__button flex-1 bg-purple-500 text-white font-bold rounded-lg hover:bg-purple-600 transition-colors shadow active:scale-95">
              FIRE S1
            </button>
            <button onClick={() => handleSolenoid(2)}
              className="manual-control__button flex-1 bg-purple-500 text-white font-bold rounded-lg hover:bg-purple-600 transition-colors shadow active:scale-95">
              FIRE S2
            </button>
          </div>
          <button onClick={() => handleSolenoid(1)}
            className="w-full mt-3 bg-gray-700 text-white font-bold py-2 rounded-lg hover:bg-gray-800 transition-colors opacity-0 pointer-events-none">
            SPACER
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualControl;
