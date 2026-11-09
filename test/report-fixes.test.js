// Report (skill test-report, bản vendor): phân loại Blocked (môi trường / bug app / cần xem) + mục "Cần xem"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEST_REPORT_VENDOR } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const src = (f) => pathToFileURL(path.join(TEST_REPORT_VENDOR, 'assets/src/report', f)).href;
const { statusOf, blockKindOf, resolveBlockKinds, buildHtml } = await import(src('hooks.js'));

const CRASH = "An unknown server-side error occurred while processing the command. Original error: The application under test with bundle id 'com.x' is not running, possibly crashed";
const GONE = 'WebDriverError: A session is either terminated or not started when running "element"';

test('statusOf: app crash / không còn chạy → defect (không giấu vào môi trường)', () => {
  assert.deepEqual(statusOf(false, new Error(CRASH)), { status: 'blocked', blockKind: 'defect' });
  assert.equal(blockKindOf('WebDriverError: The app has crashed'), 'defect');
  // WebDriverError chung chung không còn bị coi là môi trường
  assert.equal(blockKindOf('WebDriverError: An unknown server-side error occurred'), 'defect');
});

test('statusOf: lỗi môi trường thật vẫn là env; "để app sai màn" → review (cần xem), không phải env', () => {
  for (const m of ['connect ECONNREFUSED 127.0.0.1:4723', 'session not created: Could not start a new session', 'xcodebuild failed with code 65', 'Thiếu biến môi trường TEST_EMAIL', 'TC trước bị chặn']) {
    assert.equal(statusOf(false, new Error(m)).blockKind, 'env', m);
  }
  assert.equal(statusOf(false, new Error('Case trước để app sai màn: đang ở Paywall')).blockKind, 'review');
  assert.equal(statusOf(false, { name: 'AssertionError', message: 'x' }).status, 'failed');
});

test('resolveBlockKinds: chuỗi case liên tiếp mất phiên → case đầu cần xem, các case sau môi trường; crash rồi mất phiên → sau là env', () => {
  const b = (error, extra = {}) => ({ status: 'blocked', error, ...extra });
  const out = resolveBlockKinds([{ status: 'passed' }, b(GONE), b(GONE), b(GONE), { status: 'passed' }, b(GONE)]).map((r) => r.blockKind);
  assert.deepEqual(out, [undefined, 'review', 'env', 'env', undefined, 'review']);
  assert.deepEqual(resolveBlockKinds([b(CRASH), b(GONE)]).map((r) => r.blockKind), ['defect', 'env']);
});

test('resolveBlockKinds: kết quả cũ (ghi bằng quy tắc rộng) được phân loại lại; env ghi sẵn không khớp quy tắc nào giữ nguyên', () => {
  const old = resolveBlockKinds([
    { status: 'blocked', blockKind: 'env', error: CRASH },
    { status: 'blocked', blockKind: 'env', error: 'Case trước để app sai màn' },
    { status: 'blocked', blockKind: 'env', error: 'So với Figma không được: không có frame' },
    { status: 'blocked', blockKind: 'env', error: 'WebDriverError: something odd' },
  ]).map((r) => r.blockKind);
  assert.deepEqual(old, ['defect', 'review', 'env', 'defect']);
});

function writeRun() {
  const reports = tmpDir();
  const dir = path.join(reports, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const r = (n, o) => fs.writeFileSync(path.join(dir, `${1000 + n}-1.json`), JSON.stringify({ suite: 's', duration: 1, bugs: [], failShot: null, steps: [], ...o }));
  r(1, { title: 'TC_1 a', passed: true, status: 'passed', case: { id: 'TC_1' } });
  r(2, { title: 'TC_2 b', passed: true, status: 'passed', case: { id: 'TC_2' } });
  r(3, { title: 'TC_3 c', passed: true, status: 'passed', case: { id: 'TC_3' } });
  r(4, { title: 'TC_4 d', passed: false, status: 'blocked', blockKind: 'env', error: GONE, case: { id: 'TC_4' } });
  r(5, { title: 'TC_5 e', passed: false, status: 'blocked', blockKind: 'env', error: GONE, case: { id: 'TC_5' } });
  fs.writeFileSync(path.join(reports, 'ai-assist.jsonl'), `${JSON.stringify({ tc: 'TC_1', step: 3, screen: 'Goals', kind: 'tap', error: 'Không thấy "Continue"', how: 'retry', actions: [] })}\n`);
  fs.writeFileSync(path.join(reports, 'unverified.jsonl'), `${JSON.stringify({ tc: 'TC_2', step: 2, label: 'Toast', why: 'chữ thoáng qua' })}\n`);
  return reports;
}

test('buildHtml: case Passed có lệch so với script / điểm kiểm không kiểm được → badge + mục Cần xem; số Passed không đổi', async () => {
  const reports = writeRun();
  await buildHtml(reports, new Date(), { sync: false, appName: 'Demo' });
  const html = fs.readFileSync(path.join(reports, 'bug-report.html'), 'utf8');
  assert.match(html, /<section id="review">/);
  const review = html.slice(html.indexOf('<section id="review">'), html.indexOf('</section>', html.indexOf('<section id="review">')));
  assert.match(review, /TC_1/);
  assert.match(review, /AI hỗ trợ gỡ kẹt ở bước 3/);
  assert.match(review, /TC_2/);
  assert.match(review, /kiểm tay/);
  assert.match(review, /TC_4/); // case đầu mất phiên → cần xem
  assert.doesNotMatch(review, /TC_3/);
  // Badge ở dòng của case
  assert.equal((html.match(/class="rv-flag"/g) || []).length, 3);
  // TC_5 (mất phiên tiếp theo) vẫn là môi trường
  const notApp = html.slice(html.indexOf('<section id="not-app">'), html.indexOf('</section>', html.indexOf('<section id="not-app">')));
  assert.match(notApp, /TC_5/);
  assert.doesNotMatch(notApp, /TC_4/);
  // Số Passed giữ nguyên (3), trạng thái từng dòng không đổi
  assert.equal((html.match(/data-status="passed"/g) || []).length, 3);
  assert.equal((html.match(/data-status="blocked"/g) || []).length, 2);
});
