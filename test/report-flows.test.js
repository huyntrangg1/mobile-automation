// Report (skill test-report, bản vendor — sửa ở skill gốc rồi npm run sync-report): bug "chặn luồng nhưng đã cho chạy tiếp" (chế độ sửa tay khi lỗi)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEST_REPORT_VENDOR } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const src = (f) => pathToFileURL(path.join(TEST_REPORT_VENDOR, 'assets/src/report', f)).href;
const collector = await import(src('collector.js'));
const { writeResult } = await import(src('hooks.js'));
const { buildModel } = await import(src('html.js'));

const NAV = 'Không tới được màn Awesome: không thấy nút "Show me how" sau 15s';
const SEEN = { title: 'Good news 🎉', text: null, buttons: ['Continue'] };

// Case chạy hết nhờ Skip / Use element: 1 flow bug, mocha báo passed
function runCase({ checkBug = false } = {}) {
  const reports = tmpDir();
  collector.resetCurrent();
  collector.setCase({ id: 'TC_ONB_001', title: 'Onboarding', priority: 'High', feature: 'onboarding', steps: [], expected: [], precondition: [] });
  collector.logStep({ kind: 'Action', step: 5, screen: 'Recipe source', keyword: 'Tap', target: 'Social media', value: '', ok: true });
  if (checkBug) collector.addBug({ step: 5, label: 'Title màn nguồn', actual: 'A', expected: 'B', keyword: 'Verify text', target: 'Title', value: 'B', screen: 'Recipe source' });
  collector.logStep({ kind: 'Action', step: 6, screen: 'Recipe source', keyword: 'Tap', target: 'Continue', value: '', ok: true });
  collector.addFlowBug({ step: 6, screen: 'Recipe source', target: '(screen)', error: NAV, seen: SEEN });
  collector.logStep({ kind: 'Action', step: 6, screen: 'Awesome', keyword: 'Tap', target: 'Show me how', value: '', ok: true });
  writeResult(reports, { parent: 'onboarding', title: 'TC_ONB_001 Onboarding' }, { passed: !checkBug, error: checkBug ? { name: 'AssertionError', message: 'x' } : null, duration: 1 }, null);
  const dir = path.join(reports, 'results');
  return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
}

test('writeResult: flow bug đã cho chạy tiếp → status failed, passed false, flows có 1 dòng', () => {
  const r = runCase();
  assert.equal(r.status, 'failed');
  assert.equal(r.passed, false);
  assert.equal(r.flows.length, 1);
  assert.equal(r.flows[0].at, 2);
  assert.deepEqual(r.flows[0].seen, SEEN);
});

test('buildModel: flow bug → bug theo màn đang đứng, Steps tới thao tác trước lỗi', () => {
  const r = runCase();
  const { bugs } = buildModel({ results: [{ ...r, failShot: null }], env: {} });
  assert.equal(bugs.length, 1);
  assert.equal(bugs[0].title, '[BUG][Recipe source] Nhấn "Continue" hiển thị màn "Good news 🎉" thay vì màn Awesome');
  assert.deepEqual(bugs[0].stepsClean.slice(-2), ['Nhấn "Social media"', 'Nhấn "Continue"']);
});

test('buildModel: vừa điểm kiểm lệch vừa flow bug → 2 bug', () => {
  const r = runCase({ checkBug: true });
  const { bugs } = buildModel({ results: [{ ...r, failShot: null }], env: {} });
  assert.equal(bugs.length, 2);
});

test('writeResult: afterTest không đọc được màn (seen null) → dùng màn k ghi lúc lỗi (noteScreen)', () => {
  const reports = tmpDir();
  collector.resetCurrent();
  collector.setCase({ id: 'TC_2', title: 'x', steps: [], expected: [], precondition: [] });
  collector.noteScreen({ seen: SEEN, shot: null });
  writeResult(reports, { parent: 's', title: 'TC_2 x' }, { passed: false, error: new Error(NAV), duration: 1 }, null, null);
  const dir = path.join(reports, 'results');
  const j = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  assert.deepEqual(j.seen, SEEN);
});

test('flow bug của bước nav: màn trong title = màn đang đứng khi thao tác (không phải màn không tới được)', () => {
  const reports = tmpDir();
  collector.resetCurrent();
  collector.setCase({ id: 'TC_3', title: 'x', steps: [], expected: [], precondition: [] });
  collector.logStep({ kind: 'Action', step: 6, screen: 'Recipe source', keyword: 'Tap', target: 'Continue', value: '', ok: true });
  collector.addFlowBug({ step: 6, screen: 'Awesome', target: '(screen)', error: NAV, seen: SEEN });
  writeResult(reports, { parent: 's', title: 'TC_3 x' }, { passed: true, error: null, duration: 1 }, null);
  const dir = path.join(reports, 'results');
  const r = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  assert.match(buildModel({ results: [{ ...r, failShot: null }], env: {} }).bugs[0].title, /^\[BUG\]\[Recipe source\] /);
});

test('blocked vì không thấy phần tử để bấm (log không ghi bước lỗi): màn = màn của thao tác cuối, không phải màn đầu case', () => {
  const r = {
    suite: 's', title: 'TC_4 x', passed: false, status: 'blocked', blockKind: 'defect', error: 'element ("-ios predicate string:name == \\"Close\\" OR label == \\"Close\\"") still not existing after 15000ms',
    case: { id: 'TC_4', title: 'x', steps: [], expected: [], precondition: [] }, bugs: [], flows: [], failShot: null, seen: null,
    steps: [
      { kind: 'Action', step: 1, screen: 'Welcome', keyword: 'Tap', target: 'Get started', value: '', ok: true },
      { kind: 'Action', step: 10, screen: 'Paywall', keyword: 'Tap', target: 'Start my free week', value: '', ok: true },
    ],
  };
  assert.match(buildModel({ results: [r], env: {} }).bugs[0].title, /^\[BUG\]\[Paywall\] Không thấy "Close"/);
});

test('câu lỗi "Không thấy "X" trên màn S" của k → bug đặt ở màn S', () => {
  const r = {
    suite: 's', title: 'TC_5 x', passed: false, status: 'blocked', blockKind: 'defect', error: 'Không thấy "Close" trên màn Paywall\nelement still not existing after 15000ms',
    case: { id: 'TC_5', title: 'x', steps: [], expected: [], precondition: [] }, bugs: [], flows: [], failShot: null, seen: null,
    steps: [{ kind: 'Action', step: 10, screen: 'Free vs Plus', keyword: 'Tap', target: 'Start my free week', value: '', ok: true }],
  };
  const b = buildModel({ results: [r], env: {} }).bugs[0];
  assert.equal(b.title, '[BUG][Paywall] Không thấy "Close"');
});

test('alert hệ thống không hiện / không có nút cần → câu chữ về hộp thoại, không phải "không chuyển màn"', async () => {
  const { flowText } = await import(src('phrasing.js'));
  const last = { keyword: 'Tap', target: 'Get started' };
  const a = flowText('Không tới được màn Tracking: không thấy hộp thoại hệ thống "Từ chối" sau 15s', { last });
  assert.equal(a.short, 'Nhấn "Get started" không hiện hộp thoại hệ thống');
  assert.equal(a.actual, 'Sau khi nhấn "Get started", không có hộp thoại hệ thống nào hiện ra.');
  assert.equal(a.expected, 'Hiện hộp thoại hệ thống có nút "Từ chối" (theo test case).');
  const b = flowText('Hộp thoại hệ thống không có nút "Từ chối" — đang hiện: "Allow Once", "OK"', { last });
  assert.equal(b.short, 'Hộp thoại hệ thống không có nút "Từ chối"');
  assert.equal(b.actual, 'Sau khi nhấn "Get started", hộp thoại hệ thống hiện nút "Allow Once", "OK".');
  assert.equal(b.expected, 'Hộp thoại hệ thống có nút "Từ chối" (theo test case).');
});

test('nhấn Back mà không lùi về màn trước → "không lùi về màn …" (không phải "hiển thị màn … thay vì …")', async () => {
  const { flowText } = await import(src('phrasing.js'));
  const err = 'Không tới được màn Welcome: không thấy nút "Get Started" sau 15s';
  const seen = { title: 'What brings you to Tastory?', text: null, buttons: ['Continue'] };
  for (const last of [{ keyword: 'Tap', target: 'Back' }, { keyword: 'Back' }]) {
    const a = flowText(err, { last, seen });
    assert.equal(a.short, `${last.keyword === 'Back' ? 'Nhấn Back' : 'Nhấn "Back"'} không lùi về màn Welcome`);
    assert.match(a.actual, /app vẫn ở màn "What brings you to Tastory\?", không lùi về màn Welcome\.$/);
    assert.equal(a.expected, 'App lùi về màn Welcome (theo test case).');
  }
  const b = flowText(err, { last: { keyword: 'Tap', target: 'Back' } });
  assert.equal(b.actual, 'Sau khi nhấn "Back", app không lùi về màn Welcome.');
});
