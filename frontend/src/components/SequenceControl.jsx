import React, { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const SequenceControl = () => {
  const [sequence, setSequence] = useState('');
  const [delay, setDelay] = useState(1000);
  const [aSteps, setASteps] = useState(100);
  const [isRunning, setIsRunning] = useState(false);

  const handleRunSequence = async () => {
    if (!sequence) {
      toast.error('Please enter a numeric sequence (e.g. 123456)');
      return;
    }

    const toastId = toast.loading(`Running sequence: ${sequence}...`);
    setIsRunning(true);
    try {
      await axios.post('http://localhost:8000/api/cnc/sequence', {
        sequence: sequence,
        delay_ms: delay,
        a_steps: aSteps
      });
      toast.success(`Sequence completed: ${sequence}`, { id: toastId, duration: 3000 });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Sequence failed';
      toast.error(msg, { id: toastId, duration: 4000 });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Automatic Sequence Control</h2>

      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-600 mb-1">Enter sequence (e.g. 123456)</label>
        <input type="text" value={sequence} onChange={(e) => setSequence(e.target.value)}
          placeholder="Enter sequence..."
          className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-xl text-center font-mono tracking-[0.5em]" />
      </div>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-600 mb-1">Driver A press steps</label>
        <input type="number" min="1" value={aSteps} onChange={(e) => setASteps(parseInt(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg p-3 mb-4 outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50 text-center text-lg font-mono" />

        <label className="block text-sm font-semibold text-gray-600 mb-1">Delay between keys (ms)</label>
        <input type="number" value={delay} onChange={(e) => setDelay(parseInt(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
      </div>

      <button onClick={handleRunSequence} disabled={isRunning}
        className={`w-full text-white font-bold py-4 rounded-xl text-xl transition-colors shadow-lg flex items-center justify-center gap-2 active:scale-95 ${isRunning ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {isRunning ? 'RUNNING...' : 'RUN SEQUENCE'}
      </button>
    </div>
  );
};

export default SequenceControl;
