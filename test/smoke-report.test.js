import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../server/smoke/report.js';

const run = (over = {}) => ({
  id: 'SM-0001', appId: 'a', status: 'done', startedAt: '2026-11-05T10:00:00.000Z', finishedAt: '2026-11-05T10:12:00.000Z',
  prdUrl: 'https://developers.begamob.com/workspace/stress-watch/prd1/blood-sugar', figmaUrl: 'https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss?node-id=1-2',
  flows: [
    { id: 'f1', name: 'Log chỉ số', status: 'ok', steps: 6, summary: 'Khớp' },
    { id: 'f2', name: 'Chọn State', status: 'deviation', steps: 9, summary: 'Lệch nút' },
    { id: 'f3', name: 'Mở History', status: 'unverifiable', steps: 25, summary: 'Vượt giới hạn số bước (25)' },
    { id: 'f4', name: 'Mở Record Detail', status: 'unreachable', steps: 3, summary: 'Không thấy tab History' },
  ],
  findings: [
    { flowId: 'f2', kind: 'prd', summary: 'Thiếu dòng "Ideal range"', prdQuote: 'hiện dòng Ideal range', frameName: 'Blood Sugar - Log', appShot: '/files/data/smoke/SM-0001/a.png', figmaShot: '/files/data/smoke/SM-0001/figma-1.png' },
    { flowId: 'f2', kind: 'conflict', summary: 'PRD 70–99, Figma 80–150', prdQuote: '', frameName: 'Blood Sugar - Log', appShot: '/files/data/smoke/SM-0001/b.png', figmaShot: '' },
  ],
  ...over,
});

test('renderReport: đầu report có số luồng / đi hết / điểm lệch', () => {
  const html = renderReport(run(), 'StressWatch');
  assert.match(html, /data-k="flows">4</);
  assert.match(html, /data-k="done">2</); // ok + deviation = đi hết luồng
  assert.match(html, /data-k="findings">2</);
  assert.match(html, /StressWatch/);
  assert.match(html, /SM-0001/);
});

test('renderReport: mỗi điểm lệch có tóm tắt, đoạn PRD, ảnh app, ảnh Figma và nhãn nguồn lệch bằng chữ', () => {
  const html = renderReport(run(), 'StressWatch');
  for (const s of ['Thiếu dòng', 'hiện dòng Ideal range', '/files/data/smoke/SM-0001/a.png', '/files/data/smoke/SM-0001/figma-1.png', 'Lệch PRD', 'PRD và Figma mâu thuẫn']) assert.ok(html.includes(s), s);
  assert.equal((html.match(/<img /g) || []).length, 3); // điểm lệch thứ hai không có ảnh Figma
});

test('renderReport: luồng không kiểm được / không tới được có dòng riêng kèm lý do', () => {
  const html = renderReport(run(), 'StressWatch');
  assert.match(html, /Mở History[\s\S]*không kiểm được[\s\S]*Vượt giới hạn số bước \(25\)/);
  assert.match(html, /Mở Record Detail[\s\S]*không tới được[\s\S]*Không thấy tab History/);
});

test('renderReport: nhãn đủ 4 loại nguồn lệch', () => {
  const kinds = ['prd', 'figma', 'conflict', 'unclear'].map((kind) => ({ flowId: 'f1', kind, summary: kind, prdQuote: '', frameName: '', appShot: '', figmaShot: '' }));
  const html = renderReport(run({ findings: kinds }), 'x');
  for (const l of ['Lệch PRD', 'Lệch Figma', 'PRD và Figma mâu thuẫn', 'PRD chưa rõ']) assert.ok(html.includes(l), l);
});

test('renderReport: escape HTML trong chữ do AI / người dùng nhập', () => {
  const html = renderReport(run({ findings: [{ flowId: 'f1', kind: 'prd', summary: '<script>alert(1)</script>', prdQuote: '"><img src=x onerror=1>', frameName: '', appShot: '', figmaShot: '' }] }), '<b>App</b>');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>App</b>'));
});

test('renderReport: ngắn (< 20.000 ký tự cho một lần chạy mẫu); lần chạy chưa có luồng vẫn vẽ được', () => {
  assert.ok(renderReport(run(), 'StressWatch').length < 20000);
  const html = renderReport(run({ flows: [], findings: [], status: 'error', error: 'Không rút được luồng chính từ PRD' }), 'StressWatch');
  assert.match(html, /Không rút được luồng chính từ PRD/);
  assert.match(html, /data-k="flows">0</);
});

test('renderReport: không có PRD → không in dòng PRD', () => {
  const html = renderReport(run({ prdUrl: '' }), 'StressWatch');
  assert.ok(!html.includes('PRD: https'), 'dòng link PRD ở đầu report');
  assert.match(html, /Figma: https/);
});

test('renderReport: không có Figma → không in dòng Figma', () => {
  const html = renderReport(run({ figmaUrl: '' }), 'StressWatch');
  assert.ok(!html.includes('Figma: https'), 'dòng link Figma ở đầu report');
  assert.match(html, /PRD: https/);
});

test('renderReport: có usage → in dòng token và chi phí; không có → không in', () => {
  const html = renderReport(run({ usage: { calls: 170, input: 300, cacheCreate: 40000, cacheRead: 900000, output: 12000, costUsd: 4.5 } }), 'StressWatch');
  assert.match(html, /170 lần gọi AI/);
  assert.match(html, /4\.50 USD/);
  assert.ok(!renderReport(run(), 'StressWatch').includes('lần gọi AI'));
});

test('renderReport: Figma từ file .json → dòng "Figma: file <tên>", không in link', () => {
  const html = renderReport(run({ figmaUrl: '', figmaSource: 'json', figmaFileName: 'Moss.json' }), 'StressWatch');
  assert.match(html, /Figma: file Moss\.json/);
});

test('renderReport: điểm lệch do bộ so bằng code có ảnh so (Figma trái · App phải), không ghi nhãn "App" sai', () => {
  const html = renderReport(run({ findings: [{ flowId: 'f2', kind: 'figma', summary: 'Màu nền khác Figma', prdQuote: '', frameName: 'Log', appShot: '/files/data/smoke/SM-0001/ev.png', figmaShot: '', evidence: true }] }), 'StressWatch');
  assert.match(html, /Figma \(trái\)/);
  assert.equal((html.match(/<img /g) || []).length, 1);
});

test('renderReport: nhãn "Độ bền" cho điểm lệch robust; luôn có dòng "Chưa kiểm" cho phần tool chưa hỗ trợ', () => {
  const html = renderReport(run({ findings: [{ flowId: 'f2', kind: 'robust', summary: 'Mất dữ liệu sau khi xuống nền', prdQuote: '', frameName: '', appShot: '', figmaShot: '' }] }), 'StressWatch');
  assert.match(html, /Độ bền/);
  assert.match(html, /Chưa kiểm/);
  assert.match(html, /mạng/);
  assert.match(html, /push/i);
  assert.match(html, /deep link/i);
});
