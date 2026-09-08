import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import ComConfig from './components/ComConfig';
import SettingsPanel from './components/SettingsPanel';
import KeypadGrid from './components/KeypadGrid';
import ManualControl from './components/ManualControl';
import SequenceControl from './components/SequenceControl';
import WebcamOcrPanel from './components/WebcamOcrPanel';

function App() {
  const [isConnected, setIsConnected] = useState(false);

  return (
    <div className="app-shell min-h-screen bg-gray-100 font-sans text-gray-800">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '12px',
            fontWeight: '600',
            fontSize: '15px',
            padding: '14px 18px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          },
          success: {
            style: { background: '#22c55e', color: 'white' },
            iconTheme: { primary: 'white', secondary: '#22c55e' },
          },
          error: {
            style: { background: '#ef4444', color: 'white' },
            iconTheme: { primary: 'white', secondary: '#ef4444' },
          },
          loading: {
            style: { background: '#6366f1', color: 'white' },
            iconTheme: { primary: 'white', secondary: '#6366f1' },
          },
        }}
      />

      <div className="app-container">
        <header className="app-header text-center">
          <h1 className="app-title font-black text-gray-800 tracking-tight">CNC CONTROL STUDIO</h1>
          <p className="text-gray-500 mt-2 font-medium">Professional CNC machine control interface</p>
        </header>

        <div className="connection-grid">
          <ComConfig isConnected={isConnected} setIsConnected={setIsConnected} />
        </div>

        <div className="control-grid">
          {/* All settings merged into one panel */}
          <section className="control-grid__settings"><SettingsPanel /></section>
          <section><KeypadGrid /></section>
          <section><ManualControl /></section>
          <section className="control-grid__sequence"><SequenceControl /></section>
          <section className="control-grid__webcam"><WebcamOcrPanel /></section>
        </div>
      </div>
    </div>
  );
}

export default App;
