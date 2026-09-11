import React from 'react';
import ComConfig from './ComConfig';
import ManualControl from './ManualControl';
import SettingsPanel from './SettingsPanel';
import SequenceControl from './SequenceControl';
import KeypadGrid from './KeypadGrid';

const SettingsTab = ({ isConnected, setIsConnected }) => {
  return (
    <div className="space-y-6">
      {/* 1. COM Connection */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#01a9ac] to-[#01dbdf]" />
        <div className="pb-4 mb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 tracking-tight">HARDWARE CONNECTION & SERIAL COM PORT</h2>
            <p className="text-xs text-slate-500 mt-0.5">Connect Arduino GRBL microcontroller and verify serial communication link</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold text-white ${isConnected ? 'bg-[#0ac282]' : 'bg-[#fe5d70]'}`}>
            {isConnected ? 'COM CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
        <ComConfig isConnected={isConnected} setIsConnected={setIsConnected} />
      </div>

      {/* 2. Manual Jog (X, Y, Z, A) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0ac282] to-[#0df3a3]" />
        <div className="pb-4 mb-4 border-b border-slate-100">
          <h2 className="text-base font-extrabold text-slate-900 tracking-tight">MANUAL JOG & AXIS MOTION (X, Y, Z, A)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Manual jogging, set work coordinate zero (0, 0) and test stylus tap actuation</p>
        </div>
        <ManualControl />
      </div>

      {/* 3. Machine Parameters & Spacing */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#fe9365] to-[#feb798]" />
        <div className="pb-4 mb-4 border-b border-slate-100">
          <h2 className="text-base font-extrabold text-slate-900 tracking-tight">MACHINE STEPS & SPEED CONFIGURATION</h2>
          <p className="text-xs text-slate-500 mt-0.5">Key spacing parameters (spach_x, spach_y), rotation angle, steps per unit & feed rates</p>
        </div>
        <SettingsPanel />
      </div>

      {/* 4. Sequence & Matrix Keypad Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#fe5d70] to-[#fe909d]" />
          <div className="pb-4 mb-4 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-slate-900 tracking-tight">AUTOMATED SEQUENCE KEYPAD CONTROL</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enter numeric sequence (e.g. 123456) for consecutive automated matrix taps</p>
          </div>
          <SequenceControl />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#404E67] to-[#697a9b]" />
          <div className="pb-4 mb-4 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-slate-900 tracking-tight">MATRIX KEYPAD LAYOUT TEST (POS)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Interactive keypad simulation and single key tap diagnostic</p>
          </div>
          <KeypadGrid />
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;
