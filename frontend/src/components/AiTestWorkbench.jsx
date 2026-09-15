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

// Helper: Format labels to professional English names
export function formatLabelToEnglish(label) {
  if (!label) return 'Target Element';
  const l = String(label).trim();
  const lower = l.toLowerCase();

  // Normalize numbers 0-9: e.g. "nut 1", "nút 1", "phím 1", "key 1", "button 1", "1"
  const m = lower.match(/(?:nut|nút|phim|phím|key|button|số|so)?\s*([0-9])\b/);
  if (m && !lower.includes('nhap') && !lower.includes('nhập') && !lower.includes('amount') && !lower.includes('tien') && !lower.includes('tiền')) {
    return `Key ${m[1]}`;
  }

  if (lower.includes('thanh toan') || lower.includes('thanh toán') || lower.includes('pay')) return 'Pay Button';
  if (lower.includes('huy') || lower.includes('hủy') || lower.includes('cancel')) return 'Cancel Button';
  if (lower.includes('enter') || lower.includes('ok')) return 'Enter / OK Key';
  if (lower.includes('so tien') || lower.includes('số tiền') || lower.includes('nhap') || lower.includes('nhập') || lower.includes('amount')) return 'Amount Input Field';
  if (lower.includes('dang nhap') || lower.includes('đăng nhập') || lower.includes('login')) return 'Login Button';
  if (lower.includes('mat khau') || lower.includes('mật khẩu') || lower.includes('password')) return 'Password Field';
  if (lower.includes('email') || lower.includes('phone') || lower.includes('sdt')) return 'Email / Phone Field';

  return l;
}

// Helper: Smart Mock Generator with Automatic Vision Element Mapping
function generateSmartMockScript(rawPrompt, detectedTargets = []) {
  const text = (rawPrompt || '').trim();
  const lower = text.toLowerCase();

  // 1. If vision targets exist, intelligently extract requested buttons/keys from prompt in order
  if (detectedTargets && detectedTargets.length > 0) {
    const matchedSteps = [];
    // Split phrases by common Vietnamese & English delimiters: rồi, sau đó, tiếp theo, và, then, after, comma, dot, newline
    const tokens = text
      .split(/[,;\n.+]|\brồi\b|\bsau đó\b|\btiếp theo\b|\bva\b|\bvà\b|\bthen\b|\bafter\b|\bnext\b/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const token of tokens) {
      const pClean = token.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      let found = null;

      // Match numbers: e.g. "nút 1", "phím 1", "key 1", "số 1", "1"
      const numMatch = pClean.match(/(?:nut|phim|key|so|bam|nhan|cham)?\s*(\d+)/);
      if (numMatch) {
        const num = numMatch[1];
        found = detectedTargets.find((t) => {
          const tClean = (t.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return tClean === `nut ${num}` || tClean === `key ${num}` || tClean.includes(` ${num}`) || tClean === num || t.text === num;
        });
      }

      // Match special buttons: hủy, thanh toán, enter, ok, ô nhập số tiền...
      if (!found) {
        found = detectedTargets.find((t) => {
          const tClean = (t.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if ((pClean.includes('huy') || pClean.includes('cancel')) && tClean.includes('huy')) return true;
          if ((pClean.includes('thanh toan') || pClean.includes('pay')) && tClean.includes('thanh toan')) return true;
          if ((pClean.includes('nhap') || pClean.includes('tien')) && (tClean.includes('so tien') || tClean.includes('nhap'))) return true;
          if ((pClean.includes('enter') || pClean.includes('ok')) && (tClean.includes('enter') || tClean.includes('ok'))) return true;
          return pClean.includes(tClean) || tClean.includes(pClean);
        });
      }

      if (found) {
        const englishTarget = formatLabelToEnglish(found.label);
        const alreadyLast = matchedSteps.length > 0 && matchedSteps[matchedSteps.length - 1].target === englishTarget;
        if (!alreadyLast) {
          matchedSteps.push({
            id: matchedSteps.length + 1,
            action: englishTarget.includes('Input') || found.label.toLowerCase().includes('nhập') || found.label.toLowerCase().includes('nhap') ? 'TYPE' : 'CLICK',
            target: englishTarget,
            value: englishTarget.includes('Input') || found.label.toLowerCase().includes('nhập') || found.label.toLowerCase().includes('nhap') ? '50000' : (numMatch ? numMatch[1] : ''),
            delay_ms: 600,
            description: `CNC stylus tap on ${englishTarget} (CNC X: ${found.cnc_x}, Y: ${found.cnc_y})`,
            status: 'idle',
            cnc_x: found.cnc_x,
            cnc_y: found.cnc_y,
            pixel_x: found.pixel_x,
            pixel_y: found.pixel_y,
          });
        }
      }
    }

    if (matchedSteps.length > 0) {
      return {
        test_name: `Test Scenario: ${matchedSteps.map((s) => s.target).join(' -> ')}`,
        description: `Automated test generated from prompt: "${text}" mapped to physical camera vision targets`,
        device: 'CNC Stylus Robot + Camera Vision',
        engine: 'CNC Physical Absolute Coordinate Mapping',
        preconditions: 'Target screen and keypad positioned in calibrated camera workspace',
        expected: 'CNC stylus robot accurately moves and taps all targets sequentially',
        steps: matchedSteps,
      };
    }
  }

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

// Helper to map detected CNC coordinates to script steps
function attachCncCoordinates(steps, targets) {
  if (!targets || targets.length === 0) return steps;
  return steps.map((step) => {
    if (step.cnc_x !== undefined && step.cnc_x !== null && step.cnc_y !== undefined && step.cnc_y !== null) {
      return step;
    }
    const sTarget = (step.target || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const sVal = (step.value || '').toLowerCase().trim();

    const matched = targets.find((t) => {
      const tLabel = (t.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tText = (t.text || '').toLowerCase().trim();
      if (sVal && (tLabel === sVal || tLabel.includes(`nut ${sVal}`) || tLabel.includes(`key ${sVal}`) || tText === sVal)) return true;
      if (sTarget.includes('key 1') || sTarget.includes('nut 1') || sTarget === '1') {
        if (tLabel.includes('1') || tText.includes('1')) return true;
      }
      if (sTarget.includes('key 2') || sTarget.includes('nut 2') || sTarget === '2') {
        if (tLabel.includes('2') || tText.includes('2')) return true;
      }
      if (sTarget.includes('key 3') || sTarget.includes('nut 3') || sTarget === '3') {
        if (tLabel.includes('3') || tText.includes('3')) return true;
      }
      if (sTarget.includes('key 4') || sTarget.includes('nut 4') || sTarget === '4') {
        if (tLabel.includes('4') || tText.includes('4')) return true;
      }
      if (sTarget.includes('enter') || sTarget.includes('ok') || sTarget.includes('thanh toan')) {
        if (tLabel.includes('enter') || tLabel.includes('ok') || tLabel.includes('thanh toan')) return true;
      }
      return tLabel.includes(sTarget) || sTarget.includes(tLabel);
    });

    if (matched) {
      return {
        ...step,
        cnc_x: matched.cnc_x,
        cnc_y: matched.cnc_y,
        pixel_x: matched.pixel_x,
        pixel_y: matched.pixel_y,
        description: step.description || `Move to ${matched.label} (CNC X: ${matched.cnc_x}, Y: ${matched.cnc_y})`,
      };
    }
    return step;
  });
}

const AiTestWorkbench = ({
  testScript = [],
  setTestScript,
  aiTargets = [],
  onImportFromVision = null,
  onExecuteTest,
  isExecuting = false,
  executionProgress = { current: 0, total: 0, stepName: '' },
  switchToVisionTab,
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

  // One-click import all detected vision elements with exact CNC coords
  const handleImportDetectedTargets = () => {
    if (onImportFromVision) {
      onImportFromVision(aiTargets);
      setHasGenerated(true);
      return;
    }
    if (!aiTargets || aiTargets.length === 0) {
      toast.error('No elements detected from vision yet. Please run Detect Elements in Vision tab first.');
      return;
    }
    const converted = aiTargets.map((t, idx) => {
      const engLabel = formatLabelToEnglish(t.label) || `Target #${t.id || idx + 1}`;
      return {
        id: idx + 1,
        action: 'CLICK',
        target: engLabel,
        value: '',
        delay_ms: 600,
        description: `Tap ${engLabel} (CNC X: ${t.cnc_x}, Y: ${t.cnc_y})`,
        status: 'idle',
        cnc_x: t.cnc_x,
        cnc_y: t.cnc_y,
        pixel_x: t.pixel_x,
        pixel_y: t.pixel_y,
      };
    });
    setTestScript(converted);
    setHasGenerated(true);
    setTestName(`Test Scenario: ${aiTargets.length} Screen Targets`);
    setTestDesc(`Auto-synchronized from camera vision with physical CNC coordinates`);
    toast.success(`Imported ${converted.length} detected targets with CNC coordinates successfully.`);
  };

  const handleGenerateRecommendation = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a test scenario description.');
      return;
    }

    setIsGenerating(true);
    const toastId = toast.loading('AI analyzing prompt and generating test recommendations...');

    if (!useBackendAi) {
      setTimeout(() => {
        const generated = generateSmartMockScript(prompt, aiTargets);
        const enrichedSteps = attachCncCoordinates(generated.steps, aiTargets);
        setMockMetadata({ ...generated, steps: enrichedSteps });
        setTestName(generated.test_name);
        setTestDesc(generated.description);
        setTestScript(enrichedSteps);
        setHasGenerated(true);
        setIsGenerating(false);
        toast.success(`Generated ${enrichedSteps.length} test steps successfully.`, { id: toastId });
      }, 450);
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/ai/generate-testcases`, {
        prompt: prompt.trim(),
        existing_elements: (aiTargets || []).map((t) => `${t.label} (CNC X:${t.cnc_x}, Y:${t.cnc_y})`),
      });
      if (res.data?.success && res.data?.steps) {
        const enrichedSteps = attachCncCoordinates(res.data.steps, aiTargets);
        const genData = {
          test_name: res.data.test_name || 'Automated Test Scenario',
          description: res.data.description || prompt,
          device: 'Smartphone Touch Rig',
          engine: 'CNC Stylus + Vision AI',
          preconditions: 'Target app active in camera viewport',
          expected: 'Target UI state achieved with valid verification',
          steps: enrichedSteps,
        };
        setMockMetadata(genData);
        setTestName(genData.test_name);
        setTestDesc(genData.description);
        setTestScript(enrichedSteps);
        setHasGenerated(true);
        toast.success(`Generated ${enrichedSteps.length} steps via OpenAI API!`, { id: toastId });
      } else {
        throw new Error('Invalid response from AI server');
      }
    } catch (err) {
      const generated = generateSmartMockScript(prompt, aiTargets);
      const enrichedSteps = attachCncCoordinates(generated.steps, aiTargets);
      setMockMetadata({ ...generated, steps: enrichedSteps });
      setTestName(generated.test_name);
      setTestDesc(generated.description);
      setTestScript(enrichedSteps);
      setHasGenerated(true);
      toast.success(`Switched to Mock Engine: generated ${enrichedSteps.length} steps!`, { id: toastId });
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
      toast.error('Test script is empty! Please generate an AI test script or add test steps first.');
      return;
    }

    const preparedScript = testScript.map((s) => ({ ...s, status: 'idle' }));
    setTestScript(preparedScript);

    toast.success('Test script saved! Continue to Vision & Alignment to align frame, set origin, and detect targets.');

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
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">AI Script Suggestion</h2>
              {/* <span className="bg-[#fe5d70]/10 text-[#fe5d70] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#fe5d70]/20">
                Mock Engine Ready
              </span> */}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Ready to generate ATM security test. Click{' '}
              <strong>Generate AI Recommendation</strong> to generate the ATM PIN verification scenario and editable test script.
            </p>
          </div>

          {/* <label className="flex items-center gap-1.5 text-xs text-slate-600 font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useBackendAi}
              onChange={(e) => setUseBackendAi(e.target.checked)}
              className="rounded text-[#fe5d70] focus:ring-[#fe5d70]"
            />
            <span>Use OpenAI Cloud API</span>
          </label> */}
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
            {/* <span className="text-xs text-slate-500">
              💡 Automated entity extractor maps PIN keys (1, 2, 3, 4), Enter/OK key, and banking menu verification.
            </span> */}

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
              {aiTargets && aiTargets.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportDetectedTargets}
                  disabled={isExecuting}
                  className="px-3.5 py-2 bg-gradient-to-r from-[#fe5d70] to-[#fe9365] hover:shadow-md text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title="Load all detected screen elements and CNC coordinates into script table"
                >
                  <span>Import from Vision ({aiTargets.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleAddStep}
                disabled={isExecuting}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                + Add Step
              </button>
              <button
                type="button"
                onClick={handleResetStatuses}
                disabled={isExecuting}
                className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Reset Statuses
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isExecuting || testScript.length === 0}
                className="px-3.5 py-2 border border-red-200 hover:bg-red-50 text-red-600 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Clear All
              </button>

              {/* Continue to Vision Button
              <button
                type="button"
                onClick={handleExecuteClick}
                disabled={isExecuting || testScript.length === 0}
                className="px-5 py-2 bg-gradient-to-r from-[#01a9ac] to-[#0ac282] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 text-white text-xs font-extrabold rounded-lg transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                title="Proceed to Vision & Alignment tab to calibrate frame, set origin, and detect elements before executing"
              >
                <span>Continue to Vision & Alignment &rarr;</span>
              </button> */}
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
                    <th className="py-3 px-3 w-40 text-center">CNC Coords (X, Y)</th>
                    <th className="py-3 px-3 w-44">Input Value</th>
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

                        {/* CNC Coordinates (X, Y) */}
                        <td className="py-2.5 px-3 text-center">
                          {step.cnc_x !== undefined && step.cnc_y !== undefined && step.cnc_x !== null && step.cnc_y !== null ? (
                            <div className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs px-2 py-0.5 rounded-lg font-mono font-bold">
                              <span className="text-[10px] text-emerald-600">X:</span>
                              <input
                                type="number"
                                value={step.cnc_x}
                                onChange={(e) => handleUpdateStep(idx, 'cnc_x', e.target.value === '' ? null : Number(e.target.value))}
                                disabled={isExecuting}
                                className="w-12 bg-white border border-emerald-300 rounded px-1 py-0.5 text-center text-xs text-emerald-900 font-bold outline-none"
                              />
                              <span className="text-[10px] text-emerald-600">Y:</span>
                              <input
                                type="number"
                                value={step.cnc_y}
                                onChange={(e) => handleUpdateStep(idx, 'cnc_y', e.target.value === '' ? null : Number(e.target.value))}
                                disabled={isExecuting}
                                className="w-12 bg-white border border-emerald-300 rounded px-1 py-0.5 text-center text-xs text-emerald-900 font-bold outline-none"
                              />
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-mono">
                              Auto Vision Match
                            </span>
                          )}
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
              className="px-5 py-2.5 bg-gradient-to-r from-[#01a9ac] to-[#0ac282] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 text-white font-extrabold rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-2"
              title="Proceed to Vision & Alignment tab to calibrate frame, set origin, and detect elements before executing"
            >
              <span>Continue to Vision & Alignment &rarr;</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiTestWorkbench;
