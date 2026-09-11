import React from 'react';

const Sidebar = ({
  activeTab,
  setActiveTab,
  isConnected,
  testScript = [],
  isExecutingScript = false,
  passedCount = 0,
}) => {
  return (
    <aside className="w-full md:w-64 bg-[#404E67] text-white flex flex-col shrink-0 select-none shadow-md z-20">
      {/* Brand Header */}
      <div className="h-16 px-6 bg-[#354256] border-b border-[#2c3748] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#fe5d70] to-[#fe909d] flex items-center justify-center font-black text-white text-base shadow-sm">
            C
          </div>
          <div>
            <span className="font-extrabold text-sm tracking-tight text-white block leading-tight">
              CNC <span className="text-[#fe5d70]">AUTOMATION</span>
            </span>
            <span className="text-[10px] text-slate-400 font-semibold tracking-wide uppercase">Computer Vision</span>
          </div>
        </div>
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected ? 'bg-[#0ac282] shadow-[0_0_8px_#0ac282]' : 'bg-[#fe5d70]'
          }`}
        />
      </div>

      {/* Sidebar Navigation Menu */}
      <div className="flex-1 py-4 px-3 overflow-y-auto space-y-6">
        {/* Section: Main Navigation */}
        <div>
          <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Navigation
          </div>
          <div className="space-y-1">
              {/* Tab 1: CNC Machine Settings */}
            <button
              type="button"
              onClick={() => setActiveTab('cnc-settings')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'cnc-settings'
                  ? 'bg-[#354256] text-white border-l-4 border-[#01a9ac] shadow-xs'
                  : 'text-slate-300 hover:bg-[#354256]/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg
                  className={`w-4 h-4 ${activeTab === 'cnc-settings' ? 'text-[#01a9ac]' : 'text-slate-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                  />
                </svg>
                <span>CNC Machine Settings</span>
              </div>
              <span
                className={`px-2 py-0.5 text-[10px] font-bold rounded-full text-white ${
                  isConnected ? 'bg-[#0ac282]' : 'bg-slate-600'
                }`}
              >
                {isConnected ? 'ONLINE' : 'OFF'}
              </span>
            </button>
            {/* Tab 2: AI Test Studio */}
            <button
              type="button"
              onClick={() => setActiveTab('ai-studio')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'ai-studio'
                  ? 'bg-[#354256] text-white border-l-4 border-[#fe5d70] shadow-xs'
                  : 'text-slate-300 hover:bg-[#354256]/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg
                  className={`w-4 h-4 ${activeTab === 'ai-studio' ? 'text-[#fe5d70]' : 'text-slate-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>AI Test Studio</span>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#fe5d70] text-white">
                {testScript.length}
              </span>
            </button>

            {/* Tab 3: Computer Vision & Alignment */}
            <button
              type="button"
              onClick={() => setActiveTab('vision-alignment')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'vision-alignment'
                  ? 'bg-[#354256] text-white border-l-4 border-[#0ac282] shadow-xs'
                  : 'text-slate-300 hover:bg-[#354256]/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg
                  className={`w-4 h-4 ${activeTab === 'vision-alignment' ? 'text-[#0ac282]' : 'text-slate-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                <span>Vision & Alignment</span>
              </div>
              {isExecutingScript ? (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#0ac282] text-white animate-pulse">
                  RUN
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#01a9ac] text-white">
                  Ready
                </span>
              )}
            </button>

          
          </div>
        </div>

        {/* Section: Hardware Status Monitor */}
        <div>
          <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Hardware Monitor
          </div>
          <div className="p-3 bg-[#354256]/80 rounded-xl border border-[#2c3748] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Arduino GRBL:</span>
              <span className={`font-semibold ${isConnected ? 'text-[#0ac282]' : 'text-[#fe5d70]'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Script Status:</span>
              <span className="text-slate-200 font-medium">
                {isExecutingScript ? 'Executing...' : `${passedCount}/${testScript.length} Passed`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-[#354256] text-[11px] text-slate-400 flex items-center justify-between">
        <span>CNC Automation CV v2.4</span>
        <span className="text-slate-500 font-mono">Port 8000</span>
      </div>
    </aside>
  );
};

export default Sidebar;
