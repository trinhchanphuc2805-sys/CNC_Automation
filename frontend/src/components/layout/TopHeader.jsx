import React from 'react';

const TopHeader = ({ activeTab, isConnected }) => {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shadow-xs">
      {/* Left Breadcrumbs / Title */}
      <div className="flex items-center gap-3">
        <span className="text-xl font-bold text-slate-800">
          {activeTab === 'ai-studio' && 'AI Script Recommender'}
          {activeTab === 'vision-alignment' && 'Computer Vision & AI Alignment'}
          {activeTab === 'cnc-settings' && ' Machine Settings & Hardware Control'}
        </span>
      </div>

      {/* Right Status Actions */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-[#0ac282]' : 'bg-[#fe5d70]'
            }`}
          />
          <span className="text-slate-600 font-semibold">
            {isConnected ? 'Serial COM: Connected' : 'Simulation Mode (Offline)'}
          </span>
        </div>

    
      </div>
    </header>
  );
};

export default TopHeader;
