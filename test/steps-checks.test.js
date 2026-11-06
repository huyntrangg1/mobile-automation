// k.selected (Verify selected) và k.check (điểm kiểm cho keyword k chưa có) — code AI không phải gọi snapshot / sa.eq trực tiếp
import test from 'node:test';
import assert from 'node:assert/strict';

const { createSteps } = await import('../server/apps/template/src/runner/steps.js');

function setup(attrs = {}) {
  globalThis.driver = { isAndroid: false, waitUntil: async () => true, execute: async () => [] };
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (!(sel in attrs)) throw new Error('x'); },
    getAttribute: async (k) => attrs[sel]?.[k] ?? null,
  });
  const eqs = [];
  const shots = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep() {}, snapshot: async (...a) => { shots.push(a); return { k: 'ev' }; }, env: {} });
  return { k, eqs, shots };
}

test('k.selected: đọc trạng thái chọn của phần tử, ghi điểm kiểm đúng chữ ký (step, label, actual, expected, ev, info)', async () => {
  const { k, eqs, shots } = setup({ '~Save': { selected: 'true' }, '~Eat': { value: '1' }, '~Cook': { selected: 'false' } });
  await k.selected(1, 'Goals', 'Save on groceries', 'Save được chọn', '~Save');
  await k.selected(1, 'Goals', 'Eat healthier', 'Eat được chọn', '~Eat');
  await k.selected(2, 'Goals', 'Cook faster', 'Cook không được chọn', '~Cook', false);
  assert.deepEqual(eqs.map((e) => e.slice(0, 5)), [[1, 'Save được chọn', true, true, 'ev'], [1, 'Eat được chọn', true, true, 'ev'], [2, 'Cook không được chọn', false, false, 'ev']]);
  assert.deepEqual(eqs[0][5], { keyword: 'Verify selected', target: 'Save on groceries', value: '', screen: 'Goals' });
  assert.deepEqual(shots[0], ['Goals', { k: '~Save' }, {}]);
});

test('k.selected: không thấy phần tử → actual null (report ghi "không thấy")', async () => {
  const { k, eqs } = setup({});
  await k.selected(1, 'Goals', 'Save on groceries', 'Save được chọn', '~Save');
  assert.equal(eqs[0][2], null);
});

test('k.check: điểm kiểm cho keyword k chưa có — giá trị tự đọc, k lo evidence + sa.eq', async () => {
  const { k, eqs, shots } = setup({});
  await k.check(4, 'Profile', 'Verify value', 'Weight', 'Cân nặng 70 kg', '~weight', '70 kg', '70 kg');
  assert.deepEqual(eqs[0], [4, 'Cân nặng 70 kg', '70 kg', '70 kg', 'ev', { keyword: 'Verify value', target: 'Weight', value: '70 kg', screen: 'Profile' }]);
  assert.deepEqual(shots[0], ['Profile', { k: '~weight' }, {}]);
});

test('k.selected: iOS báo chọn qua traits "Selected" (không có selected="true") vẫn nhận ra', async () => {
  const { k, eqs } = setup({ '~Save': { traits: 'Button, Selected' } });
  await k.selected(1, 'Goals', 'Save on groceries', 'Save được chọn', '~Save');
  assert.equal(eqs[0][2], true);
});

// Thanh địa chỉ giả: lần đọc lần lượt trả các giá trị (đang tải → tên miền)
function urlSetup(values) {
  const r = setup({});
  let i = 0;
  globalThis.$ = () => ({ waitForExist: async () => {}, getAttribute: async (a) => (a === 'value' ? values[Math.min(i++, values.length - 1)] : null) });
  globalThis.driver = { isAndroid: false, execute: async () => [], waitUntil: async (fn, { timeout }) => { for (let t = 0; t < timeout; t += 700) if (await fn()) return true; throw new Error('timeout'); } };
  return r;
}

test('k.url: chờ qua lúc đang tải (chỉ ký tự vô hình), so tên miền khi trình duyệt chỉ hiện tên miền', async () => {
  const { k, eqs } = urlSetup(['‎', '‎', '‎begamob.com', '‎begamob.com']);
  await k.url(1, 'Trang ngoài', 'Terms of Service', 'URL trang Terms', 'https://begamob.com/ofs-termofuse.html');
  assert.deepEqual(eqs[0].slice(0, 4), [1, 'URL trang Terms (trình duyệt trong app chỉ hiện tên miền — so tên miền)', 'https://begamob.com/ofs-termofuse.html', 'https://begamob.com/ofs-termofuse.html']);
  assert.equal(eqs[0][5].keyword, 'Verify external URL');
});

test('k.url: sai tên miền → actual là địa chỉ đang hiện; không đọc được → ghi rõ', async () => {
  const a = urlSetup(['google.com']);
  await a.k.url(1, 'Trang ngoài', 'Privacy', 'URL Privacy', 'https://begamob.com/p.html');
  assert.equal(a.eqs[0][2], 'google.com');
  const b = urlSetup(['‎']);
  await b.k.url(1, 'Trang ngoài', 'Privacy', 'URL Privacy', 'https://begamob.com/p.html', { timeout: 1500 });
  assert.equal(b.eqs[0][2], '(không đọc được thanh địa chỉ)');
});

test('k.url: đọc URL đầy đủ của tab Safari đang hiển thị (bỏ tab cũ đang ẩn), quay lại NATIVE_APP', async () => {
  const { k, eqs } = setup({});
  const tabs = { 'WEBVIEW_1.1': ['https://begamob.com/bega-policy.html', 'hidden'], 'WEBVIEW_1.2': ['https://begamob.com/ofs-termofuse.html', 'visible'] };
  let ctx = 'NATIVE_APP';
  const switched = [];
  globalThis.driver = {
    isAndroid: false,
    getContext: async () => ctx,
    switchContext: async (id) => { ctx = id; switched.push(id); },
    execute: async (cmd) => (cmd === 'mobile: getContexts'
      ? [{ id: 'NATIVE_APP' }, ...Object.keys(tabs).map((id) => ({ id, url: tabs[id][0], bundleId: 'com.apple.mobilesafari' }))]
      : tabs[ctx]),
    waitUntil: async (fn, { timeout }) => { for (let t = 0; t < timeout; t += 700) if (await fn()) return true; throw new Error('timeout'); },
  };
  await k.url(1, 'Trang ngoài', 'Terms of Service', 'URL trang Terms', 'https://begamob.com/ofs-termofuse.html');
  assert.deepEqual(eqs[0].slice(1, 4), ['URL trang Terms', 'https://begamob.com/ofs-termofuse.html', 'https://begamob.com/ofs-termofuse.html']);
  assert.equal(ctx, 'NATIVE_APP');
  assert.ok(switched.includes('WEBVIEW_1.2'));
});

function browserSetup({ state, doneExists = false }) {
  const r = setup({});
  const calls = [];
  globalThis.driver = {
    isAndroid: false,
    execute: async (cmd, arg) => { calls.push([cmd, arg]); return cmd === 'mobile: queryAppState' ? state : null; },
    back: async () => calls.push(['back']),
  };
  globalThis.$ = () => ({ waitForExist: async () => { if (!doneExists) throw new Error('x'); }, click: async () => calls.push(['tap Done']), waitForDisplayed: async () => {} });
  return { ...r, calls };
}

test('k.closeBrowser: Safari ngoài app (app không ở trước) → đưa app về trước', async () => {
  const { calls } = browserSetup({ state: 3 });
  const k = (await import('../server/apps/template/src/runner/steps.js')).createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: { BUNDLE_ID: 'com.x' } });
  await k.closeBrowser(2, 'Trang ngoài');
  assert.deepEqual(calls.map((c) => c[0]), ['mobile: queryAppState', 'mobile: activateApp']);
  assert.deepEqual(calls[1][1], { bundleId: 'com.x' });
});

test('k.closeBrowser: trình duyệt trong app → bấm Done; không có Done → lỗi rõ (Blocked)', async () => {
  const a = browserSetup({ state: 4, doneExists: true });
  const k = (await import('../server/apps/template/src/runner/steps.js')).createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: { BUNDLE_ID: 'com.x' } });
  await k.closeBrowser(2, 'Trang ngoài');
  assert.ok(a.calls.some((c) => c[0] === 'tap Done'));
  browserSetup({ state: 4, doneExists: false });
  await assert.rejects(k.closeBrowser(2, 'Trang ngoài'), /Không tới được màn Trang ngoài/);
});

test('k.url compare contains: trình duyệt chỉ hiện tên miền → so tên miền (không lệch giả); sai tên miền vẫn lệch', async () => {
  const a = urlSetup(['‎begamob.com', '‎begamob.com']);
  await a.k.url(1, 'Trang ngoài', 'Terms of Service', 'URL trang Terms', 'https://begamob.com/ofs-termofuse.html', { compare: 'contains' });
  assert.deepEqual(a.eqs[0].slice(1, 4), ['URL trang Terms (trình duyệt trong app chỉ hiện tên miền — so tên miền)', 'contains "https://begamob.com/ofs-termofuse.html"', 'contains "https://begamob.com/ofs-termofuse.html"']);
  const b = urlSetup(['google.com', 'google.com']);
  await b.k.url(1, 'Trang ngoài', 'Terms of Service', 'URL trang Terms', 'https://begamob.com/ofs-termofuse.html', { compare: 'contains' });
  assert.equal(b.eqs[0][2], 'google.com');
});
