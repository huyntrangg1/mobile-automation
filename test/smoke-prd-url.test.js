import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPrdUrl } from '../server/smoke/prdUrl.js';

const OK = 'https://developers.begamob.com/workspace/stress-watch/prd1/blood-sugar';

test('checkPrdUrl: link begamob dạng /workspace/… hợp lệ; cắt khoảng trắng hai đầu', () => {
  assert.deepEqual(checkPrdUrl(OK), { ok: true, url: OK });
  assert.deepEqual(checkPrdUrl(`  ${OK}\n`), { ok: true, url: OK });
  assert.equal(checkPrdUrl('https://developers.begamob.com/workspace/stress-watch/docs/7349370d').ok, true); // link editor
});

test('checkPrdUrl: rỗng là hợp lệ (PRD tuỳ chọn), trả url rỗng', () => {
  assert.deepEqual(checkPrdUrl(''), { ok: true, url: '' });
  assert.deepEqual(checkPrdUrl(undefined), { ok: true, url: '' });
  assert.deepEqual(checkPrdUrl('   '), { ok: true, url: '' });
});

test('checkPrdUrl: chữ ghi chú dán nhầm → lỗi nói rõ ô này cần đường link', () => {
  const r = checkPrdUrl('- Không còn trang nào để nhập frame Figma theo app. Smoke Test vẫn nhận file .json từ plugin qua màn của nó.');
  assert.equal(r.ok, false);
  assert.match(r.error, /Link PRD/);
  assert.match(r.error, /https:\/\//);
});

test('checkPrdUrl: link không phải tài liệu begamob /workspace/ hoặc không phải http(s) → lỗi', () => {
  for (const bad of ['https://example.com/x', 'ftp://developers.begamob.com/workspace/a/b', 'developers.begamob.com/workspace/a/b', '/workspace/a/b']) {
    const r = checkPrdUrl(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /workspace|https/);
  }
});
