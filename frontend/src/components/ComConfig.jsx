import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const ComConfig = ({ isConnected = false, setIsConnected = () => {}, secondary = false }) => {
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');

  const API_BASE = 'http://localhost:8000/api';

  useEffect(() => {
    fetchPorts();
  }, []);

  const fetchPorts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/com/ports`);
      setPorts(res.data.ports);
      if (res.data.ports.length > 0) {
        setSelectedPort(res.data.ports[0].device);
      }
    } catch (err) {
      toast.error('Unable to load COM ports');
    }
  };

  const handleConnect = async () => {
    if (secondary) {
      toast('Motor 2 API is not enabled in the backend.');
      return;
    }

    if (isConnected) {
      const toastId = toast.loading('Disconnecting...');
      try {
        await axios.post(`${API_BASE}/com/disconnect`);
        setIsConnected(false);
        toast.success('Arduino disconnected', { id: toastId });
      } catch (err) {
        toast.error('Disconnect failed', { id: toastId });
      }
    } else {
      if (!selectedPort) {
        toast.error('Please select a COM port');
        return;
      }
      const toastId = toast.loading(`Connecting to ${selectedPort}...`);
      try {
        await axios.post(`${API_BASE}/com/connect`, { port: selectedPort });
        setIsConnected(true);
        toast.success(`Connected to ${selectedPort}`, { id: toastId });
      } catch (err) {
        const msg = err.response?.data?.detail || 'COM connection failed';
        toast.error(msg, { id: toastId });
      }
    }
  };

  return (
    <div className={`connection-card bg-white p-6 rounded-2xl shadow-lg ${secondary ? 'connection-card--secondary' : ''}`}>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        {secondary ? 'Connect Motor 2' : 'Connect CNC Controller'}
      </h2>
      {secondary && (
        <p className="connection-card__hint">Select a separate COM port for the second motor.</p>
      )}
      <div className="flex gap-4 items-center">
        <select
          className="border border-gray-300 rounded-lg p-3 flex-1 text-gray-700 bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
          value={selectedPort}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={isConnected}
        >
          {ports.map((p, idx) => (
            <option key={idx} value={p.device}>{p.device} - {p.description}</option>
          ))}
          {ports.length === 0 && <option value="">No COM ports found</option>}
        </select>

        <button
          onClick={fetchPorts}
          disabled={isConnected}
          title="Refresh port list"
          className="p-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          Refresh
        </button>

        <button
          onClick={handleConnect}
          className={`px-6 py-3 rounded-lg font-bold text-white transition-colors ${isConnected ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-800 hover:bg-gray-900'}`}
        >
          {secondary ? 'CONNECT MOTOR 2' : (isConnected ? 'Disconnect' : 'CONNECT')}
        </button>
      </div>

      <div className={`mt-4 flex items-center gap-2 text-sm font-semibold ${isConnected ? 'text-green-600' : 'text-gray-400'}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
        {secondary ? 'Ready to configure, not connected' : (isConnected ? `Connected: ${selectedPort}` : 'Not connected')}
      </div>
    </div>
  );
};

export default ComConfig;
