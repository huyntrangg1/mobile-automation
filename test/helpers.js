import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-'));

// File xuất của plugin "QA Pipeline – Export frame" (rút gọn) dùng cho test AI Smoke Test
export function figmaExportJson() {
  const box = (w, h) => ({ x: 0, y: 0, width: w, height: h });
  const png = (s) => Buffer.from(s).toString('base64');
  return JSON.stringify({
    tool: 'qa-pipeline-figma-export', file: 'Moss', page: 'Blood Sugar', exportedAt: '2026-11-05T00:00:00.000Z',
    frames: [
      { id: '1:2', name: 'Action - Blood Sugar No data', width: 375, height: 812, scale: 1, png: png('PNG-HOME'), node: { id: '1:2', type: 'FRAME', name: 'Action - Blood Sugar No data', absoluteBoundingBox: box(375, 812), children: [
        { type: 'TEXT', characters: 'Blood Sugar' },
        { type: 'TEXT', characters: 'Hidden text', visible: false },
        { type: 'FRAME', id: '9:9', name: 'btn', reactions: [{ destinationId: '1:3', trigger: { type: 'ON_CLICK' }, navigation: 'NAVIGATE' }], children: [{ type: 'TEXT', characters: 'Log Now' }] },
      ] } },
      { id: '1:3', name: 'Blood Sugar - Log', width: 375, height: 812, scale: 1, png: png('PNG-LOG'), node: { id: '1:3', type: 'FRAME', name: 'Blood Sugar - Log', absoluteBoundingBox: box(375, 812), children: [{ type: 'TEXT', characters: 'Log Blood Sugar' }, { type: 'TEXT', characters: 'Save' }] } },
      { id: '1:4', name: 'Text button', width: 76, height: 20, scale: 1, png: png('PNG-PART'), node: { id: '1:4', type: 'FRAME', name: 'Text button', absoluteBoundingBox: box(76, 20), children: [{ type: 'TEXT', characters: 'Skip' }] } },
    ],
  });
}
