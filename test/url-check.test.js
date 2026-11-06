import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, matchUrl } from '../server/apps/template/src/runner/steps.js';

test('cleanUrl bỏ ký tự định hướng vô hình (thanh địa chỉ lúc đang tải chỉ có U+200E)', () => {
  assert.equal(cleanUrl('‎begamob.com'), 'begamob.com');
  assert.equal(cleanUrl('‎'), '');
});

test('matchUrl: trình duyệt trong app chỉ hiện tên miền → so tên miền', () => {
  assert.deepEqual(matchUrl('‎begamob.com', 'https://begamob.com/ofs-termofuse.html'), { ok: true, hostOnly: true });
  assert.deepEqual(matchUrl('www.begamob.com', 'https://begamob.com/a'), { ok: true, hostOnly: true });
  assert.deepEqual(matchUrl('google.com', 'https://begamob.com/a'), { ok: false, hostOnly: true });
});

test('matchUrl: có đường dẫn đầy đủ → so cả đường dẫn; chưa tải xong → sai', () => {
  assert.deepEqual(matchUrl('https://begamob.com/ofs-termofuse.html', 'https://begamob.com/ofs-termofuse.html/'), { ok: true, hostOnly: false });
  assert.deepEqual(matchUrl('begamob.com/other', 'https://begamob.com/ofs-termofuse.html'), { ok: false, hostOnly: false });
  assert.deepEqual(matchUrl('‎', 'https://begamob.com/x'), { ok: false, hostOnly: false });
});
