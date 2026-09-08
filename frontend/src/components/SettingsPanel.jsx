import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

/* ------------------------------------------------------------------ */
/*  Orientation helpers                                                 */
/* ------------------------------------------------------------------ */
const BASE_LAYOUT = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

function rotateGrid(grid, deg) {
  if (deg === 0) return grid;
  const rows = grid.length;
  const cols = grid[0].length;
  if (deg === 90) {
    const r = Array.from({ length: cols }, () => Array(rows).fill(''));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        r[j][rows - 1 - i] = grid[i][j];
    return r;
  }
  if (deg === 180) return grid.slice().reverse().map(row => row.slice().reverse());
  if (deg === 270) {
    const r = Array.from({ length: cols }, () => Array(rows).fill(''));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        r[cols - 1 - j][i] = grid[i][j];
    return r;
  }
  return grid;
}

const ORIENTATIONS = [
  { deg: 0,   label: '0°',   desc: 'Default' },
  { deg: 90,  label: '90°',  desc: 'Rotate right' },
  { deg: 180, label: '180°', desc: 'Flip' },
  { deg: 270, label: '270°', desc: 'Rotate left' },
];

const MIN_SPEED = 100;
const MAX_SPEED = 5000;
const MIN_DELAY = 0;
const MAX_DELAY = 5000;

const TABS = [
  { id: 'position', label: 'Position' },
  { id: 'orient',   label: 'Orientation' },
  { id: 'speed',    label: 'Speed' },
];

/* ================================================================== */
const SettingsPanel = () => {
  const [activeTab, setActiveTab] = useState('position');

  /* --- Position state --- */
  const [config, setConfig] = useState({ x1: 0, y1: 0, spach_x: 100, spach_y: 100 });
  const [savingPos, setSavingPos] = useState(false);

  /* --- Orientation state --- */
  const [orientation, setOrientation] = useState(0);
  const [savingOrient, setSavingOrient] = useState(false);

  /* --- Speed state --- */
  const [speed, setSpeed]   = useState(1000);
  const [delay, setDelay]   = useState(500);
  const [savingSpeed, setSavingSpeed] = useState(false);

  /* Fetch all settings on mount */
  useEffect(() => {
    axios.get('http://localhost:8000/api/com/status')
      .then(res => {
        const d = res.data;
        setConfig({
          x1:      d.config.x1,
          y1:      d.config.y1,
          spach_x: d.config.spach_x,
          spach_y: d.config.spach_y,
        });
        setOrientation(d.orientation ?? 0);
        setSpeed(d.speed ?? 1000);
        setDelay(d.delay_between_keys ?? 500);
      })
      .catch(() => {});
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */
  const handleConfigChange = e =>
    setConfig({ ...config, [e.target.name]: parseFloat(e.target.value) || 0 });

  const savePosition = async () => {
    setSavingPos(true);
    const id = toast.loading('Saving position...');
    try {
      await axios.post('http://localhost:8000/api/keypad/config', config);
      toast.success('Position saved and origin set', { id });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save position', { id });
    } finally { setSavingPos(false); }
  };

  const saveOrientation = async () => {
    setSavingOrient(true);
    const id = toast.loading('Applying orientation...');
    try {
      await axios.post('http://localhost:8000/api/keypad/orientation', { orientation });
      toast.success(`Keypad orientation set to ${orientation}°`, { id });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to set orientation', { id });
    } finally { setSavingOrient(false); }
  };

  const saveSpeed = async () => {
    setSavingSpeed(true);
    const id = toast.loading('Updating speed...');
    try {
      await axios.post('http://localhost:8000/api/cnc/speed', {
        speed, delay_between_keys: delay,
      });
      toast.success('Speed and delay updated', { id });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update speed', { id });
    } finally { setSavingSpeed(false); }
  };

  const clamp = (v, mn, mx) => Math.min(Math.max(Number(v) || mn, mn), mx);
  const previewGrid = rotateGrid(BASE_LAYOUT, orientation);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="settings-panel">
      {/* Header */}
      <div className="settings-header">
        <span className="settings-header-title">CNC Machine Settings</span>
      </div>

      {/* Tab bar */}
      <div className="settings-tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            id={`settings-tab-${t.id}`}
            className={`settings-tab ${activeTab === t.id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Position ───────────────────────────────────────── */}
      {activeTab === 'position' && (
        <div className="settings-body">
          <p className="settings-hint">Set the origin position (key 1) and keypad spacing.</p>

          <div className="settings-grid-2">
            {[
              { name: 'x1',      label: 'X — Key 1 position',   unit: 'steps' },
              { name: 'y1',      label: 'Y — Key 1 position',   unit: 'steps' },
              { name: 'spach_x', label: 'X spacing',             unit: 'steps' },
              { name: 'spach_y', label: 'Y spacing',             unit: 'steps' },
            ].map(({ name, label, unit }) => (
              <div key={name} className="settings-field">
                <label className="settings-field-label">{label}</label>
                <div className="settings-field-input-wrap">
                  <input
                    id={`pos-${name}`}
                    name={name}
                    type="number"
                    value={config[name]}
                    onChange={handleConfigChange}
                    className="settings-number"
                  />
                  <span className="settings-field-unit">{unit}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            id="pos-save-btn"
            className="settings-save-btn"
            onClick={savePosition}
            disabled={savingPos}
          >
            {savingPos ? 'SAVING...' : 'SAVE POSITION & SET ORIGIN'}
          </button>
        </div>
      )}

      {/* ── Tab: Orientation ────────────────────────────────────── */}
      {activeTab === 'orient' && (
        <div className="settings-body">
          <p className="settings-hint">Select the keypad orientation relative to the CNC machine.</p>

          {/* Direction buttons */}
          <div className="orient-btn-row">
            {ORIENTATIONS.map(({ deg, icon, label, desc }) => (
              <button
                key={deg}
                id={`orient-btn-${deg}`}
                className={`orient-btn ${orientation === deg ? 'orient-btn--active' : ''}`}
                onClick={() => setOrientation(deg)}
              >
                <span className="orient-icon">{icon}</span>
                <span className="orient-label">{label}</span>
                <span className="orient-desc">{desc}</span>
              </button>
            ))}
          </div>

          {/* Live preview */}
          <div className="orient-preview-wrap">
            <p className="orient-preview-title">Keypad preview — {orientation}°</p>
            <div
              className="orient-preview-grid"
              style={{ gridTemplateColumns: `repeat(${previewGrid[0]?.length ?? 3}, 1fr)` }}
            >
              {previewGrid.flat().map((key, idx) => (
                <div
                  key={idx}
                  className={`orient-preview-key ${
                    key === '*' || key === '#' ? 'orient-preview-key--special' : ''
                  }`}
                >
                  {key}
                </div>
              ))}
            </div>
          </div>

          <button
            id="orient-save-btn"
            className="settings-save-btn settings-save-btn--violet"
            onClick={saveOrientation}
            disabled={savingOrient}
          >
            {savingOrient ? 'APPLYING...' : 'APPLY ORIENTATION'}
          </button>
        </div>
      )}

      {/* ── Tab: Speed ──────────────────────────────────────────── */}
      {activeTab === 'speed' && (
        <div className="settings-body">
          <p className="settings-hint">Adjust movement speed and the delay between keys.</p>

          {/* Speed slider */}
          <div className="speed-row">
            <div className="speed-label-row">
              <span className="speed-label">Movement Speed</span>
              <span className="speed-badge">{speed} <small>steps/s</small></span>
            </div>
            <div className="speed-control-row">
              <input id="speed-slider" type="range"
                min={MIN_SPEED} max={MAX_SPEED} step={50} value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                className="speed-slider"
              />
              <input id="speed-number" type="number"
                min={MIN_SPEED} max={MAX_SPEED} value={speed}
                onChange={e => setSpeed(clamp(e.target.value, MIN_SPEED, MAX_SPEED))}
                className="speed-number-input"
              />
            </div>
            <div className="speed-minmax"><span>{MIN_SPEED}</span><span>{MAX_SPEED}</span></div>
          </div>

          {/* Delay slider */}
          <div className="speed-row">
            <div className="speed-label-row">
              <span className="speed-label">Key Delay</span>
              <span className="speed-badge speed-badge--cyan">{delay} <small>ms</small></span>
            </div>
            <div className="speed-control-row">
              <input id="delay-slider" type="range"
                min={MIN_DELAY} max={MAX_DELAY} step={50} value={delay}
                onChange={e => setDelay(Number(e.target.value))}
                className="speed-slider speed-slider--delay"
              />
              <input id="delay-number" type="number"
                min={MIN_DELAY} max={MAX_DELAY} value={delay}
                onChange={e => setDelay(clamp(e.target.value, MIN_DELAY, MAX_DELAY))}
                className="speed-number-input speed-number-input--cyan"
              />
            </div>
            <div className="speed-minmax"><span>0 ms</span><span>5000 ms</span></div>
          </div>

          <button
            id="speed-save-btn"
            className="settings-save-btn settings-save-btn--cyan"
            onClick={saveSpeed}
            disabled={savingSpeed}
          >
            {savingSpeed ? 'SAVING...' : 'SAVE SPEED & DELAY'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
