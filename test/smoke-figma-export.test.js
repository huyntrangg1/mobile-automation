import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readExport } from '../server/locators/figmaFrames.js';
import { loadFigmaExport, summarizeFrames, figmaTexts } from '../server/smoke/figmaExport.js';
import { tmpDir, figmaExportJson } from './helpers.js';

test('figmaTexts: lấy chữ TEXT đang hiện, bỏ node ẩn', () => {
  const n = { type: 'FRAME', children: [{ type: 'TEXT', characters: ' Welcome ' }, { type: 'TEXT', characters: 'Hidden', visible: false }, { type: 'GROUP', children: [{ type: 'TEXT', characters: 'Get started' }] }] };
  assert.deepEqual(figmaTexts(n), ['Welcome', 'Get started']);
});

test('loadFigmaExport: ghi ảnh từng frame vào thư mục, trả tên + chữ + chuyển cảnh; bỏ mảnh component nhỏ', () => {
  const dir = tmpDir();
  const r = loadFigmaExport({ data: readExport(figmaExportJson()), dir });
  assert.equal(r.file, 'Moss');
  assert.deepEqual(r.frames.map((f) => f.id), ['1:2', '1:3']); // frame 76×20 là mảnh component → bỏ
  assert.deepEqual(r.frames[0].texts, ['Blood Sugar', 'Log Now']);
  assert.deepEqual(r.frames[0].reactions, [{ text: 'Log Now', toId: '1:3', to: 'Blood Sugar - Log' }]);
  assert.equal(fs.readFileSync(r.frames[0].png, 'utf8'), 'PNG-HOME');
  assert.ok(r.frames[0].png.startsWith(dir));
  assert.match(path.basename(r.frames[1].png), /\.png$/);
});

test('summarizeFrames: mỗi frame một dòng có id, tên, loại, chữ và chuyển cảnh; cắt bớt chữ dài', () => {
  const { frames } = loadFigmaExport({ data: readExport(figmaExportJson()), dir: tmpDir() });
  const s = summarizeFrames(frames);
  assert.match(s, /\[1:2\] Action - Blood Sugar No data/);
  assert.match(s, /Blood Sugar - Log/);
  assert.match(s, /Log Now → Blood Sugar - Log/);
  const many = [{ id: 'x', name: 'N', kind: 'screen', texts: Array.from({ length: 50 }, (_, i) => `t${i}`), reactions: [] }];
  assert.ok(!summarizeFrames(many, { maxTexts: 5 }).includes('t10'));
});

test('readExport: file không đúng định dạng → lỗi 400 rõ ràng', () => {
  assert.throws(() => readExport('không phải json'), (e) => e.status === 400);
  assert.throws(() => readExport(JSON.stringify({ tool: 'khác', frames: [] })), (e) => e.status === 400);
});

test('loadFigmaExport: ghi thêm file json (node + scale) của từng frame để so bằng code', () => {
  const dir = tmpDir();
  const r = loadFigmaExport({ data: readExport(figmaExportJson()), dir });
  const j = JSON.parse(fs.readFileSync(r.frames[0].json, 'utf8'));
  assert.equal(j.id, '1:2');
  assert.equal(j.name, 'Action - Blood Sugar No data');
  assert.equal(j.scale, 1);
  assert.equal(j.node.type, 'FRAME');
  assert.ok(r.frames[0].json.startsWith(dir));
});

// ---- Bản tóm tắt phân biệt được các màn + tên frame trùng ----
const mk = (id, name, texts, extra = {}) => ({ id, name, width: 375, height: 812, scale: 1, png: Buffer.from('P' + id).toString('base64'),
  node: { id, type: 'FRAME', name, absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 }, children: texts.map((t) => ({ type: 'TEXT', characters: t })), ...extra } });
const exp = (frames) => readExport(JSON.stringify({ tool: 'qa-pipeline-figma-export', version: 3, file: 'F', page: 'P', frames }));
const CHROME = ['9:41', 'Action', 'Select time', 'Mon'];

test('summarizeFrames: chữ chung của nhiều màn (thanh trạng thái, tab, ngày) được nêu MỘT lần ở đầu, mỗi dòng chỉ còn chữ riêng của màn', () => {
  const data = exp([
    mk('1:1', 'No data', [...CHROME, 'Log your first reading', 'Log Now']),
    mk('1:2', 'Log', [...CHROME, 'Log Blood Sugar', 'Save']),
    mk('1:3', 'Detail', [...CHROME, 'Current', '7 days', '30 days']),
    mk('1:4', 'History', [...CHROME, 'History', 'No records']),
    mk('1:5', 'Record', [...CHROME, 'Record detail', 'Within Range']),
  ]);
  const { frames } = loadFigmaExport({ data, dir: tmpDir() });
  const s = summarizeFrames(frames);
  const lines = s.split('\n');
  assert.match(lines[0], /chung/i);
  assert.match(lines[0], /Select time/);
  const frameLines = lines.filter((l) => l.startsWith('- ['));
  assert.equal(frameLines.length, 5);
  for (const l of frameLines) assert.doesNotMatch(l, /Select time|9:41/); // đã nêu ở dòng chung
  assert.match(frameLines[0], /Log your first reading \| Log Now/);
  assert.match(frameLines[2], /Current \| 7 days \| 30 days/);
});

test('summarizeFrames: ít frame (< 4) thì không lọc chữ chung (không đủ dữ liệu để biết đâu là chung); chữ lặp trong một frame chỉ ghi một lần', () => {
  const data = exp([mk('1:1', 'A', ['Hello', 'Hello', 'World']), mk('1:2', 'B', ['Hello', 'Other'])]);
  const s = summarizeFrames(loadFigmaExport({ data, dir: tmpDir() }).frames);
  assert.ok(!s.split('\n')[0].match(/chung/i));
  assert.match(s, /\[1:1\] A \(screen\): Hello \| World/);
  assert.match(s, /\[1:2\] B \(screen\): Hello \| Other/);
});

test('summarizeFrames: maxTexts áp dụng cho chữ RIÊNG (chữ chung không chiếm chỗ)', () => {
  const uniq = Array.from({ length: 30 }, (_, i) => `riêng${i}`);
  const data = exp([mk('1:1', 'A', [...CHROME, ...uniq]), mk('1:2', 'B', [...CHROME, 'x']), mk('1:3', 'C', [...CHROME, 'y']), mk('1:4', 'D', [...CHROME, 'z'])]);
  const s = summarizeFrames(loadFigmaExport({ data, dir: tmpDir() }).frames, { maxTexts: 5 });
  const a = s.split('\n').find((l) => l.startsWith('- [1:1]'));
  assert.match(a, /riêng0 \| riêng1 \| riêng2 \| riêng3 \| riêng4/);
  assert.doesNotMatch(a, /riêng5/);
});

test('loadFigmaExport: frame trùng tên → thêm node-id vào tên để phân biệt (chỉ những tên bị trùng); chuyển cảnh trỏ đúng frame', () => {
  const btn = { id: '9:9', type: 'FRAME', name: 'btn', reactions: [{ destinationId: '2:2', trigger: { type: 'ON_CLICK' }, navigation: 'NAVIGATE' }], children: [{ type: 'TEXT', characters: 'Go' }] };
  const data = exp([mk('1:1', 'Home', ['a'], { children: [btn] }), mk('2:1', 'Elevated Range', ['x']), mk('2:2', 'Elevated Range', ['y']), mk('3:1', 'Unique', ['z'])]);
  const { frames } = loadFigmaExport({ data, dir: tmpDir() });
  assert.deepEqual(frames.map((f) => f.name), ['Home', 'Elevated Range [2:1]', 'Elevated Range [2:2]', 'Unique']);
  assert.equal(new Set(frames.map((f) => f.name)).size, frames.length);
  assert.deepEqual(frames[0].reactions, [{ text: 'Go', toId: '2:2', to: 'Elevated Range [2:2]' }]);
  assert.equal(JSON.parse(fs.readFileSync(frames[2].json, 'utf8')).name, 'Elevated Range [2:2]');
});

test('summarizeFrames: dải chữ lặp ở khoảng một nửa số màn (không "chung" hẳn) vẫn không chiếm chỗ của chữ riêng — lấy chữ hiếm trước, giữ thứ tự gốc', () => {
  const strip = ['Action', 'Select time', 'Mon'];
  const data = exp([
    mk('1:1', 'A', [...strip, 'u1', 'u2']), mk('1:2', 'B', [...strip, 'u3', 'u4']), mk('1:3', 'C', [...strip, 'u5', 'u6']),
    mk('1:4', 'D', ['v4', 'v5']), mk('1:5', 'E', ['v6', 'v7']), mk('1:6', 'F', ['v8', 'v9']),
  ]);
  const s = summarizeFrames(loadFigmaExport({ data, dir: tmpDir() }).frames, { maxTexts: 3 });
  const a = s.split('\n').find((l) => l.startsWith('- [1:1]'));
  assert.match(a, /u1/);
  assert.match(a, /u2/);
  assert.match(a, /\[1:1\] A \(screen\): (Action \| )?u1 \| u2$|\[1:1\] A \(screen\): [^|]+ \| u1 \| u2$/); // chữ riêng có mặt, thứ tự gốc giữ nguyên
  const idx = (t) => a.indexOf(t);
  assert.ok(idx('u1') < idx('u2'));
});

test('summarizeFrames: chữ quá dài bị cắt — ở dòng riêng của frame (50 ký tự) và ở dòng chữ chung (30 ký tự, tối đa 12 mục)', () => {
  const long = 'This information is for personal health tracking purposes only and does not constitute medical advice, diagnosis, or treatment.';
  // long chỉ có ở frame A → là chữ riêng, bị cắt ở dòng của A
  const own = summarizeFrames(loadFigmaExport({ data: exp([mk('1:1', 'A', [long, 'a']), mk('1:2', 'B', ['b']), mk('1:3', 'C', ['c']), mk('1:4', 'D', ['d'])]), dir: tmpDir() }).frames);
  assert.ok(!own.includes(long));
  assert.ok(own.split('\n').find((l) => l.startsWith('- [1:1]')).includes(`${long.slice(0, 50)}…`));
  // long có ở mọi frame → là chữ chung, chỉ nằm ở dòng đầu (cắt 30 ký tự), danh sách chung giới hạn 12 mục
  const manyCommon = Array.from({ length: 40 }, (_, i) => `common${i}`);
  const data = exp([mk('1:1', 'A', [long, ...manyCommon, 'only-a']), mk('1:2', 'B', [long, ...manyCommon, 'only-b']), mk('1:3', 'C', [long, ...manyCommon, 'only-c']), mk('1:4', 'D', [long, ...manyCommon])]);
  const s = summarizeFrames(loadFigmaExport({ data, dir: tmpDir() }).frames);
  const lines = s.split('\n');
  assert.ok(!s.includes(long));
  assert.match(lines[0], /This information is for person…/);
  assert.ok(lines[0].split(' | ').length <= 12);
  assert.match(lines.find((l) => l.startsWith('- [1:1]')), /only-a/);
});
