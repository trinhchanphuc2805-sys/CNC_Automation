import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const API_BASE = 'http://localhost:8000';

const DEFAULT_PROMPT =
  'Test ATM PIN input: Sequentially tap key 1, key 2, key 3, key 4, then tap Enter/OK key to unlock the banking menu.';

// ATM PIN Mock Data Specification
const ATM_MOCK_DATA = {
  test_name: 'Test Scenario: ATM 4-Digit Security PIN Verification',
  description: 'Physical keypad matrix tapping sequence and screen state unlock verification',
  device: 'ATM / Matrix Numeric Keypad',
  engine: 'CNC Robot Stylus + Physical Matrix Spacing',
  preconditions: 'ATM waiting on PIN prompt screen with numeric keypad active',
  expected: 'Cardholder authenticated and account service dashboard displayed',
  steps: [
    {
      id: 1,
      action: 'CLICK',
      target: 'Numeric Key 1',
      value: '1',
      delay_ms: 450,
      description: 'CNC stylus tap on key 1',
      status: 'idle',
    },
    {
      id: 2,
      action: 'CLICK',
      target: 'Numeric Key 2',
      value: '2',
      delay_ms: 450,
      description: 'CNC stylus tap on key 2',
      status: 'idle',
    },
    {
      id: 3,
      action: 'CLICK',
      target: 'Numeric Key 3',
      value: '3',
      delay_ms: 450,
      description: 'CNC stylus tap on key 3',
      status: 'idle',
    },
    {
      id: 4,
      action: 'CLICK',
      target: 'Numeric Key 4',
      value: '4',
      delay_ms: 450,
      description: 'CNC stylus tap on key 4',
      status: 'idle',
    },
    {
      id: 5,
      action: 'CLICK',
      target: 'Enter / OK Key',
      value: 'ENTER',
      delay_ms: 800,
      description: 'Tap Enter to submit entered PIN',
      status: 'idle',
    },
    {
      id: 6,
      action: 'VERIFY',
      target: 'Account Main Menu Screen',
      value: 'Main Menu',
      delay_ms: 1000,
      description: 'Verify display transitions to main banking menu',
      status: 'idle',
    },
  ],
};

// Helper: Smart English Mock Generator
function generateSmartMockScript(rawPrompt) {
  const text = (rawPrompt || '').trim();
  const lower = text.toLowerCase();

  // ATM PIN Scenario (Default & Primary match)
  if (
    lower.includes('atm') ||
    lower.includes('pin') ||
    lower.includes('key 1') ||
    lower.includes('key 2') ||
    lower.includes('keypad') ||
    lower.includes('banking') ||
    lower.includes('sequentially')
  ) {
    return JSON.parse(JSON.stringify(ATM_MOCK_DATA));
  }

  // Generic sentence splitter if user inputs a custom prompt
  const sentences = text
    .split(/[,;\n.+]|then|after that|next/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (sentences.length === 0) {
    sentences.push(text);
  }

  const generatedSteps = sentences.map((part, idx) => {
    const pLower = part.toLowerCase();
    let action = 'CLICK';
    let target = part;
    let value = '';
    let delay = 600;

    if (pLower.includes('type') || pLower.includes('enter') || pLower.includes('input') || pLower.includes('fill')) {
      action = 'TYPE';
      delay = 700;
      const quoted = part.match(/["'`]([^"'`]+)["'`]/);
      if (quoted) {
        value = quoted[1];
        target = part.replace(quoted[0], '').replace(/(?:type|enter|input|fill|into)/gi, '').trim() || 'Input Field';
      } else {
        target = part.replace(/(?:type|enter|input|fill)/gi, '').trim() || 'Input Field';
      }
    } else if (pLower.includes('verify') || pLower.includes('check') || pLower.includes('assert') || pLower.includes('wait')) {
      action = pLower.includes('wait') ? 'WAIT' : 'VERIFY';
      delay = 1000;
      target = part.replace(/(?:verify|check|assert|wait for)/gi, '').trim() || 'Target Screen Element';
    } else if (pLower.includes('swipe') || pLower.includes('scroll')) {
      action = 'SWIPE';
      delay = 800;
      target = part.replace(/(?:swipe|scroll)/gi, '').trim() || 'Screen Scroll Area';
    } else {
      action = 'CLICK';
      target = part.replace(/(?:tap|click|press|on)/gi, '').trim() || `UI Element ${idx + 1}`;
    }

    return {
      id: idx + 1,
      action,
      target: target || `Target Element #${idx + 1}`,
      value,
      delay_ms: delay,
      description: part,
      status: 'idle',
    };
  });

  return {
    test_name: `Test Scenario: ${sentences[0].slice(0, 40)}...`,
    description: `Automated test generated from user prompt: "${text.slice(0, 80)}"`,
    device: 'Physical Device / Test Rig',
    engine: 'CNC Robot Stylus + Vision AI',
    preconditions: 'Target device positioned in calibrated camera workspace',
    expected: 'All test assertions and interactions successfully validated',
    steps: generatedSteps,
  };
}

const AiTestWorkbench = ({
  testScript = [],
  setTestScript,
  onExecuteTest,
  isExecuting = false,
  executionProgress = { current: 0, total: 0, stepName: '' },
}) => {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isGenerating, setIsGenerating] = useState(false);
  // Initially false: only show test scenario specifications & table AFTER clicking Generate
  const [hasGenerated, setHasGenerated] = useState(false);
  const [useBackendAi, setUseBackendAi] = useState(false);

  // Metadata Overview state
  const [mockMetadata, setMockMetadata] = useState(ATM_MOCK_DATA);
  const [testName, setTestName] = useState(ATM_MOCK_DATA.test_name);
  const [testDesc, setTestDesc] = useState(ATM_MOCK_DATA.description);

  const handleGenerateRecommendation = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a test scenario description!');
      return;
    }

    setIsGenerating(true);
    const toastId = toast.loading('AI analyzing prompt & generating test recommendations...');

    if (!useBackendAi) {
      setTimeout(() => {
        const generated = generateSmartMockScript(prompt);
        setMockMetadata(generated);
        setTestName(generated.test_name);
        setTestDesc(generated.description);
        setTestScript(generated.steps);
        setHasGenerated(true);
        setIsGenerating(false);
        toast.success(`✨ Generated ${generated.steps.length} test steps successfully!`, { id: toastId });
      }, 450);
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/ai/generate-testcases`, {
        prompt: prompt.trim(),
      });
      if (res.data?.success && res.data?.steps) {
        const genData = {
          test_name: res.data.test_name || 'Automated Test Scenario',
          description: res.data.description || prompt,
          device: 'Smartphone Touch Rig',
          engine: 'CNC Stylus + Vision AI',
          preconditions: 'Target app active in camera viewport',
          expected: 'Target UI state achieved with valid verification',
          steps: res.data.steps,
        };
        setMockMetadata(genData);
        setTestName(genData.test_name);
        setTestDesc(genData.description);
        setTestScript(res.data.steps);
        setHasGenerated(true);
        toast.success(`Generated ${res.data.steps.length} steps via OpenAI API!`, { id: toastId });
      } else {
        throw new Error('Invalid response from AI server');
      }
    } catch (err) {
      const generated = generateSmartMockScript(prompt);
      setMockMetadata(generated);
      setTestName(generated.test_name);
      setTestDesc(generated.description);
      setTestScript(generated.steps);
      setHasGenerated(true);
      toast.success(`Switched to Mock Engine: generated ${generated.steps.length} steps!`, { id: toastId });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateStep = (index, field, value) => {
    setTestScript((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddStep = () => {
    const newId = testScript.length > 0 ? Math.max(...testScript.map((s) => s.id || 0)) + 1 : 1;
    const newStep = {
      id: newId,
      action: 'CLICK',
      target: `Target Element #${newId}`,
      value: '',
      delay_ms: 600,
      description: 'Additional test action',
      status: 'idle',
    };
    setTestScript((prev) => [...prev, newStep]);
    toast.success('Added new test step');
  };

  const handleDuplicateStep = (index) => {
    const stepToClone = testScript[index];
    const newId = Math.max(...testScript.map((s) => s.id || 0)) + 1;
    const cloned = {
      ...stepToClone,
      id: newId,
      description: `${stepToClone.description || ''} (Clone)`,
      status: 'idle',
    };
    setTestScript((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, cloned);
      return next;
    });
    toast.success('Step duplicated');
  };

  const handleDeleteStep = (index) => {
    setTestScript((prev) => prev.filter((_, idx) => idx !== index));
    toast('Step deleted');
  };

  const handleMoveStep = (index, direction) => {
    setTestScript((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  const handleResetStatuses = () => {
    setTestScript((prev) => prev.map((s) => ({ ...s, status: 'idle' })));
    toast.success('Step statuses reset to idle');
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all test steps?')) {
      setTestScript([]);
      toast('All steps cleared');
    }
  };

  const handleExecuteClick = () => {
    if (!testScript || testScript.length === 0) {
      toast.error('Test script is empty! Please generate or add steps first.');
      return;
    }

    const preparedScript = testScript.map((s) => ({ ...s, status: 'idle' }));
    setTestScript(preparedScript);

    toast.success('Switching to Computer Vision & AI Alignment for automated execution!');

    if (onExecuteTest) {
      onExecuteTest(preparedScript);
    }
  };

  const totalEstDuration = (testScript.reduce((acc, s) => acc + (s.delay_ms || 500) + 1200, 0) / 1000).toFixed(1);

  return (
    <div className="space-y-6">
      {/* ===================================================================
          CARD 1: PROMPT INPUT & GENERATE AI RECOMMENDATION BUTTON
          =================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#fe5d70] via-[#fe9365] to-[#0ac282]" />

        <div className="flex items-start justify-between pb-4 border-b border-slate-100 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">AI Test Studio & Scenario Generator</h2>
              <span className="bg-[#fe5d70]/10 text-[#fe5d70] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#fe5d70]/20">
                Mock Engine Ready
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Ready to generate ATM security test. Click{' '}
              <strong>Generate AI Recommendation</strong> to generate the ATM PIN verification scenario and editable test script.
            </p>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-600 font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useBackendAi}
              onChange={(e) => setUseBackendAi(e.target.checked)}
              className="rounded text-[#fe5d70] focus:ring-[#fe5d70]"
            />
            <span>Use OpenAI Cloud API</span>
          </label>
        </div>

        {/* Prompt Input Textarea */}
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 block">
              Natural Language Test Prompt:
            </label>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
              Target Case: ATM PIN Keypad Sequence
            </span>
          </div>
          <textarea
            rows="3"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter test description..."
            disabled={isGenerating || isExecuting}
            className="w-full bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fe5d70]/30 focus:border-[#fe5d70] transition-all font-mono leading-relaxed"
          />

          <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
            <span className="text-xs text-slate-500">
              💡 Automated entity extractor maps PIN keys (1, 2, 3, 4), Enter/OK key, and banking menu verification.
            </span>

            {/* THE REQUESTED BUTTON: GENERATE AI RECOMMENDATION */}
            <button
              type="button"
              onClick={handleGenerateRecommendation}
              disabled={isGenerating || isExecuting || !prompt.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-[#0ac282] to-[#0df3a3] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 text-white text-xs font-extrabold rounded-lg transition-all shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{isGenerating ? 'Analyzing & Generating...' : 'Generate AI Recommendation'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================
          PLACEHOLDER: DISPLAYED BEFORE USER CLICKS GENERATE
          =================================================================== */}
      {!hasGenerated && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 shadow-xs">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-[#0ac282] flex items-center justify-center mb-3 border border-emerald-100">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h4 className="text-base font-bold text-slate-800">Test Scenario Ready to Generate</h4>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Click <strong className="text-slate-700 font-bold">Generate AI Recommendation</strong> above to analyze the prompt and display the <strong className="text-[#0ac282] font-bold">Test Scenario: ATM 4-Digit Security PIN Verification</strong> mock specifications and editable script steps.
          </p>
        </div>
      )}

      {/* ===================================================================
          CARD 2: AI RECOMMENDATION & MOCK DATA OVERVIEW (ENGLISH SPECIFICATIONS)
          =================================================================== */}
      {hasGenerated && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#01a9ac] to-[#01dbdf]" />

          <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#01a9ac]">Mock Data Specification</span>
              <h3 className="text-base font-extrabold text-slate-900">{mockMetadata.test_name || testName}</h3>
            </div>
            <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
              AI Confidence: 98.6%
            </span>
          </div>

          {/* Hardcoded / Dynamic Mock Data Grid in English */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs">
            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200">
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[10px]">Target Platform</span>
              <span className="text-slate-800 font-bold mt-1 block">{mockMetadata.device || 'Mobile Smartphone Rig'}</span>
              <span className="text-slate-500 text-[11px] mt-0.5 block">Physical capacitive screen</span>
            </div>

            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200">
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[10px]">Execution Mechanism</span>
              <span className="text-slate-800 font-bold mt-1 block">{mockMetadata.engine || 'CNC Stylus + GPT-4o Vision'}</span>
              <span className="text-slate-500 text-[11px] mt-0.5 block">Automated pixel mapping</span>
            </div>

            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200">
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[10px]">Est. Execution Time</span>
              <span className="text-slate-800 font-bold mt-1 block">~{totalEstDuration}s (Estimated)</span>
              <span className="text-slate-500 text-[11px] mt-0.5 block">{testScript.length} total sequential steps</span>
            </div>

            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200">
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[10px]">Target Preconditions</span>
              <span className="text-slate-800 font-bold mt-1 block">Calibrated 4-Point ROI</span>
              <span className="text-slate-500 text-[11px] mt-0.5 block">Device screen unlocked</span>
            </div>
          </div>

          <div className="mt-3.5 p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-blue-900 flex items-start gap-2">
            <span className="font-bold shrink-0 text-blue-600">Expected Outcome:</span>
            <span>{mockMetadata.expected || 'All interaction steps and verification gates pass successfully on the physical CNC test rig.'}</span>
          </div>
        </div>
      )}

      {/* ===================================================================
          CARD 3: EDITABLE TEST SCRIPT TABLE
          =================================================================== */}
      {hasGenerated && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-4">
            <div className="flex-1 min-w-[240px]">
              <input
                type="text"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                className="font-extrabold text-slate-900 text-base w-full bg-transparent hover:bg-slate-50 focus:bg-white p-1 rounded border border-transparent focus:border-slate-300 outline-none"
                placeholder="Scenario Title..."
                disabled={isExecuting}
              />
              <input
                type="text"
                value={testDesc}
                onChange={(e) => setTestDesc(e.target.value)}
                className="text-xs text-slate-500 w-full bg-transparent hover:bg-slate-50 focus:bg-white p-1 rounded border border-transparent focus:border-slate-300 outline-none mt-0.5"
                placeholder="Scenario Description..."
                disabled={isExecuting}
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleAddStep}
                disabled={isExecuting}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
              >
                + Add Step
              </button>
              <button
                type="button"
                onClick={handleResetStatuses}
                disabled={isExecuting}
                className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
              >
                Reset Statuses
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isExecuting || testScript.length === 0}
                className="px-3.5 py-2 border border-red-200 hover:bg-red-50 text-red-600 text-xs font-semibold rounded-lg transition-colors"
              >
                Clear All
              </button>

              {/* Execute Button */}
              <button
                type="button"
                onClick={handleExecuteClick}
                disabled={isExecuting || testScript.length === 0}
                className="px-5 py-2 bg-gradient-to-r from-[#0ac282] to-[#0df3a3] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 text-white text-xs font-extrabold rounded-lg transition-all shadow-xs"
              >
                {isExecuting ? 'Executing...' : 'Execute on Vision & CNC'}
              </button>
            </div>
          </div>

          {/* Execution Progress Banner */}
          {isExecuting && (
            <div className="my-4 p-3.5 bg-sky-50 border border-sky-200 rounded-xl">
              <div className="flex items-center justify-between text-xs text-sky-900 font-semibold mb-2">
                <span>
                  Executing Step {executionProgress.current}/{executionProgress.total}: {executionProgress.stepName}
                </span>
                <span>{Math.round((executionProgress.current / Math.max(1, executionProgress.total)) * 100)}%</span>
              </div>
              <div className="w-full bg-sky-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#0ac282] h-full transition-all duration-300"
                  style={{ width: `${(executionProgress.current / Math.max(1, executionProgress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Steps Table */}
          {testScript.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <div className="font-semibold text-slate-700">No test steps available</div>
              <div className="text-xs mt-1 text-slate-400">Click "Generate AI Recommendation" above or "+ Add Step" to build your script</div>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#404E67] text-white text-[11px] font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-3 w-12 text-center">#</th>
                    <th className="py-3 px-3 w-32">Action</th>
                    <th className="py-3 px-3">UI Target Element</th>
                    <th className="py-3 px-3 w-48">Input Value</th>
                    <th className="py-3 px-3 w-24 text-center">Delay (ms)</th>
                    <th className="py-3 px-3 w-32 text-center">Status</th>
                    <th className="py-3 px-3 w-36 text-center">Operations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {testScript.map((step, idx) => {
                    const isRunning = step.status === 'running';
                    const isPassed = step.status === 'passed';
                    const isFailed = step.status === 'failed';

                    return (
                      <tr
                        key={`step-${step.id || idx}`}
                        className={`hover:bg-slate-50/80 transition-colors ${isRunning ? 'bg-sky-50/70' : ''} ${isPassed ? 'bg-emerald-50/40' : ''} ${isFailed ? 'bg-red-50/40' : ''}`}
                      >
                        {/* Step Number */}
                        <td className="py-2.5 px-3 text-center text-xs font-bold text-slate-500">
                          #{idx + 1}
                        </td>

                        {/* Action Type */}
                        <td className="py-2.5 px-3">
                          <select
                            value={step.action}
                            onChange={(e) => handleUpdateStep(idx, 'action', e.target.value)}
                            disabled={isExecuting}
                            className="w-full bg-white border border-slate-200 rounded-md py-1.5 px-2 text-xs font-semibold text-slate-700 outline-none focus:border-[#fe5d70]"
                          >
                            <option value="CLICK">CLICK (Tap)</option>
                            <option value="TYPE">TYPE (Input)</option>
                            <option value="WAIT">WAIT (Pause)</option>
                            <option value="VERIFY">VERIFY (OCR)</option>
                            <option value="SWIPE">SWIPE (Scroll)</option>
                          </select>
                        </td>

                        {/* Target UI Element */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={step.target}
                            onChange={(e) => handleUpdateStep(idx, 'target', e.target.value)}
                            placeholder="Target element name..."
                            disabled={isExecuting}
                            className="w-full bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-xs text-slate-800 outline-none focus:border-[#fe5d70] font-medium"
                          />
                        </td>

                        {/* Input Value */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={step.value || ''}
                            onChange={(e) => handleUpdateStep(idx, 'value', e.target.value)}
                            placeholder={step.action === 'TYPE' ? 'Value to enter...' : '-'}
                            disabled={isExecuting || step.action === 'WAIT'}
                            className="w-full bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-xs font-mono text-slate-700 outline-none focus:border-[#fe5d70]"
                          />
                        </td>

                        {/* Delay ms */}
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            step="100"
                            min="0"
                            value={step.delay_ms || 500}
                            onChange={(e) => handleUpdateStep(idx, 'delay_ms', Number(e.target.value) || 0)}
                            disabled={isExecuting}
                            className="w-20 mx-auto text-center bg-white border border-slate-200 rounded-md py-1.5 px-2 text-xs font-mono text-slate-700 outline-none focus:border-[#fe5d70]"
                          />
                        </td>

                        {/* Status Badge */}
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold ${isRunning
                              ? 'bg-[#01a9ac]/15 text-[#01a9ac] border border-[#01a9ac]/30 animate-pulse'
                              : isPassed
                                ? 'bg-[#0ac282]/15 text-[#0ac282] border border-[#0ac282]/30'
                                : isFailed
                                  ? 'bg-[#fe5d70]/15 text-[#fe5d70] border border-[#fe5d70]/30'
                                  : 'bg-slate-100 text-slate-500 border border-slate-200'
                              }`}
                          >
                            {isRunning ? 'Running' : isPassed ? 'Passed' : isFailed ? 'Failed' : 'Idle'}
                          </span>
                        </td>

                        {/* Operations */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, -1)}
                              disabled={isExecuting || idx === 0}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"
                              title="Move Up"
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 1)}
                              disabled={isExecuting || idx === testScript.length - 1}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"
                              title="Move Down"
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateStep(idx)}
                              disabled={isExecuting}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"
                              title="Duplicate Step"
                            >
                              Clone
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStep(idx)}
                              disabled={isExecuting}
                              className="px-2 py-1 text-xs border border-red-200 rounded hover:bg-red-50 text-red-600 disabled:opacity-30"
                              title="Delete Step"
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
            <div>
              Total Steps: <strong className="text-slate-800">{testScript.length}</strong> &bull; Estimated Duration:{' '}
              <strong className="text-slate-800">{totalEstDuration}s</strong>
            </div>
            <button
              type="button"
              onClick={handleExecuteClick}
              disabled={isExecuting || testScript.length === 0}
              className="px-5 py-2.5 bg-gradient-to-r from-[#0ac282] to-[#0df3a3] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 text-white font-extrabold rounded-xl transition-all shadow-xs"
            >
              Execute on Vision & CNC
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiTestWorkbench;
