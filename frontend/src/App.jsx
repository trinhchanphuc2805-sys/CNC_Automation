import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/layout/Sidebar';
import TopHeader from './components/layout/TopHeader';
import AiTestWorkbench from './components/AiTestWorkbench';
import WebcamOcrPanel from './components/WebcamOcrPanel';
import SettingsTab from './components/SettingsTab';

function App() {
  const [activeTab, setActiveTab] = useState('ai-studio');
  const [isConnected, setIsConnected] = useState(false);

  // Shared test script state
  const [testScript, setTestScript] = useState([]);
  const [isExecutingScript, setIsExecutingScript] = useState(false);
  const [executionProgress, setExecutionProgress] = useState({
    current: 0,
    total: 0,
    stepName: '',
  });

  // Step update handler called by WebcamOcrPanel runner
  const handleStepUpdate = (index, status) => {
    setTestScript((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status };
      }
      return next;
    });

    if (status === 'running') {
      setExecutionProgress((prev) => ({
        ...prev,
        current: index + 1,
        total: testScript.length,
        stepName: testScript[index]?.target || `Step ${index + 1}`,
      }));
    }
  };

  const handleCompleteExecution = () => {
    setIsExecutingScript(false);
  };

  // Called when user clicks Execute in Tab 1 (AI Test Studio)
  const handleExecuteFromAiStudio = (scriptToExecute) => {
    const pendingScript = scriptToExecute.map((s) => ({
      ...s,
      status: 'pending',
    }));
    setTestScript(pendingScript);
    // Switch to Tab 2: Computer Vision & AI Alignment
    setActiveTab('vision-alignment');
    setIsExecutingScript(false);
    setExecutionProgress({
      current: 0,
      total: scriptToExecute.length,
      stepName: 'Pending Execution',
    });
  };

  const passedCount = testScript.filter((s) => s.status === 'passed').length;

  return (
    <div className="min-h-screen bg-[#f4f7fa] text-slate-800 flex flex-col md:flex-row font-sans">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '10px',
            fontWeight: '600',
            fontSize: '13.5px',
            padding: '12px 18px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            background: '#ffffff',
            color: '#2c3e50',
            border: '1px solid #e2e8f0',
          },
          success: {
            style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
          },
          error: {
            style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' },
          },
        }}
      />

      {/* Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isConnected={isConnected}
        testScript={testScript}
        isExecutingScript={isExecutingScript}
        passedCount={passedCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar Header */}
        <TopHeader activeTab={activeTab} isConnected={isConnected} />

        {/* Main Body */}
        <main className="flex-1 p-5 md:p-8 overflow-y-auto space-y-6">
          {/* ===============================================================
              4 ADMINTY KPI GRADIENT CARDS (English Labels)
              =============================================================== */}


          {/* ===============================================================
              TAB CONTENT SECTIONS
              =============================================================== */}
          {/* Tab 1: AI Test Studio */}
          <div style={{ display: activeTab === 'ai-studio' ? 'block' : 'none' }}>
            <AiTestWorkbench
              testScript={testScript}
              setTestScript={setTestScript}
              onExecuteTest={handleExecuteFromAiStudio}
              isExecuting={isExecutingScript}
              executionProgress={executionProgress}
              switchToVisionTab={() => setActiveTab('vision-alignment')}
            />
          </div>

          {/* Tab 2: Computer Vision & AI Alignment */}
          <div style={{ display: activeTab === 'vision-alignment' ? 'block' : 'none' }}>
            <WebcamOcrPanel
              activeTestScript={testScript}
              onStepUpdate={handleStepUpdate}
              onCompleteExecution={handleCompleteExecution}
              isExecutingScript={isExecutingScript}
              onSwitchToAiStudio={() => setActiveTab('ai-studio')}
            />
          </div>

          {/* Tab 3: CNC Settings & Hardware Control */}
          <div style={{ display: activeTab === 'cnc-settings' ? 'block' : 'none' }}>
            <SettingsTab
              isConnected={isConnected}
              setIsConnected={setIsConnected}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
