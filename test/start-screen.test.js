import test from 'node:test';
import assert from 'node:assert/strict';
import { startScreen } from '../server/apps/template/src/runner/describe.js';

// RUN-0140: case đầu chuỗi bắt đầu bằng "Launch fresh" (cột Screen trống) → màn bắt đầu rỗng → không điều hướng được, 4 case Tiếp nối sau bị Blocked theo
test('startScreen: bỏ qua dòng không có tên màn (Launch fresh, Run flow…) để lấy màn đầu tiên thật', () => {
  const tc = { rows: [{ step: 1, screen: '', kind: 'Action', keyword: 'Launch fresh' }, { step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Wait until displayed' }] };
  assert.equal(startScreen(tc), 'Welcome');
  assert.equal(startScreen({ rows: [{ screen: '' }] }), undefined);
  assert.equal(startScreen({ rows: [{ screen: 'Goals', platform: 'Android' }, { screen: 'Welcome' }] }), process.env.PLATFORM === 'Android' ? 'Goals' : 'Welcome');
});
