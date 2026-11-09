import test from 'node:test';
import assert from 'node:assert/strict';
import { smartPick } from '../server/apps/template/src/runner/steps.js';
import { buildScript } from '../server/scripts/scriptFile.js';

// Hộp thoại hệ thống không có trong test case: theo dõi (ATT) → từ chối; xin quyền (thông báo, ảnh, camera, vị trí, micro…) → cho phép để tính năng chạy
test('smartPick: ATT → Ask App Not to Track; xin quyền → Allow / Allow Full Access / Allow While Using App; không có nút cho phép → null', () => {
  assert.equal(smartPick(['Ask App Not to Track', 'Allow']), 'Ask App Not to Track');
  assert.equal(smartPick(['Don’t Allow', 'Allow']), 'Allow');
  assert.equal(smartPick(['Allow Full Access', 'Limit Access…', "Don't Allow"]), 'Allow Full Access');
  assert.equal(smartPick(['Allow Once', 'Allow While Using App', "Don't Allow"]), 'Allow While Using App');
  assert.equal(smartPick(['Không cho phép', 'Cho phép']), 'Cho phép');
  assert.equal(smartPick(['Subscribe', 'Cancel']), null); // không phải hộp xin quyền → không tự bấm
});

test('khung: trước mỗi case bật tự xử lý hộp thoại hệ thống (iOS) — trừ case có dòng Handle permission (đi theo test case)', () => {
  const code = buildScript({ file: 'f', order: ['TC_A'], regions: { TC_A: 'async ({ sa }) => {\n  sa.eq(1, "x", true, true);\n}' }, helpers: [{ ns: 'ui', rel: 'src/utils/ui.js' }, { ns: 'app', rel: 'src/utils/app.js' }], pack: null });
  assert.match(code, /async function autoAlerts\(tc, say\)/);
  // WDA không được tự bấm alert (selector không khớp → WDA bấm nút mặc định của mọi alert, kể cả alert của app)
  assert.match(code, /updateSettings\(\{ defaultAlertAction: '' \}\)/);
  assert.doesNotMatch(code, /defaultAlertAction: 'accept'/);
  assert.match(code, /r\.keyword === 'Handle permission'/);
  assert.match(code, /await autoAlerts\(tc, say\);/);
  assert.match(code, /Ask App Not to Track/);
});

// Chạy lại case chỉ khi lỗi chập chờn (RUN-0145: 27/28 lần chạy lại lỗi y chỗ cũ, tốn ~15 phút)
test('khung: chỉ chạy lại khi lỗi chập chờn; case có Handle permission không tự đóng hộp thoại trong lúc chờ', () => {
  const code = buildScript({ file: 'f', order: ['TC_A'], regions: { TC_A: 'async ({ sa }) => {\n  sa.eq(1, "x", true, true);\n}' }, helpers: [{ ns: 'ui', rel: 'src/utils/ui.js' }, { ns: 'app', rel: 'src/utils/app.js' }], pack: null });
  assert.match(code, /attempt < RECOVER && worthRetry\(e\)/);
  assert.match(code, /autoDismiss: !handlesDialog\(tc\)/);
  const src = code.match(/const FLAKY = (\/.*\/i);/)[1];
  const FLAKY = eval(src);
  for (const m of ['WebDriverError: The element identified by "01" is either not present or it has expired from the internal cache', 'invalid session id', 'Không tới được màn Recipe imported successfully!: không thấy tiêu đề "Recipe imported successfully!" sau 30s'])
    assert.ok(FLAKY.test(m), m);
  for (const m of ['Không thấy "Next" trên màn Coachmark', 'Không tới được màn Welcome: "Save recipes" không hiện sau 15s', 'Chưa khai báo hook setup "kill_app" trong src/hooks.js', 'Set network chỉ chạy trên Android — đặt Platform = Android cho dòng này', 'không hiện sau 5s'])
    assert.ok(!FLAKY.test(m), m);
});

test('khung: case Tiếp nối kiểm màn bắt đầu ĐANG HIỆN; case kiểm animation mở app không chờ màn đứng yên', () => {
  const code = buildScript({ file: 'f', order: ['TC_A'], regions: { TC_A: 'async ({ sa }) => {\n  sa.eq(1, "x", true, true);\n}' }, helpers: [{ ns: 'ui', rel: 'src/utils/ui.js' }, { ns: 'app', rel: 'src/utils/app.js' }], pack: null });
  assert.match(code, /await startCheck\(tc, say\);\n\s+if \(blockedBy && !\(await navigateStart/);
  assert.match(code, /ui\.visible\(m\.sel, 3000\)/);
  assert.match(code, /app\.freshStart\(\{ log: say, settle: !watchesAnimation\(tc\) \}\)/);
  const ANIM = eval(code.match(/const ANIM = (\/.*\/i);/)[1]);
  assert.ok(ANIM.test('Verify animation màn Welcome tự chạy sau Splash'));
  assert.ok(!ANIM.test('Verify tap Continue chuyển màn Goals'));
});
