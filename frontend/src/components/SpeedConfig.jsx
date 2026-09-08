import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const MIN_SPEED = 100;
const MAX_SPEED = 5000;
const MIN_DELAY = 0;
const MAX_DELAY = 5000;

const SpeedConfig = () => {
  const [speed, setSpeed] = useState(1000);
  const [delay, setDelay] = useState(500);
  const [loading, setLoading] = useState(false);

  // Fetch current speed config on mount
  useEffect(() => {
    axios.get('http://localhost:8000/api/cnc/speed')
      .then(res => {
        setSpeed(res.data.speed);
        setDelay(res.data.delay_between_keys);
      })
      .catch(() => {});
  }, []);

  const handleApply = async () => {
    setLoading(true);
    const toastId = toast.loading('Updating speed...');
    try {
      await axios.post('http://localhost:8000/api/cnc/speed', {
        speed: speed,
        delay_between_keys: delay,
      });
      toast.success('Speed and delay updated', { id: toastId });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to update speed';
      toast.error(msg, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const clamp = (val, min, max) => Math.min(Math.max(Number(val) || min, min), max);

  return (
    <div className="speed-config-card">
      <h2 className="section-title">Speed Settings</h2>

      {/* Speed slider */}
      <div className="speed-row">
        <div className="speed-label-row">
          <span className="speed-label">Movement Speed</span>
          <span className="speed-badge">{speed} <small>steps/s</small></span>
        </div>
        <div className="speed-control-row">
          <input
            id="speed-slider"
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={50}
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="speed-slider"
          />
          <input
            id="speed-number"
            type="number"
            min={MIN_SPEED}
            max={MAX_SPEED}
            value={speed}
            onChange={e => setSpeed(clamp(e.target.value, MIN_SPEED, MAX_SPEED))}
            className="speed-number-input"
          />
        </div>
        <div className="speed-minmax">
          <span>{MIN_SPEED}</span><span>{MAX_SPEED}</span>
        </div>
      </div>

      {/* Delay slider */}
      <div className="speed-row">
        <div className="speed-label-row">
          <span className="speed-label">Key Delay</span>
          <span className="speed-badge">{delay} <small>ms</small></span>
        </div>
        <div className="speed-control-row">
          <input
            id="delay-slider"
            type="range"
            min={MIN_DELAY}
            max={MAX_DELAY}
            step={50}
            value={delay}
            onChange={e => setDelay(Number(e.target.value))}
            className="speed-slider speed-slider--delay"
          />
          <input
            id="delay-number"
            type="number"
            min={MIN_DELAY}
            max={MAX_DELAY}
            value={delay}
            onChange={e => setDelay(clamp(e.target.value, MIN_DELAY, MAX_DELAY))}
            className="speed-number-input"
          />
        </div>
        <div className="speed-minmax">
          <span>{MIN_DELAY} ms</span><span>{MAX_DELAY} ms</span>
        </div>
      </div>

      <button
        id="speed-apply-btn"
        className="apply-btn apply-btn--speed"
        onClick={handleApply}
        disabled={loading}
      >
        {loading ? 'SAVING...' : 'SAVE SPEED SETTINGS'}
      </button>
    </div>
  );
};

export default SpeedConfig;
