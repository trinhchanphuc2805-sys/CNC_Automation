import React, { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const KeypadConfig = () => {
  const [config, setConfig] = useState({
    x1: 0,
    y1: 0,
    spach_x: 100,
    spach_y: 100
  });

  const handleChange = (e) => {
    setConfig({ ...config, [e.target.name]: parseFloat(e.target.value) || 0 });
  };

  const handleSave = async () => {
    const toastId = toast.loading('Saving keypad configuration...');
    try {
      await axios.post('http://localhost:8000/api/keypad/config', config);
      toast.success('Keypad configuration saved and origin set', { id: toastId });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to save keypad configuration';
      toast.error(msg, { id: toastId });
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Keypad Configuration</h2>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1">X (key 1 position)</label>
          <input name="x1" type="number" value={config.x1} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1">Y (key 1 position)</label>
          <input name="y1" type="number" value={config.y1} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1">X spacing</label>
          <input name="spach_x" type="number" value={config.spach_x} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1">Y spacing</label>
          <input name="spach_y" type="number" value={config.spach_y} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center text-lg font-mono" />
        </div>
      </div>
      <button onClick={handleSave}
        className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg active:scale-95">
        SAVE CONFIGURATION & SET ORIGIN
      </button>
    </div>
  );
};

export default KeypadConfig;
