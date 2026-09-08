import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

// Standard 4×3 keypad layout: rows top-to-bottom, cols left-to-right
const BASE_LAYOUT = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

/**
 * Rotate the 4-row × 3-col grid by `deg` degrees clockwise.
 * Returns a 2-D array of [rows][cols] with the correct key labels.
 */
function rotateGrid(grid, deg) {
  if (deg === 0) return grid;

  const rows = grid.length;
  const cols = grid[0].length;

  if (deg === 90) {
    // New grid: cols × rows  (old rows become new cols)
    const rotated = Array.from({ length: cols }, () => Array(rows).fill(''));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        rotated[c][rows - 1 - r] = grid[r][c];
    return rotated;
  }

  if (deg === 180) {
    return grid
      .slice()
      .reverse()
      .map(row => row.slice().reverse());
  }

  if (deg === 270) {
    // New grid: cols × rows
    const rotated = Array.from({ length: cols }, () => Array(rows).fill(''));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        rotated[cols - 1 - c][r] = grid[r][c];
    return rotated;
  }

  return grid;
}

const ORIENTATIONS = [
  { deg: 0,   label: '0°', desc: 'Default' },
  { deg: 90,  label: '90°', desc: 'Rotate right' },
  { deg: 180, label: '180°', desc: 'Flip' },
  { deg: 270, label: '270°', desc: 'Rotate left' },
];

const KeypadOrientationConfig = () => {
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);

  // Fetch current orientation from server on mount
  useEffect(() => {
    axios.get('http://localhost:8000/api/keypad/orientation')
      .then(res => setSelected(res.data.orientation))
      .catch(() => {});
  }, []);

  const previewGrid = rotateGrid(BASE_LAYOUT, selected);

  const handleApply = async () => {
    setLoading(true);
    const toastId = toast.loading('Applying keypad orientation...');
    try {
      await axios.post('http://localhost:8000/api/keypad/orientation', {
        orientation: selected,
      });
      toast.success(`Keypad orientation set to ${selected}°`, { id: toastId });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to set orientation';
      toast.error(msg, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="keypad-orient-card">
      <h2 className="section-title">Keypad Orientation</h2>

      {/* Direction selector buttons */}
      <div className="orient-btn-row">
        {ORIENTATIONS.map(({ deg, label, desc }) => (
          <button
            key={deg}
            id={`orient-btn-${deg}`}
            className={`orient-btn ${selected === deg ? 'orient-btn--active' : ''}`}
            onClick={() => setSelected(deg)}
          >
            <span className="orient-label">{label}</span>
            <span className="orient-desc">{desc}</span>
          </button>
        ))}
      </div>

      {/* Preview grid */}
      <div className="orient-preview-wrap">
        <p className="orient-preview-title">Preview ({selected}°)</p>
        <div
          className="orient-preview-grid"
          style={{
            gridTemplateColumns: `repeat(${previewGrid[0]?.length ?? 3}, 1fr)`,
          }}
        >
          {previewGrid.flat().map((key, idx) => (
            <div
              key={idx}
              className={`orient-preview-key ${key === '*' || key === '#' ? 'orient-preview-key--special' : ''}`}
            >
              {key}
            </div>
          ))}
        </div>
      </div>

      <button
        id="orient-apply-btn"
        className="apply-btn"
        onClick={handleApply}
        disabled={loading}
      >
        {loading ? 'APPLYING...' : 'APPLY ORIENTATION'}
      </button>
    </div>
  );
};

export default KeypadOrientationConfig;
