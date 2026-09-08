import React, { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const ManualControl = () => {
  const [steps, setSteps] = useState(100);
  const [aSteps, setASteps] = useState(100);

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

  return (
    <div className="manual-control bg-white p-6 rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Manual Control</h2>
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-600 mb-1">Steps per move</label>
        <input type="number" value={steps} onChange={(e) => setSteps(parseInt(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
      </div>

      <div className="manual-control__grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>
    </div>
  );
};

export default ManualControl;
