import React from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const KeypadGrid = () => {

  const handleKeyClick = async (key) => {
    const toastId = toast.loading(`Moving to key ${key}...`);
    try {
      await axios.post('http://localhost:8000/api/cnc/sequence', {
        sequence: key,
        delay_ms: 0
      });
      toast.success(`Reached key ${key}`, { id: toastId, duration: 2000 });
    } catch (err) {
      const msg = err.response?.data?.detail || `Failed to move to key ${key}`;
      toast.error(msg, { id: toastId, duration: 3000 });
    }
  };

  const handleOrigin = async () => {
    const toastId = toast.loading('Setting coordinate origin...');
    try {
      await axios.post('http://localhost:8000/api/cnc/origin');
      toast.success('Coordinate origin set', { id: toastId, duration: 2000 });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to set origin';
      toast.error(msg, { id: toastId, duration: 3000 });
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Coordinate Keypad</h2>

      <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key => (
          <button key={key} onClick={() => handleKeyClick(key)}
            className="h-16 text-2xl font-bold rounded-xl bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-transform shadow-md">
            {key}
          </button>
        ))}

        <button onClick={handleOrigin}
          className="h-16 text-base font-bold rounded-xl bg-orange-500 text-white hover:bg-orange-600 active:scale-95 transition-transform shadow-md">
          ORIGIN
        </button>

        <button onClick={() => handleKeyClick('0')}
          className="h-16 text-2xl font-bold rounded-xl bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-transform shadow-md">
          0
        </button>

        <button disabled
          className="h-16 text-2xl font-bold rounded-xl bg-gray-400 text-white cursor-not-allowed shadow-md">
          #
        </button>
      </div>
    </div>
  );
};

export default KeypadGrid;
