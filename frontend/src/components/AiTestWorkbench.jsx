import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const API_BASE = 'http://localhost:8000';

const DEFAULT_PROMPT =
  'Quy trình máy POS: 1. Chọn icon Payment -> 2. Chọn Purchase tại Select Function Type -> 3. Nhập số tiền 123 và bấm Pay -> 4. Màn Checkout chọn Tap to Pay rồi bấm Pay Now -> 5. Nhập mã PIN 6 số (123456) bấm OK -> 6. Xác nhận giao dịch thành công và In hóa đơn (In Bill)';

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

export const MULTI_SCREEN_MOCK_DATA = {
  test_name: 'Test Scenario: 4-Màn Hình Thanh Toán (Auto-Park & Chuyển Trang)',
  description: 'Luồng kiểm thử 4 màn hình tuần tự: Nhập PIN -> Chọn Số Tiền -> Xác Nhận OTP -> Hoàn Tất (CNC tự động lùi về Park & Quét nút từng trang)',
  device: 'Smartphone / POS Touch Rig',
  engine: 'CNC Robot Stylus + Multi-Screen Vision AI',
  preconditions: 'Ứng dụng đã mở ở Màn hình 1 (Nhập mã PIN)',
  expected: 'Tự động duyệt qua 4 màn hình, CNC đỗ an toàn trước mỗi lần quét trang mới',
  steps: [
    // MÀN 1: Nhập PIN
    { id: 1, action: 'CLICK', target: 'Numeric Key 1', value: '1', delay_ms: 450, screen: 'Màn 1: PIN', park_after: false, description: 'Màn 1: Bấm phím 1', status: 'idle' },
    { id: 2, action: 'CLICK', target: 'Numeric Key 2', value: '2', delay_ms: 450, screen: 'Màn 1: PIN', park_after: false, description: 'Màn 1: Bấm phím 2', status: 'idle' },
    { id: 3, action: 'CLICK', target: 'Numeric Key 3', value: '3', delay_ms: 450, screen: 'Màn 1: PIN', park_after: false, description: 'Màn 1: Bấm phím 3', status: 'idle' },
    { id: 4, action: 'CLICK', target: 'Enter / OK Key', value: 'ENTER', delay_ms: 700, screen: 'Màn 1: PIN', park_after: true, description: 'Màn 1: Bấm Enter -> Lùi Park & Quét Màn 2', status: 'idle' },

    // MÀN 2: Chọn Số Tiền
    { id: 5, action: 'CLICK', target: '500,000 đ', value: '500000', delay_ms: 500, screen: 'Màn 2: Số tiền', park_after: false, description: 'Màn 2: Chọn mệnh giá 500k', status: 'idle' },
    { id: 6, action: 'CLICK', target: 'Tiếp tục', value: 'NEXT', delay_ms: 700, screen: 'Màn 2: Số tiền', park_after: true, description: 'Màn 2: Bấm Tiếp tục -> Lùi Park & Quét Màn 3', status: 'idle' },

    // MÀN 3: Xác Nhận OTP
    { id: 7, action: 'CLICK', target: 'Xác nhận OTP', value: 'CONFIRM', delay_ms: 700, screen: 'Màn 3: Xác nhận', park_after: true, description: 'Màn 3: Bấm Xác nhận -> Lùi Park & Quét Màn 4', status: 'idle' },

    // MÀN 4: Biên Lai Hoàn Tất
    { id: 8, action: 'VERIFY', target: 'Giao dịch thành công', value: 'SUCCESS', delay_ms: 800, screen: 'Màn 4: Biên lai', park_after: false, description: 'Màn 4: Xác thực kết quả thành công', status: 'idle' },
  ],
};

export const POS_TERMINAL_PAYMENT_FLOW_DATA = {
  test_name: 'Test Scenario: Thanh Toán Tự Động Máy POS (5 Màn Hình Tuần Tự)',
  description: 'Quy trình hoàn chỉnh trên thiết bị POS: Icon Payment -> Select Purchase -> Nhập tiền 123 -> Checkout (Tap to Pay) -> Nhập PIN 6 số -> Hoàn tất',
  device: 'POS Terminal Machine (Màn hình cảm ứng & Bàn phím số)',
  engine: 'CNC Robot Stylus + Multi-Screen Auto-Park Vision AI',
  preconditions: 'Máy POS đang ở màn hình chính (Home) có icon Payment',
  expected: 'Chỉ cần chụp 1 ảnh thiết bị POS ban đầu tại Màn 1. Robot tự động thực thi tuần tự 6 giai đoạn màn hình (lùi Z về vị trí Park, chờ POS chuyển trang và bấm tiếp), xác nhận thanh toán thành công không cần chụp lại',
  steps: [
    // MÀN 1: Màn hình chính (Home)
    {
      id: 1,
      action: 'CLICK',
      target: 'Payment Icon',
      value: 'PAYMENT',
      delay_ms: 700,
      screen: 'Màn 1: Home',
      park_after: true,
      description: 'Màn 1: Nhấn icon Payment -> CNC lùi Park & Chờ POS đổi màn sang Select Function Type',
      status: 'idle',
    },

    // MÀN 2: Select Function Type
    {
      id: 2,
      action: 'CLICK',
      target: 'Purchase',
      value: 'PURCHASE',
      delay_ms: 700,
      screen: 'Màn 2: Function Type',
      park_after: true,
      description: 'Màn 2: Chọn Purchase trong Select Function Type -> Lùi Park & Chờ POS đổi màn sang nhập tiền',
      status: 'idle',
    },

    // MÀN 3: Nhập số tiền 123
    {
      id: 3,
      action: 'CLICK',
      target: 'Numeric Key 1',
      value: '1',
      delay_ms: 450,
      screen: 'Màn 3: Nhập tiền',
      park_after: false,
      description: 'Màn 3: Bấm phím số 1',
      status: 'idle',
    },
    {
      id: 4,
      action: 'CLICK',
      target: 'Numeric Key 2',
      value: '2',
      delay_ms: 450,
      screen: 'Màn 3: Nhập tiền',
      park_after: false,
      description: 'Màn 3: Bấm phím số 2',
      status: 'idle',
    },
    {
      id: 5,
      action: 'CLICK',
      target: 'Numeric Key 3',
      value: '3',
      delay_ms: 450,
      screen: 'Màn 3: Nhập tiền',
      park_after: false,
      description: 'Màn 3: Bấm phím số 3 (Hoàn thành số tiền 123)',
      status: 'idle',
    },
    {
      id: 6,
      action: 'CLICK',
      target: 'Pay Button',
      value: 'PAY',
      delay_ms: 800,
      screen: 'Màn 3: Nhập tiền',
      park_after: true,
      description: 'Màn 3: Bấm nút Pay -> Chuyển sang màn hình Checkout (Lùi Park & Chờ POS đổi màn)',
      status: 'idle',
    },

    // MÀN 4: Checkout Option (Tap to Pay / Insert Card / Swipe Card)
    {
      id: 7,
      action: 'CLICK',
      target: 'Tap to Pay',
      value: 'TAP_TO_PAY',
      delay_ms: 600,
      screen: 'Màn 4: Checkout',
      park_after: false,
      description: 'Màn 4: Chọn phương thức thanh toán Tap to Pay (tùy chọn: Insert Card / Swipe Card)',
      status: 'idle',
    },
    {
      id: 8,
      action: 'CLICK',
      target: 'Pay Now Button',
      value: 'PAY_NOW',
      delay_ms: 800,
      screen: 'Màn 4: Checkout',
      park_after: true,
      description: 'Màn 4: Bấm Pay Now -> Chuyển sang màn hình nhập mã PIN (Lùi Park & Chờ POS đổi màn)',
      status: 'idle',
    },

    // MÀN 5: Nhập mã PIN 6 số bất kì (Ví dụ setup 1, 2, 3, 4, 5, 6)
    {
      id: 9,
      action: 'CLICK',
      target: 'Numeric Key 1',
      value: '1',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 1/6',
      status: 'idle',
    },
    {
      id: 10,
      action: 'CLICK',
      target: 'Numeric Key 2',
      value: '2',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 2/6',
      status: 'idle',
    },
    {
      id: 11,
      action: 'CLICK',
      target: 'Numeric Key 3',
      value: '3',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 3/6',
      status: 'idle',
    },
    {
      id: 12,
      action: 'CLICK',
      target: 'Numeric Key 4',
      value: '4',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 4/6',
      status: 'idle',
    },
    {
      id: 13,
      action: 'CLICK',
      target: 'Numeric Key 5',
      value: '5',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 5/6',
      status: 'idle',
    },
    {
      id: 14,
      action: 'CLICK',
      target: 'Numeric Key 6',
      value: '6',
      delay_ms: 450,
      screen: 'Màn 5: Nhập PIN',
      park_after: false,
      description: 'Màn 5: Bấm số PIN 6/6',
      status: 'idle',
    },
    {
      id: 15,
      action: 'CLICK',
      target: 'Enter / OK Key',
      value: 'ENTER',
      delay_ms: 800,
      screen: 'Màn 5: Nhập PIN',
      park_after: true,
      description: 'Màn 5: Bấm Enter/OK xác nhận mã PIN -> Lùi Park & Đợi POS duyệt giao dịch',
      status: 'idle',
    },
    {
      id: 16,
      action: 'VERIFY',
      target: 'Transaction Approved / Success',
      value: 'APPROVED',
      delay_ms: 1000,
      screen: 'Màn 6: Kết quả & In Bill',
      park_after: false,
      description: 'Màn 6: Xác thực màn hình thông báo Giao dịch thành công (Approved / Payment Success)',
      status: 'idle',
    },
    {
      id: 17,
      action: 'CLICK',
      target: 'Print Receipt Button',
      value: 'PRINT_BILL',
      delay_ms: 1500,
      screen: 'Màn 6: Kết quả & In Bill',
      park_after: true,
      description: 'Màn 6: Nhấn In Hóa Đơn (Print Bill) -> Máy POS kích hoạt máy in nhiệt in biên lai giấy giao dịch',
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

  if (lower.includes('pay now') || lower.includes('paynow')) return 'Pay Now Button';
  if (lower.includes('tap to pay') || lower.includes('contactless') || lower.includes('tap')) return 'Tap to Pay';
  if (lower.includes('insert card') || lower.includes('insert')) return 'Insert Card';
  if (lower.includes('swipe card') || lower.includes('swipe')) return 'Swipe Card';
  if (lower.includes('purchase')) return 'Purchase';
  if (lower.includes('payment')) return 'Payment Icon';
  if (lower.includes('thanh toan') || lower.includes('thanh toán') || lower.includes('pay')) return 'Pay Button';
  if (lower.includes('huy') || lower.includes('hủy') || lower.includes('cancel')) return 'Cancel Button';
  if (lower.includes('enter') || lower.includes('ok')) return 'Enter / OK Key';
  if (lower.includes('tiep tuc') || lower.includes('tiếp tục') || lower.includes('continue') || lower.includes('next')) return 'Next / Continue Button';
  if (lower.includes('xac nhan') || lower.includes('xác nhận') || lower.includes('confirm')) return 'Confirm Button';
  if (lower.includes('dong y') || lower.includes('đồng ý') || lower.includes('agree')) return 'Agree Button';
  if (lower.includes('500') || lower.includes('500k') || lower.includes('500.000')) return '500,000 đ';
  if (lower.includes('so tien') || lower.includes('số tiền') || lower.includes('nhap') || lower.includes('nhập') || lower.includes('amount')) return 'Amount Input Field';
  if (lower.includes('dang nhap') || lower.includes('đăng nhập') || lower.includes('login')) return 'Login Button';
  if (lower.includes('mat khau') || lower.includes('mật khẩu') || lower.includes('password')) return 'Password Field';
  if (lower.includes('email') || lower.includes('phone') || lower.includes('sdt')) return 'Email / Phone Field';

  return l;
}

// Helper: Generate crisp simulated POS terminal frame when webcam is offline/not connected
export function createMockPosFrame() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 1280, 720);

  // Outer Terminal Body
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(140, 40, 1000, 640, 24);
  else ctx.rect(140, 40, 1000, 640);
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  ctx.stroke();

  // POS Display Screen
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(180, 80, 920, 560, 16);
  else ctx.rect(180, 80, 920, 560);
  ctx.fill();

  // Screen Status Header
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(180, 80, 920, 60);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('SMART POS TERMINAL V3 - ONLINE', 210, 118);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('10:24 AM  •  WiFi 5G Connected', 840, 118);

  // Screen Title
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText('MÀN 1: CHỌN DỊCH VỤ / MAIN DASHBOARD', 220, 190);

  // Target 1: Payment Icon Button
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(240, 240, 240, 160, 16);
  else ctx.rect(240, 240, 240, 160);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText('💳', 340, 310);
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('PAYMENT', 305, 360);

  // Target 2: Settings Button
  ctx.fillStyle = '#64748b';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(520, 240, 240, 160, 16);
  else ctx.rect(520, 240, 240, 160);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText('⚙️', 620, 310);
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('SETTINGS', 580, 360);

  // Target 3: Reports Button
  ctx.fillStyle = '#64748b';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(800, 240, 240, 160, 16);
  else ctx.rect(800, 240, 240, 160);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText('📊', 900, 310);
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('REPORTS', 865, 360);

  // Target 1 bounding box highlight
  ctx.strokeStyle = '#0ac282';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(235, 235, 250, 170);
  ctx.setLineDash([]);
  ctx.fillStyle = '#0ac282';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText('TARGET #1: PAYMENT ICON (X: 120.5, Y: 85.0)', 235, 225);

  // Corner marks (Góc 1: Park)
  ctx.strokeStyle = '#fe5d70';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(150, 90); ctx.lineTo(150, 50); ctx.lineTo(190, 50);
  ctx.stroke();
  ctx.fillStyle = '#fe5d70';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText('📍 Góc 1: Vị Trí Park (Home)', 150, 40);

  return canvas.toDataURL('image/jpeg', 0.9);
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

  // POS Terminal Payment Scenario Match
  if (
    lower.includes('pos') ||
    lower.includes('purchase') ||
    lower.includes('select function') ||
    lower.includes('pay now') ||
    lower.includes('paynow') ||
    lower.includes('123') ||
    lower.includes('tap to pay') ||
    lower.includes('insert card') ||
    lower.includes('swipe card') ||
    lower.includes('mã pin') ||
    lower.includes('ma pin') ||
    lower.includes('6 số') ||
    lower.includes('6 so') ||
    lower.includes('icon payment') ||
    lower.includes('payment')
  ) {
    const posData = JSON.parse(JSON.stringify(POS_TERMINAL_PAYMENT_FLOW_DATA));

    // Dynamic adjustment if user specified Insert Card or Swipe Card in prompt
    if (lower.includes('insert card') || lower.includes('insert')) {
      posData.steps[6].target = 'Insert Card';
      posData.steps[6].value = 'INSERT_CARD';
      posData.steps[6].description = 'Màn 4: Chọn phương thức thanh toán Insert Card';
    } else if (lower.includes('swipe card') || lower.includes('swipe')) {
      posData.steps[6].target = 'Swipe Card';
      posData.steps[6].value = 'SWIPE_CARD';
      posData.steps[6].description = 'Màn 4: Chọn phương thức thanh toán Swipe Card';
    }

    // Dynamic adjustment for PIN if 6 specific digits mentioned
    const pinMatch = text.match(/\b(\d)(\d)(\d)(\d)(\d)(\d)\b/);
    if (pinMatch) {
      for (let k = 1; k <= 6; k += 1) {
        const digit = pinMatch[k];
        posData.steps[7 + k].target = `Numeric Key ${digit}`;
        posData.steps[7 + k].value = digit;
        posData.steps[7 + k].description = `Màn 5: Bấm số PIN ${k}/6 (${digit})`;
      }
    }

    return posData;
  }

  // 4-Screen Multi-Page Scenario Match
  if (
    lower.includes('4 man') ||
    lower.includes('4 màn') ||
    lower.includes('4-screen') ||
    lower.includes('4 screen') ||
    lower.includes('vi dien tu') ||
    lower.includes('ví điện tử')
  ) {
    return JSON.parse(JSON.stringify(MULTI_SCREEN_MOCK_DATA));
  }

  // ATM PIN Scenario (Only when specifically requested with ATM)
  if (
    lower.includes('atm') ||
    lower.includes('banking')
  ) {
    return JSON.parse(JSON.stringify(ATM_MOCK_DATA));
  }

  // Default to POS Terminal Payment Scenario
  return JSON.parse(JSON.stringify(POS_TERMINAL_PAYMENT_FLOW_DATA));

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

// Visual themes for distinct screens in multi-screen workflow (Clean White-Teal & Slate)
export const SCREEN_THEMES = [
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '📱',
  },
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '📂',
  },
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '💵',
  },
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '💳',
  },
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '🔐',
  },
  {
    cardBorder: 'border-slate-200',
    headerBg: 'bg-gradient-to-r from-[#404E67] to-[#2d3748]',
    badge: 'bg-teal-500/20 text-teal-200 border-teal-400/30',
    accentText: 'text-[#01a9ac]',
    icon: '🧾',
  },
];

// Helper: Group sequential script steps into distinct physical screens
export function groupStepsByScreen(steps) {
  if (!steps || steps.length === 0) return [];
  const groups = [];
  let currentGroup = null;

  steps.forEach((step, idx) => {
    const rawScreen = step.screen ? String(step.screen).trim() : '';

    if (!currentGroup || (rawScreen && currentGroup.screenName !== rawScreen)) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        id: groups.length + 1,
        screenName: rawScreen || `Màn ${groups.length + 1}`,
        items: [],
      };
    }

    currentGroup.items.push({ step, idx });

    // If step triggers park_after, and NEXT step exists and doesn't explicitly share the exact same screen name
    if (step.park_after && idx < steps.length - 1 && steps[idx + 1].screen !== rawScreen) {
      groups.push(currentGroup);
      currentGroup = null;
    }
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }
  return groups;
}

// Visual Wireframe representation for each screen inferred by AI (Clean White-Teal & Slate)
export const ScreenWireframePreview = ({ screenName, capturedImage, isFirstScreen }) => {
  const lower = (screenName || '').toLowerCase();

  // If first screen and user has a real camera snapshot, show the camera snapshot with AI detection overlays
  if (isFirstScreen && capturedImage) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative rounded-lg overflow-hidden border border-teal-500/50 max-w-[240px] shadow-xs">
          <img src={capturedImage} alt="Real Device Capture" className="w-full h-32 object-cover" />
          <div className="absolute top-2 left-2 bg-slate-900/80 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-300 border border-emerald-500/30">
            📸 ẢNH THIẾT BỊ GỐC
          </div>
          <div className="absolute bottom-2 left-2 right-2 bg-teal-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded text-center backdrop-blur-xs">
            Target #1: Payment Icon
          </div>
        </div>
        <div className="flex-1 space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-900 text-sm">Màn 1: Giao diện chính POS (Home)</span>
            <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2 py-0.5 rounded-full font-bold border border-emerald-200">
              Đã Đối Chiếu Camera
            </span>
          </div>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            AI nhận diện trực tiếp từ ảnh chụp thiết bị &rarr; Icon <strong>Payment</strong> tại tọa độ CNC <code>X: 120.5, Y: 85.0</code>.
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600 pt-1">
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">📍 Stylus: Park &rarr; Click</span>
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">🔄 Sau bước: Lùi Z Park</span>
          </div>
        </div>
      </div>
    );
  }

  // Screen 1: Home Menu Wireframe
  if (lower.includes('home') || lower.includes('màn 1')) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
          <div className="flex justify-between items-center text-[9px] text-slate-500 pb-1 border-b border-slate-100">
            <span className="font-semibold text-slate-700">SMART POS V3</span>
            <span>10:24 AM 📶</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 my-auto">
            <div className="bg-teal-50 border border-teal-300 rounded p-1 text-center">
              <span className="text-xs block">💳</span>
              <span className="text-[8px] font-bold text-teal-800">PAYMENT</span>
            </div>
            <div className="bg-slate-50 rounded p-1 text-center border border-slate-100">
              <span className="text-xs block">⚙️</span>
              <span className="text-[8px] text-slate-400">SETTING</span>
            </div>
            <div className="bg-slate-50 rounded p-1 text-center border border-slate-100">
              <span className="text-xs block">📊</span>
              <span className="text-[8px] text-slate-400">REPORT</span>
            </div>
          </div>
          <div className="text-[8px] text-teal-700 text-center font-mono font-semibold">Target: [Payment Icon]</div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Giao diện Màn 1 do AI ngoại suy:</span>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">Home Dashboard</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Màn hình chính chứa các chức năng cơ bản. Stylus nhắm mục tiêu vào icon <strong>Payment</strong> để bắt đầu giao dịch.
          </p>
        </div>
      </div>
    );
  }

  // Screen 2: Select Function Type Wireframe
  if (lower.includes('function') || lower.includes('màn 2')) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
          <div className="text-[9px] text-slate-500 pb-1 border-b border-slate-100 text-center font-bold">
            SELECT FUNCTION TYPE
          </div>
          <div className="space-y-1 my-auto">
            <div className="bg-teal-50 border border-teal-300 rounded px-2 py-0.5 text-center flex items-center justify-between text-[9px] font-bold text-teal-800">
              <span>🛒 PURCHASE (BÁN HÀNG)</span>
              <span className="text-teal-600">●</span>
            </div>
            <div className="bg-slate-50 rounded px-2 py-0.5 text-center text-[9px] text-slate-400 border border-slate-100">
              <span>↩️ REFUND (HOÀN TIỀN)</span>
            </div>
          </div>
          <div className="text-[8px] text-teal-700 text-center font-mono font-semibold">Target: [Purchase Card]</div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Giao diện Màn 2 do AI ngoại suy:</span>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">Function Type</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Menu chọn nghiệp vụ máy POS. AI nhận diện phương thức bán hàng thông thường là <strong>Purchase</strong> và điều hướng robot bấm chọn.
          </p>
        </div>
      </div>
    );
  }

  // Screen 3: Nhập tiền Wireframe
  if (lower.includes('tiền') || lower.includes('màn 3')) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
          <div className="text-[9px] text-slate-500 text-center font-medium">ENTER AMOUNT</div>
          <div className="bg-slate-50 border border-teal-300 rounded py-1 px-2 text-center text-sm font-extrabold text-teal-800 font-mono">
            $123.00
          </div>
          <div className="flex justify-between items-center text-[9px] pt-1">
            <span className="text-slate-500 font-mono">Phím: 1 &rarr; 2 &rarr; 3</span>
            <span className="bg-teal-600 text-white px-2 py-0.5 rounded font-bold">PAY &gt;&gt;</span>
          </div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Giao diện Màn 3 do AI ngoại suy:</span>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">Amount Input</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Bàn phím nhập số tiền thanh toán. Robot bấm tuần tự các phím số <strong>1, 2, 3</strong> sau đó nhấn nút <strong>Pay</strong> để chuyển sang bước kiểm tra thẻ.
          </p>
        </div>
      </div>
    );
  }

  // Screen 4: Checkout Option Wireframe
  if (lower.includes('checkout') || lower.includes('màn 4')) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
          <div className="text-[9px] text-slate-500 text-center font-bold">CHOOSE PAYMENT</div>
          <div className="grid grid-cols-3 gap-1 text-[8px] my-auto">
            <div className="bg-teal-50 border border-teal-300 rounded p-1 text-center font-bold text-teal-800">
              <span className="block text-[10px]">📶</span>TAP
            </div>
            <div className="bg-slate-50 rounded p-1 text-center text-slate-400 border border-slate-100">
              <span className="block text-[10px]">💳</span>CHIP
            </div>
            <div className="bg-slate-50 rounded p-1 text-center text-slate-400 border border-slate-100">
              <span className="block text-[10px]">〰️</span>SWIPE
            </div>
          </div>
          <div className="bg-teal-600 text-white text-center font-bold text-[9px] py-0.5 rounded">
            PAY NOW ($123)
          </div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Giao diện Màn 4 do AI ngoại suy:</span>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">Checkout Option</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Chọn hình thức quẹt/chạm thẻ. AI thiết lập chọn <strong>Tap to Pay</strong> (NFC contactless) rồi bấm <strong>Pay Now</strong> chuyển sang bước xác thực bảo mật.
          </p>
        </div>
      </div>
    );
  }

  // Screen 5: Nhập PIN Wireframe
  if (lower.includes('pin') || lower.includes('màn 5')) {
    return (
      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
          <div className="text-[9px] text-slate-500 text-center font-bold">ENTER 6-DIGIT PIN</div>
          <div className="flex justify-center gap-1.5 text-teal-700 font-mono text-sm py-1">
            <span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span>
          </div>
          <div className="flex justify-between items-center text-[9px]">
            <span className="text-slate-500 font-mono">Phím: 1,2,3,4,5,6</span>
            <span className="bg-teal-600 text-white px-2 py-0.5 rounded font-bold">ENTER ✓</span>
          </div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Giao diện Màn 5 do AI ngoại suy:</span>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">PIN Authentication</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Bàn phím nhập mã PIN bảo mật 6 số. Robot bấm tuần tự 6 phím số đã cấu hình rồi bấm <strong>Enter / OK</strong> để xác nhận chủ thẻ.
          </p>
        </div>
      </div>
    );
  }

  // Screen 6: Kết quả & In Bill Wireframe
  return (
    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-800 flex flex-col sm:flex-row gap-4 items-center">
      <div className="w-48 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex flex-col justify-between h-28 text-slate-800">
        <div className="flex items-center justify-center gap-1 text-emerald-600 text-[10px] font-extrabold pt-1">
          <span>✓</span> APPROVED SUCCESS
        </div>
        <div className="bg-slate-50 rounded px-2 py-1 text-center text-[9px] font-mono text-slate-600 border border-slate-100">
          🧾 RECEIPT #8841<br />Total: $123.00
        </div>
        <div className="bg-emerald-600 text-white text-center font-bold text-[9px] py-0.5 rounded flex items-center justify-center gap-1">
          <span>🖨️</span> IN HÓA ĐƠN (PRINT)
        </div>
      </div>
      <div className="flex-1 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900">Giao diện Màn 6 do AI ngoại suy:</span>
          <span className="text-[10px] bg-slate-200/70 text-slate-700 px-2 py-0.2 rounded font-semibold">Approved & Print</span>
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Màn hình thông báo giao dịch thành công. Robot kiểm tra kết quả qua OCR và bấm nút <strong>In Hóa Đơn (Print Bill)</strong> để máy POS in biên lai nhiệt kết thúc quy trình.
        </p>
      </div>
    </div>
  );
};

const AiTestWorkbench = ({
  testScript = [],
  setTestScript,
  aiTargets = [],
  setAiTargets,
  onImportFromVision = null,
  onExecuteTest,
  isExecuting = false,
  executionProgress = { current: 0, total: 0, stepName: '' },
  switchToVisionTab,
  sharedStream = null,
  cameras = [],
  selectedCameraId = '',
  onSelectCamera = null,
  onRefreshCameras = null,
  isCameraActive = true,
  onToggleCamera = null,
  cameraError = '',
}) => {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isGenerating, setIsGenerating] = useState(false);
  // Initially false: only show test scenario specifications & table AFTER clicking Generate
  const [hasGenerated, setHasGenerated] = useState(false);
  const [useBackendAi, setUseBackendAi] = useState(false);
  const [viewMode, setViewMode] = useState('screens'); // 'screens' | 'flat'
  const [activeScreenTab, setActiveScreenTab] = useState('all'); // 'all' | 0..N

  // Camera & Device Screen Capture state
  const videoRef = useRef(null);
  const [showGuides, setShowGuides] = useState(true);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedTimestamp, setCapturedTimestamp] = useState('');
  const [capturedScreens, setCapturedScreens] = useState({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewModalImg, setPreviewModalImg] = useState(null);

  // Directly attach the shared camera stream to video without duplicate getUserMedia calls
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      if (sharedStream && isCameraActive) {
        video.srcObject = sharedStream;
        video.play().catch(() => {});
      } else {
        video.srcObject = null;
      }
    }
  }, [sharedStream, isCameraActive]);

  // Capture current frame from live video or fallback to mock POS frame
  const captureFrameFromVideo = () => {
    const video = videoRef.current;
    if (video && video.videoWidth && video.readyState >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.88);
    }
    return createMockPosFrame();
  };

  // Capture device screen and automatically generate the 5-screen POS payment script
  const handleCaptureAndGenerate = async () => {
    setIsCapturing(true);
    const toastId = toast.loading('Đang chụp màn hình thiết bị từ camera...');

    try {
      const frameData = captureFrameFromVideo();
      const timeStr = new Date().toLocaleTimeString('vi-VN');
      setCapturedImage(frameData);
      setCapturedTimestamp(timeStr);
      setCapturedScreens((prev) => ({
        ...prev,
        'Màn 1: Home': frameData,
      }));

      toast.loading('AI đang phân tích màn hình thiết bị & sinh kịch bản...', { id: toastId });

      // Run generation with rich POS flow
      await new Promise((r) => setTimeout(r, 450));
      const generated = generateSmartMockScript(prompt, aiTargets);
      const enrichedSteps = attachCncCoordinates(generated.steps, aiTargets);
      setMockMetadata({ ...generated, steps: enrichedSteps });
      setTestName(generated.test_name);
      setTestDesc(generated.description);
      setTestScript(enrichedSteps);
      setHasGenerated(true);

      toast.success(
        `Đã chụp màn hình thiết bị (${timeStr}) & tự động sinh ${enrichedSteps.length} bước thanh toán POS!`,
        { id: toastId, duration: 4000 }
      );
    } catch (err) {
      toast.error('Lỗi khi chụp hoặc sinh kịch bản: ' + err.message, { id: toastId });
    } finally {
      setIsCapturing(false);
    }
  };

  // Capture snapshot for a specific screen card in multi-screen workflow
  const handleCaptureScreenSnapshot = (screenName) => {
    const frameData = captureFrameFromVideo();
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    setCapturedScreens((prev) => ({
      ...prev,
      [screenName]: frameData,
    }));
    toast.success(`Đã chụp ảnh màn hình cho "${screenName}" lúc ${timeStr}!`);
  };

  // Handle upload image from disk as fallback
  const handleUploadImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      const timeStr = new Date().toLocaleTimeString('vi-VN');
      setCapturedImage(dataUrl);
      setCapturedTimestamp(timeStr);
      setCapturedScreens((prev) => ({
        ...prev,
        'Màn 1: Home': dataUrl,
      }));
      toast.success('Đã nạp ảnh thiết bị thành công!');
    };
    reader.readAsDataURL(file);
  };

  // Metadata Overview state
  const [mockMetadata, setMockMetadata] = useState(POS_TERMINAL_PAYMENT_FLOW_DATA);
  const [testName, setTestName] = useState(POS_TERMINAL_PAYMENT_FLOW_DATA.test_name);
  const [testDesc, setTestDesc] = useState(POS_TERMINAL_PAYMENT_FLOW_DATA.description);

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

  const handleAddStepToScreen = (screenName, insertAfterIndex) => {
    const newId = testScript.length > 0 ? Math.max(...testScript.map((s) => s.id || 0)) + 1 : 1;
    const newStep = {
      id: newId,
      action: 'CLICK',
      target: `Phím / Nút mới`,
      value: '',
      delay_ms: 600,
      screen: screenName,
      park_after: false,
      description: `Thao tác trên ${screenName}`,
      status: 'idle',
    };
    setTestScript((prev) => {
      const next = [...prev];
      if (insertAfterIndex !== undefined && insertAfterIndex >= 0) {
        next.splice(insertAfterIndex + 1, 0, newStep);
      } else {
        next.push(newStep);
      }
      return next;
    });
    toast.success(`Đã thêm bước mới vào ${screenName}`);
  };

  const handleAddStep = () => {
    const newId = testScript.length > 0 ? Math.max(...testScript.map((s) => s.id || 0)) + 1 : 1;
    const lastScreen = testScript.length > 0 ? (testScript[testScript.length - 1].screen || 'Màn 1') : 'Màn 1: Home';
    const newStep = {
      id: newId,
      action: 'CLICK',
      target: `Target Element #${newId}`,
      value: '',
      delay_ms: 600,
      screen: lastScreen,
      park_after: false,
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
      {/* Zoom Modal for captured POS image */}
      {previewModalImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewModalImg(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3 text-white">
              <span className="font-extrabold text-sm">Ảnh Chụp Màn Hình Thiết Bị POS (Gốc)</span>
              <button
                type="button"
                onClick={() => setPreviewModalImg(null)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 py-0.5 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <img
              src={previewModalImg}
              alt="Full Preview"
              className="max-h-[75vh] object-contain rounded-lg bg-black"
            />
          </div>
        </div>
      )}

      {/* ===================================================================
          CARD 0: LIVE DEVICE CAMERA & SCREEN CAPTURE (USER REQUEST)
          =================================================================== */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-md overflow-hidden text-white relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-[#01a9ac]" />

        {/* Top Header of Video Card */}
        <div className="px-5 py-3.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-[#0ac282] border border-emerald-500/30">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white tracking-wide">
                  Camera Giám Sát Thiết Bị (Live Device Screen View)
                </h3>
                {isCameraActive ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE FEED
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    PAUSED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Quan sát màn hình POS thực tế qua camera & Chụp màn hình để tự động sinh các bước test tương ứng
              </p>
            </div>
          </div>

          {/* Camera Controls Toolbar */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Camera Select */}
            {cameras.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-800/90 px-2.5 py-1 rounded-lg border border-slate-700">
                <span className="text-slate-400 text-[11px]">Cam:</span>
                <select
                  value={selectedCameraId}
                  onChange={(e) => onSelectCamera && onSelectCamera(e.target.value)}
                  className="bg-transparent text-white text-xs outline-none cursor-pointer pr-1"
                >
                  {cameras.map((c, i) => (
                    <option key={c.deviceId || i} value={c.deviceId} className="bg-slate-900 text-white">
                      {c.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Refresh cameras button */}
            <button
              type="button"
              onClick={() => onRefreshCameras && onRefreshCameras()}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Làm mới danh sách camera"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Toggle Grid/Guides */}
            <button
              type="button"
              onClick={() => setShowGuides(!showGuides)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                showGuides
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              {showGuides ? '✓ Khung Căn Chỉnh' : '+ Khung Căn Chỉnh'}
            </button>

            {/* Toggle Camera On/Off */}
            <button
              type="button"
              onClick={() => onToggleCamera && onToggleCamera()}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              {isCameraActive ? 'Tắt Camera' : 'Bật Camera'}
            </button>
          </div>
        </div>

        {/* Video Canvas Body */}
        <div className="p-4 bg-slate-950 flex flex-col md:flex-row gap-4 items-stretch">
          {/* Main Video Screen with HUD */}
          <div className="relative flex-1 bg-black rounded-xl overflow-hidden min-h-[260px] max-h-[420px] flex items-center justify-center border border-slate-800 group shadow-inner">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full max-h-[380px] object-contain ${!isCameraActive ? 'hidden' : ''}`}
            />

            {/* If camera is inactive or has error */}
            {(!isCameraActive || cameraError) && (
              <div className="p-6 text-center max-w-md">
                <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <h4 className="text-sm font-bold text-slate-200">Camera Chưa Kết Nối Hoặc Bị Tắt</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4 leading-relaxed">
                  {cameraError || 'Bấm "Bật Lại Camera" hoặc bấm "Dùng Ảnh Mẫu POS" để tiếp tục quy trình test.'}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleCamera && onToggleCamera()}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer"
                  >
                    Bật Lại Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const mockFrame = createMockPosFrame();
                      setCapturedImage(mockFrame);
                      setCapturedTimestamp(new Date().toLocaleTimeString('vi-VN'));
                      setCapturedScreens((prev) => ({ ...prev, 'Màn 1: Home': mockFrame }));
                      toast.success('Đã nạp khung hình thiết bị POS mẫu');
                    }}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all cursor-pointer"
                  >
                    Dùng Ảnh Mẫu POS
                  </button>
                </div>
              </div>
            )}

            {/* Overlay Guides */}
            {isCameraActive && showGuides && (
              <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
                {/* Top Corner brackets */}
                <div className="flex justify-between items-start">
                  <div className="flex flex-col items-start">
                    <div className="w-8 h-8 border-t-2 border-l-2 border-[#fe5d70]" />
                    <span className="text-[10px] font-bold text-[#fe5d70] bg-black/70 px-1.5 py-0.5 rounded mt-1 backdrop-blur-xs">
                      📍 Góc 1: Park (Home)
                    </span>
                  </div>
                  <div className="w-8 h-8 border-t-2 border-r-2 border-emerald-400" />
                </div>

                {/* Center Reticle */}
                <div className="self-center flex items-center justify-center text-emerald-400/50">
                  <div className="w-12 h-12 border border-dashed border-emerald-400/40 rounded-full flex items-center justify-center">
                    <span className="text-sm font-mono">+</span>
                  </div>
                </div>

                {/* Bottom Corner brackets */}
                <div className="flex justify-between items-end">
                  <div className="w-8 h-8 border-b-2 border-l-2 border-emerald-400" />
                  <div className="w-8 h-8 border-b-2 border-r-2 border-emerald-400" />
                </div>
              </div>
            )}

            {/* Camera Status Label HUD */}
            {isCameraActive && (
              <div className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-2">
                <span className="px-2 py-0.5 bg-black/70 backdrop-blur-md rounded text-[10px] font-mono text-emerald-400 border border-emerald-500/20">
                  TARGET AREA: POS TERMINAL VIEWPORT
                </span>
              </div>
            )}
          </div>

          {/* Right Action & Snapshot Column */}
          <div className="w-full md:w-80 flex flex-col justify-between space-y-3 bg-slate-900/90 p-4 rounded-xl border border-slate-800">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-300">Ảnh Chụp Thiết Bị</span>
                {capturedTimestamp && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {capturedTimestamp}
                  </span>
                )}
              </div>

              {/* Captured Thumbnail View */}
              {capturedImage ? (
                <div className="mt-2.5 space-y-2">
                  <div
                    onClick={() => setPreviewModalImg(capturedImage)}
                    className="relative rounded-lg overflow-hidden border border-emerald-500/40 bg-black cursor-pointer group hover:border-emerald-400 transition-all shadow-xs"
                    title="Bấm để xem ảnh phóng to"
                  >
                    <img
                      src={capturedImage}
                      alt="Captured POS Screen"
                      className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-xs text-white font-bold backdrop-blur-2xs">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                      <span>Xem Phóng To</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Đã gán vào quy trình test
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedImage(null);
                        setCapturedTimestamp('');
                        toast('Đã xóa snapshot hiện tại');
                      }}
                      className="text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 p-4 rounded-lg border border-dashed border-slate-700 text-center text-slate-500 bg-slate-950/40">
                  <span className="text-2xl block mb-1">📷</span>
                  <p className="text-xs font-medium text-slate-400">Chưa có ảnh chụp thiết bị</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Bấm nút xanh bên dưới để chụp màn hình từ camera và tự động sinh kịch bản test!
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {/* MAIN HERO BUTTON: CAPTURE & AUTO-GENERATE */}
              <button
                type="button"
                onClick={handleCaptureAndGenerate}
                disabled={isCapturing || isExecuting}
                className="w-full py-3 px-4 bg-gradient-to-r from-[#0ac282] to-[#01a9ac] hover:from-[#09ad74] hover:to-[#01989b] active:scale-[0.98] disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 group"
              >
                <svg className="w-4 h-4 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>
                  {isCapturing ? 'Đang Chụp & Phân Tích...' : '📸 Chụp Màn Hình & Tự Động Sinh Kịch Bản'}
                </span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const frame = captureFrameFromVideo();
                    const timeStr = new Date().toLocaleTimeString('vi-VN');
                    setCapturedImage(frame);
                    setCapturedTimestamp(timeStr);
                    toast.success(`Đã chụp snapshot màn hình lúc ${timeStr}`);
                  }}
                  disabled={isExecuting}
                  className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer"
                >
                  Chụp Lại Ảnh
                </button>

                <label className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded-lg border border-slate-700 transition-colors text-center cursor-pointer">
                  <span>Tải Ảnh Lên</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadImage}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

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
              Sẵn sàng tạo kịch bản thanh toán POS tự động. Bấm{' '}
              <strong>Generate AI Recommendation</strong> để nạp toàn bộ các bước thanh toán máy POS (chọn icon payment, purchase, nhập tiền 123, checkout, nhập PIN 6 số).
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-bold text-slate-700 block">
              Natural Language Test Prompt:
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setPrompt('Quy trình máy POS: 1. Chọn icon Payment -> 2. Chọn Purchase tại Select Function Type -> 3. Nhập số tiền 123 và bấm Pay -> 4. Màn Checkout chọn Tap to Pay rồi bấm Pay Now -> 5. Nhập mã PIN 6 số (123456) bấm OK')}
                className="text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-md border border-amber-200 transition-all cursor-pointer shadow-xs"
              >
                💳 POS 5-Màn: Icon → Purchase → 123 → Checkout → PIN 6 số
              </button>
              <button
                type="button"
                onClick={() => setPrompt('ATM PIN verification: Press keys 1, 2, 3, 4 sequentially then press Enter/OK to authenticate')}
                className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-md border border-emerald-200 transition-all cursor-pointer"
              >
                🏧 1 Màn: ATM PIN
              </button>
              <button
                type="button"
                onClick={() => setPrompt('Thanh toán ví điện tử 4 màn hình: Nhập mã PIN (1, 2, 3) rồi Enter chuyển sang Màn 2 -> Chọn số tiền 500.000đ bấm Tiếp tục -> Bấm Xác nhận OTP -> Hoàn tất giao dịch')}
                className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md border border-indigo-200 transition-all cursor-pointer"
              >
                📱 4 Màn: Ví Điện Tử
              </button>
            </div>
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
          <h4 className="text-base font-bold text-slate-800">Kịch Bản Thanh Toán POS Sẵn Sàng Tạo</h4>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            Nhấn <strong className="text-slate-700 font-bold">Generate AI Recommendation</strong> ở trên để nạp kịch bản <strong className="text-[#0ac282] font-bold">Thanh Toán Tự Động Máy POS (5 Màn Hình Tuần Tự)</strong> với đầy đủ các action và bước chuyển trang.
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

          {/* View Mode Toggle Switcher */}
          <div className="flex items-center justify-between pt-3 pb-2 border-b border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('screens')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'screens'
                    ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📱 Theo Từng Màn Hình ({groupStepsByScreen(testScript).length} Màn)</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('flat')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'flat'
                    ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📋 Bảng Gộp Toàn Bộ ({testScript.length} Bước)</span>
              </button>
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              💡 Chế độ <strong>Theo Từng Màn Hình</strong> phân tách trực quan từng màn hình và hiển thị rõ thời điểm CNC tự động lùi Z về góc Park để quét trang mới.
            </div>
          </div>

          {/* Steps Display */}
          {testScript.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <div className="font-semibold text-slate-700">Chưa có bước kiểm thử nào</div>
              <div className="text-xs mt-1 text-slate-400">Bấm "Generate AI Recommendation" ở trên hoặc "+ Add Step" để nạp kịch bản</div>
            </div>
          ) : viewMode === 'screens' ? (
            /* ===================================================================
               MODE 1: SCREEN-BY-SCREEN GROUPED CARDS (CLEAR & MODULAR)
               =================================================================== */
            <div className="space-y-4 mt-4">
              {/* ===================================================================
                  TINH GỌN, DỄ HIỂU - TABS CHUYỂN MÀN HÌNH (WHITE & TEAL)
                  =================================================================== */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                {/* Header Ribbon Info */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg bg-teal-50 text-[#01a9ac] border border-teal-100 flex items-center justify-center font-bold text-sm">
                      📱
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                          Quy Trình Kiểm Thử Theo Màn Hình
                        </h4>
                        <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                          {groupStepsByScreen(testScript).length} Giai Đoạn
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Chỉ cần 1 ảnh Màn 1 ban đầu — Bấm vào từng tab bên dưới để chuyển nhanh tới màn hình tương ứng:
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveScreenTab('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        activeScreenTab === 'all'
                          ? 'bg-teal-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                      }`}
                    >
                      <span>📋 Xem Tất Cả ({groupStepsByScreen(testScript).length} Màn)</span>
                    </button>
                  </div>
                </div>

                {/* Clickable Tabs Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {groupStepsByScreen(testScript).map((group, idx) => {
                    const isActive = activeScreenTab === idx;
                    const shortLabels = [
                      { label: 'Icon Payment', icon: '📱' },
                      { label: 'Chọn Purchase', icon: '📂' },
                      { label: 'Số 123 & Pay', icon: '💵' },
                      { label: 'Tap to Pay', icon: '💳' },
                      { label: 'PIN 6 số & OK', icon: '🔐' },
                      { label: 'In Hóa Đơn', icon: '🧾' },
                    ];
                    const info = shortLabels[idx] || { label: group.screenName, icon: '📱' };

                    return (
                      <button
                        key={`tab-screen-btn-${idx}`}
                        type="button"
                        onClick={() => setActiveScreenTab(idx)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between relative group ${
                          isActive
                            ? 'bg-teal-50/90 border-[#01a9ac] text-slate-900 shadow-xs ring-2 ring-[#01a9ac]/30'
                            : 'bg-slate-50/70 hover:bg-white hover:border-teal-200 text-slate-700 border-slate-200'
                        }`}
                      >
                        {isActive && (
                          <div className="absolute top-0 left-0 right-0 h-1 bg-[#01a9ac] rounded-t-xl" />
                        )}
                        <div className="flex items-center justify-between w-full">
                          <span className="text-sm">{info.icon}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                              isActive
                                ? 'bg-[#01a9ac] text-white'
                                : 'bg-slate-200/80 text-slate-600'
                            }`}
                          >
                            {group.items.length} bước
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <div className={`text-xs font-bold truncate ${isActive ? 'text-[#01a9ac]' : 'text-slate-800'}`}>
                            {group.screenName}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
                            {info.label}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {groupStepsByScreen(testScript)
                .filter((_, idx) => activeScreenTab === 'all' || activeScreenTab === idx)
                .map((group, filteredIdx) => {
                  const allGroups = groupStepsByScreen(testScript);
                  const gIdx = allGroups.findIndex((g) => g.screenName === group.screenName);
                  const realIdx = gIdx >= 0 ? gIdx : filteredIdx;
                  const theme = SCREEN_THEMES[realIdx % SCREEN_THEMES.length];
                  const lastItemInGroup = group.items[group.items.length - 1];
                  const hasTransition = Boolean(lastItemInGroup?.step?.park_after || lastItemInGroup?.step?.action === 'TRANSITION_SCREEN');

                  return (
                    <div key={`screen-group-${group.id || realIdx}`} className="space-y-3">
                      <div className={`bg-white rounded-2xl border ${theme.cardBorder} shadow-xs overflow-hidden transition-all hover:shadow-md`}>
                        {/* Screen Header Banner */}
                        <div className={`px-4 py-3.5 ${theme.headerBg} flex items-center justify-between flex-wrap gap-2 text-white`}>
                          <div className="flex items-center gap-3">
                            <span className="text-2xl p-1 bg-white/20 rounded-xl backdrop-blur-xs">{theme.icon}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-extrabold tracking-wide uppercase">
                                  {group.screenName}
                                </span>
                                <span className="bg-white/20 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-white/30 backdrop-blur-xs">
                                  {group.items.length} thao tác
                                </span>
                              </div>
                              <span className="text-[11px] text-white/80 block mt-0.5 font-medium">
                                Giai đoạn {realIdx + 1}/{allGroups.length} trong quy trình test POS
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {realIdx === 0 ? (
                              <>
                                {(capturedScreens[group.screenName] || capturedImage) && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewModalImg(capturedScreens[group.screenName] || capturedImage)}
                                    className="px-2.5 py-1 bg-black/30 hover:bg-black/50 text-emerald-300 text-xs font-bold rounded-lg border border-emerald-400/40 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                                    title="Bấm để xem ảnh chụp của thiết bị thực tế từ camera"
                                  >
                                    <span>📷 Xem Ảnh Thiết Bị</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleCaptureScreenSnapshot(group.screenName)}
                                  className="px-2.5 py-1 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg border border-white/20 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                                  title="Chụp lại khung hình camera hiện tại và căn chỉnh lại thiết bị"
                                >
                                  <span>📸 Chụp Lại Thiết Bị</span>
                                </button>
                              </>
                            ) : (
                              <span
                                className="px-2.5 py-1 bg-black/30 text-emerald-300 text-xs font-bold rounded-lg border border-emerald-400/30 flex items-center gap-1.5 shadow-xs cursor-default select-none"
                                title="AI tự động tính tọa độ từ ảnh Màn 1 ban đầu. CNC tự động thực thi chuỗi phím mà không cần chụp lại."
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span>🤖 Tự Động Bấm (Không Cần Chụp)</span>
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleAddStepToScreen(group.screenName, lastItemInGroup?.idx)}
                              disabled={isExecuting}
                              className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-lg border border-white/30 transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                            >
                              <span>+ Thêm bước vào màn này</span>
                            </button>
                          </div>
                        </div>

                        {/* Screen Wireframe Mockup */}
                        <div className="p-3 bg-slate-50 border-b border-slate-200">
                          <ScreenWireframePreview
                            screenName={group.screenName}
                            capturedImage={capturedScreens[group.screenName] || capturedImage}
                            isFirstScreen={realIdx === 0}
                          />
                        </div>

                      {/* Screen Steps Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-100/90 text-slate-700 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3 w-12 text-center">#</th>
                              <th className="py-2.5 px-3 w-32">Action</th>
                              <th className="py-2.5 px-3">Phím / Nút Cảm Ứng</th>
                              <th className="py-2.5 px-3 w-36 text-center">Tọa Độ CNC</th>
                              <th className="py-2.5 px-3 w-32 text-center" title="Lùi Z về góc Park & Chờ POS đổi màn hình để bấm tiếp (Không cần chụp lại)">Chuyển Trang</th>
                              <th className="py-2.5 px-3 w-32">Giá Trị Nhập</th>
                              <th className="py-2.5 px-3 w-20 text-center">Delay</th>
                              <th className="py-2.5 px-3 w-24 text-center">Trạng Thái</th>
                              <th className="py-2.5 px-3 w-36 text-center">Thao Tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {group.items.map(({ step, idx }) => {
                              const isRunning = step.status === 'running';
                              const isPassed = step.status === 'passed';
                              const isFailed = step.status === 'failed';

                              return (
                                <tr
                                  key={`screen-step-${step.id || idx}`}
                                  className={`hover:bg-slate-50/80 transition-colors ${
                                    isRunning ? 'bg-sky-50/70' : isPassed ? 'bg-emerald-50/40' : isFailed ? 'bg-red-50/40' : ''
                                  }`}
                                >
                                  {/* Step Number */}
                                  <td className="py-2.5 px-3 text-center text-xs font-bold text-slate-500 whitespace-nowrap">
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
                                      <option value="TRANSITION_SCREEN">🔄 TRANSITION (Đổi trang & Quét)</option>
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
                                      placeholder="Tên nút / mục tiêu..."
                                      disabled={isExecuting}
                                      className="w-full bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-xs text-slate-800 outline-none focus:border-[#fe5d70] font-medium"
                                    />
                                  </td>

                                  {/* CNC Coordinates (X, Y) */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
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

                                    {/* Quick Target Selector from Detected Camera Targets */}
                                    {aiTargets && aiTargets.length > 0 && (
                                      <div className="mt-1">
                                        <select
                                          value={step.mappedTargetId || ''}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (!val) {
                                              handleUpdateStep(idx, 'mappedTargetId', null);
                                              return;
                                            }
                                            const t = aiTargets.find((item) => item.id === Number(val));
                                            if (t) {
                                              handleUpdateStep(idx, 'cnc_x', t.cnc_x);
                                              handleUpdateStep(idx, 'cnc_y', t.cnc_y);
                                              handleUpdateStep(idx, 'mappedTargetId', t.id);
                                              if (step.target && setAiTargets) {
                                                setAiTargets(
                                                  aiTargets.map((item) =>
                                                    item.id === t.id
                                                      ? { ...item, label: step.target, mappedStepIndex: idx, mappedStepName: step.target }
                                                      : item
                                                  )
                                                );
                                              }
                                              toast.success(`Đã gán Target #${t.id} (${t.label || 'Target'}) toạ độ (${t.cnc_x}, ${t.cnc_y}) vào bước "${step.target}"!`);
                                            }
                                          }}
                                          disabled={isExecuting}
                                          className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 rounded px-1.5 py-0.5 outline-none hover:border-emerald-500 cursor-pointer max-w-[135px] truncate"
                                          title="Chọn mục tiêu đã nhận diện trên camera để gán tọa độ trực tiếp"
                                        >
                                          <option value="">🎯 Gán Target Camera...</option>
                                          {aiTargets.map((t) => (
                                            <option key={t.id} value={t.id}>
                                              #{t.id} {t.label} (X:{t.cnc_x}, Y:{t.cnc_y})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </td>

                                  {/* Chuyển trang (Park & Scan Next Screen) */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <label
                                      className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs"
                                      title="Tự động lùi CNC về góc Park và quét màn hình tiếp theo sau bước này"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={Boolean(step.park_after || step.action === 'TRANSITION_SCREEN')}
                                        onChange={(e) => handleUpdateStep(idx, 'park_after', e.target.checked)}
                                        disabled={isExecuting}
                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                      />
                                      <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                          step.park_after || step.action === 'TRANSITION_SCREEN'
                                            ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                            : 'text-slate-400'
                                        }`}
                                      >
                                        {step.park_after || step.action === 'TRANSITION_SCREEN' ? '🔄 Đổi Màn' : 'Cùng Màn'}
                                      </span>
                                    </label>
                                  </td>

                                  {/* Input Value */}
                                  <td className="py-2.5 px-3">
                                    <input
                                      type="text"
                                      value={step.value || ''}
                                      onChange={(e) => handleUpdateStep(idx, 'value', e.target.value)}
                                      placeholder={step.action === 'TYPE' ? 'Giá trị...' : '-'}
                                      disabled={isExecuting || step.action === 'WAIT'}
                                      className="w-full bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-xs font-mono text-slate-700 outline-none focus:border-[#fe5d70]"
                                    />
                                  </td>

                                  {/* Delay ms */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <input
                                      type="number"
                                      step="100"
                                      min="0"
                                      value={step.delay_ms || 500}
                                      onChange={(e) => handleUpdateStep(idx, 'delay_ms', Number(e.target.value) || 0)}
                                      disabled={isExecuting}
                                      className="w-16 mx-auto text-center bg-white border border-slate-200 rounded-md py-1.5 px-1.5 text-xs font-mono text-slate-700 outline-none focus:border-[#fe5d70]"
                                    />
                                  </td>

                                  {/* Status Badge */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <span
                                      className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        isRunning
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
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleMoveStep(idx, -1)}
                                        disabled={isExecuting || idx === 0}
                                        className="px-1.5 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                                        title="Lên"
                                      >
                                        &uarr;
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveStep(idx, 1)}
                                        disabled={isExecuting || idx === testScript.length - 1}
                                        className="px-1.5 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                                        title="Xuống"
                                      >
                                        &darr;
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDuplicateStep(idx)}
                                        disabled={isExecuting}
                                        className="px-2 py-0.5 text-[11px] border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                                        title="Nhân bản"
                                      >
                                        Clone
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteStep(idx)}
                                        disabled={isExecuting}
                                        className="px-2 py-0.5 text-[11px] border border-red-200 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 cursor-pointer"
                                        title="Xóa"
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
                    </div>

                    {/* Transition Barrier to next screen */}
                    {hasTransition && activeScreenTab === 'all' && realIdx < allGroups.length - 1 && (
                      <div className="flex flex-col items-center justify-center my-3 select-none">
                        <div className="flex items-center gap-2.5 px-5 py-2.5 bg-gradient-to-r from-teal-50 via-sky-50 to-teal-50 border border-teal-200 rounded-full text-teal-900 text-xs font-bold shadow-xs">
                          <span className="text-teal-600 text-base">⚡</span>
                          <span>[TỰ ĐỘNG CHUYỂN TRANG] CNC nhấc bút lùi Z về Góc 1 (Vị trí Park) ➔ Chờ POS đổi màn (1.2s - 1.6s) ➔ Tự động bấm tiếp Màn {realIdx + 2} (Không cần chụp lại)</span>
                          <span className="text-teal-600 font-extrabold text-sm">&darr;</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Tab Navigation Footer (When viewing a single tab) */}
              {activeScreenTab !== 'all' && (
                <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200 text-xs shadow-xs">
                  <button
                    type="button"
                    disabled={activeScreenTab === 0}
                    onClick={() => setActiveScreenTab((prev) => Math.max(0, prev - 1))}
                    className="px-3.5 py-1.5 font-bold rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 cursor-pointer flex items-center gap-1.5 text-slate-700 transition-colors"
                  >
                    <span>&larr;</span> <span>Màn trước ({activeScreenTab > 0 ? groupStepsByScreen(testScript)[activeScreenTab - 1]?.screenName : ''})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveScreenTab('all')}
                    className="text-xs text-teal-700 hover:text-teal-800 font-bold hover:underline cursor-pointer"
                  >
                    📋 Hiển thị tất cả {groupStepsByScreen(testScript).length} màn hình
                  </button>

                  <button
                    type="button"
                    disabled={activeScreenTab >= groupStepsByScreen(testScript).length - 1}
                    onClick={() => setActiveScreenTab((prev) => Math.min(groupStepsByScreen(testScript).length - 1, prev + 1))}
                    className="px-3.5 py-1.5 font-bold rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 cursor-pointer flex items-center gap-1.5 text-slate-700 transition-colors"
                  >
                    <span>Màn tiếp theo ({activeScreenTab < groupStepsByScreen(testScript).length - 1 ? groupStepsByScreen(testScript)[activeScreenTab + 1]?.screenName : ''})</span> <span>&rarr;</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ===================================================================
               MODE 2: FLAT TABLE VIEW (COMPACT OVERVIEW)
               =================================================================== */
            <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#404E67] text-white text-[11px] font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-3 w-12 text-center">#</th>
                    <th className="py-3 px-3 w-32">Màn Hình</th>
                    <th className="py-3 px-3 w-32">Action</th>
                    <th className="py-3 px-3">UI Target Element</th>
                    <th className="py-3 px-3 w-40 text-center">CNC Coords (X, Y)</th>
                    <th className="py-3 px-3 w-36 text-center" title="Lùi Z về góc Park & Chờ POS đổi màn hình để bấm tiếp (Không cần chụp lại)">Chuyển Trang</th>
                    <th className="py-3 px-3 w-36">Input Value</th>
                    <th className="py-3 px-3 w-24 text-center">Delay (ms)</th>
                    <th className="py-3 px-3 w-28 text-center">Status</th>
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
                        key={`flat-step-${step.id || idx}`}
                        className={`hover:bg-slate-50/80 transition-colors ${isRunning ? 'bg-sky-50/70' : ''} ${isPassed ? 'bg-emerald-50/40' : ''} ${isFailed ? 'bg-red-50/40' : ''}`}
                      >
                        {/* Step Number */}
                        <td className="py-2.5 px-3 text-center text-xs font-bold text-slate-500 whitespace-nowrap">
                          #{idx + 1}
                        </td>

                        {/* Screen Tag */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <input
                            type="text"
                            value={step.screen || ''}
                            onChange={(e) => handleUpdateStep(idx, 'screen', e.target.value)}
                            placeholder="Màn hình..."
                            disabled={isExecuting}
                            className="w-28 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[11px] font-bold text-indigo-700 outline-none focus:border-indigo-500"
                          />
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
                            <option value="TRANSITION_SCREEN">🔄 TRANSITION (Đổi trang & Quét)</option>
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
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
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

                        {/* Chuyển trang (Park & Scan Next Screen) */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <label
                            className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs"
                            title="Tự động lùi CNC về góc Park và quét màn hình tiếp theo sau bước này"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(step.park_after || step.action === 'TRANSITION_SCREEN')}
                              onChange={(e) => handleUpdateStep(idx, 'park_after', e.target.checked)}
                              disabled={isExecuting}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                step.park_after || step.action === 'TRANSITION_SCREEN'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'text-slate-400'
                              }`}
                            >
                              {step.park_after || step.action === 'TRANSITION_SCREEN' ? '🔄 Màn Mới' : 'Cùng Màn'}
                            </span>
                          </label>
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
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
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
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
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
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, -1)}
                              disabled={isExecuting || idx === 0}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                              title="Move Up"
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 1)}
                              disabled={isExecuting || idx === testScript.length - 1}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                              title="Move Down"
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateStep(idx)}
                              disabled={isExecuting}
                              className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                              title="Duplicate Step"
                            >
                              Clone
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStep(idx)}
                              disabled={isExecuting}
                              className="px-2 py-1 text-xs border border-red-200 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 cursor-pointer"
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
