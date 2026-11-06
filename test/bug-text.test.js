// Log Asana: AI viết lại bug theo skill test-report, reference.md → "Cách viết bug" (POST /api/bug-text)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeBugs, guideOf, GUIDE_FILE } from '../server/ai/bugText.js';

const BUG = {
  id: 'BUG-001',
  draft: { title: '[BUG][Encouragement] Không hiển thị "You\'re in the right place" khi tắt hẳn app rồi mở lại', pre: ['Xoá app, cài lại bản mới', 'Thiết bị: iPhone 17 Pro'], steps: ['Nhấn "Get Started"', 'Tắt hẳn app rồi mở lại'], actual: 'a', expected: 'e' },
  facts: { tc: { id: 'TC_ONB_RULE_003', title: 'Verify kill app …', feature: 'onboarding-v1-0-4-automation' }, screen: 'Encouragement', checks: [{ keyword: 'Verify text', target: "You're in the right place", actual: null, expected: "You're in the right place" }], seen: { title: 'Welcome to' } },
};

test('reference.md (vendor) có mục "Cách viết bug" đủ các field, không lấy sang mục kế tiếp', () => {
  const g = guideOf(fs.readFileSync(GUIDE_FILE, 'utf8'));
  assert.ok(g && !g.includes('Design checks'));
  for (const h of ['Title', 'Precondition', 'Steps to Reproduce', 'Actual Result', 'Expected Result']) assert.ok(g.includes(h), h);
});

test('writeBugs: hướng dẫn làm system prompt, gửi draft + facts, không tool; chuẩn hoá kết quả (bỏ số thứ tự, dòng trống)', async () => {
  let call;
  const runClaude = async (o) => {
    call = o;
    return { ok: true, data: { bugs: [{ id: 'BUG-001', title: ' [BUG][Onboarding] Không mở lại đúng màn đang dở khi kill app ', pre: ['Xoá app, cài lại bản mới', ''], steps: ['1. Nhấn "Get Started"', '2) Ở màn Encouragement, tắt hẳn app rồi mở lại', 'Quan sát màn hiện tại'], actual: 'Không hiển thị màn Encouragement.', expected: 'Hiển thị màn Encouragement.' }] } };
  };
  const r = await writeBugs([BUG], { runClaude, guideFile: GUIDE_FILE });
  assert.equal(r.ok, true);
  assert.match(call.system, /Title/);
  assert.doesNotMatch(call.system, /## Excel/);
  assert.equal(call.noTools, true);
  assert.ok(call.schema.properties.bugs);
  assert.match(call.prompt, /TC_ONB_RULE_003/);
  assert.deepEqual(r.bugs[0], { id: 'BUG-001', title: '[BUG][Onboarding] Không mở lại đúng màn đang dở khi kill app', pre: ['Xoá app, cài lại bản mới'], steps: ['Nhấn "Get Started"', 'Ở màn Encouragement, tắt hẳn app rồi mở lại', 'Quan sát màn hiện tại'], actual: 'Không hiển thị màn Encouragement.', expected: 'Hiển thị màn Encouragement.' });
});

test('writeBugs: lỗi đầu vào / AI lỗi / AI thiếu field → báo lỗi, form giữ mẫu câu', async () => {
  assert.equal((await writeBugs([])).status, 400);
  assert.equal((await writeBugs([{ id: 'x', draft: {} }])).status, 400); // report cũ chưa có facts
  assert.equal((await writeBugs([BUG], { runClaude: async () => ({ ok: false, error: 'timeout' }) })).status, 502);
  const partial = await writeBugs([BUG], { runClaude: async () => ({ ok: true, data: { bugs: [{ id: 'BUG-001', title: 'T', pre: [], steps: [], actual: '', expected: '' }] } }) });
  assert.equal(partial.ok, false);
  assert.equal((await writeBugs([BUG], { guideFile: '/khong/co.md', runClaude: async () => ({ ok: true }) })).status, 500);
});
