// Kết quả chạy ra Excel:
//   resultsWorkbook → reports/test-results.xlsx (nút Export Excel trên report): Summary / Test Results / Bugs
//   syncTestcaseFiles → ghi ngược trạng thái vào file xlsx test case (cột Test Result + Result / Bug / Last Run của TestData)
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { STATUS } from './html.js';

const label = (st) => (STATUS[st] || STATUS.failed)[0];
// Màu ô trạng thái (ARGB)
const FILL = { passed: 'FFE7F6EF', failed: 'FFFDECEC', blocked: 'FFFFFAEB', skipped: 'FFF2F4F7', notrun: 'FFFFFFFF' };
const paint = (cell, st) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[st] || FILL.failed } };
  cell.font = { bold: true };
};
const header = (ws) => {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};

export async function resultsWorkbook(model, { env, startedAt, appName = 'App' }) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 22 }, { width: 50 }];
  sum.addRows([
    ['Chạy lúc', startedAt],
    ['App', appName],
    ['Thiết bị', `${env.device} · ${env.platform || ''} ${env.platformVersion}`.replace(/\s+/g, ' ')],
    ['Phiên bản app', env.appVersion],
    ['Test case', model.withBugs.length],
    ...Object.keys(STATUS).map((k) => [label(k), model.counts[k]]),
    ['Pass rate', `${model.rate}% (${model.executed} test đã chạy)`],
    ['Bug', model.bugs.length],
    ['Bug Function', model.bugs.filter((b) => b.type === 'Function').length],
    ['Bug UI', model.bugs.filter((b) => b.type === 'UI').length],
  ]);
  sum.getColumn(1).font = { bold: true };

  const tr = wb.addWorksheet('Test Results');
  tr.columns = [
    { header: 'TC ID', key: 'tc', width: 18 },
    { header: 'Test case', key: 'suite', width: 50 },
    { header: 'Lượt chạy', key: 'title', width: 36 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Bug', key: 'bugs', width: 40 },
    { header: 'Thời gian (s)', key: 'time', width: 12 },
    { header: 'Ghi chú', key: 'note', width: 60 },
  ];
  for (const r of model.withBugs) {
    const row = tr.addRow({
      tc: r.case?.id || '', suite: r.suite, title: r.title, status: label(r.status),
      bugs: r.mine.map((b) => b.id).join(', '),
      time: ['skipped', 'notrun'].includes(r.status) ? '' : Math.round(r.duration / 100) / 10,
      note: r.status === 'blocked' ? `${r.blockKind === 'env' ? 'Môi trường: ' : ''}${String(r.error || '').split('\n')[0]}` : '',
    });
    paint(row.getCell('status'), r.status);
  }
  header(tr);

  const bs = wb.addWorksheet('Bugs');
  bs.columns = [
    { header: 'Bug ID', key: 'id', width: 10 },
    { header: 'Title', key: 'title', width: 70 },
    { header: 'Loại', key: 'type', width: 10 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Màn', key: 'screen', width: 18 },
    { header: 'Affected Area', key: 'areas', width: 24 },
    { header: 'TC', key: 'tc', width: 20 },
    { header: 'Precondition', key: 'pre', width: 50 },
    { header: 'Steps to Reproduce', key: 'steps', width: 50 },
    { header: 'Actual', key: 'actual', width: 40 },
    { header: 'Expected', key: 'expected', width: 40 },
  ];
  const numbered = (lines) => lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  for (const b of model.bugs) {
    bs.addRow({
      id: b.id, title: b.title, type: b.type, priority: b.priority, severity: b.severity, screen: b.screen,
      areas: b.screens.length > 1 ? b.screens.map((x) => x.screen).join('\n') : '',
      tc: b.tcIds.join('\n'), pre: numbered(b.pre), steps: numbered(b.stepsClean), actual: b.actual, expected: b.expectedShort,
    }).alignment = { vertical: 'top', wrapText: true };
  }
  header(bs);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Trạng thái gộp của 1 TC qua nhiều lượt chạy: lấy mức "xấu" nhất
const WORST = ['failed', 'blocked', 'notrun', 'skipped', 'passed'];
const worst = (list) => WORST.find((st) => list.includes(st)) || 'notrun';

function column(ws, name) {
  const head = ws.getRow(1);
  for (let c = 1; c <= head.cellCount; c++) if (String(head.getCell(c).value ?? '').trim() === name) return c;
  const c = head.cellCount + 1;
  head.getCell(c).value = name;
  head.getCell(c).font = { bold: true };
  return c;
}

// results có case.file (đường dẫn xlsx), case.id, case.dataSet, case.run — do spec ghi qua setCase / planTest
export async function syncTestcaseFiles(model, { startedAt, backupDir }) {
  const byFile = new Map();
  for (const r of model.withBugs) {
    if (!r.case?.file || !fs.existsSync(r.case.file)) continue;
    if (!byFile.has(r.case.file)) byFile.set(r.case.file, []);
    byFile.get(r.case.file).push(r);
  }
  const done = [];
  for (const [file, runs] of byFile) {
    // Giữ bản trước khi ghi, phòng ExcelJS làm mất định dạng đặc biệt của file gốc
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, path.basename(file)));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const tcs = wb.getWorksheet('TestCases');
    if (tcs) {
      const idCol = column(tcs, 'TC ID');
      const resCol = column(tcs, 'Test Result');
      const lastCol = column(tcs, 'Last Run');
      tcs.eachRow((row, i) => {
        if (i === 1) return;
        const mine = runs.filter((r) => r.case.id === String(row.getCell(idCol).value ?? '').trim());
        if (!mine.length) return;
        const st = worst(mine.map((r) => r.status));
        row.getCell(resCol).value = label(st);
        paint(row.getCell(resCol), st);
        row.getCell(lastCol).value = startedAt;
      });
    }
    const td = wb.getWorksheet('TestData');
    if (td) {
      const setCol = column(td, 'Data Set');
      const runCol = column(td, 'Run');
      const resCol = column(td, 'Result');
      const bugCol = column(td, 'Bug');
      const lastCol = column(td, 'Last Run');
      td.eachRow((row, i) => {
        if (i === 1) return;
        const r = runs.find((x) => x.case.dataSet === String(row.getCell(setCol).value ?? '').trim()
          && String(x.case.run) === String(row.getCell(runCol).value ?? '').trim());
        if (!r) return;
        row.getCell(resCol).value = label(r.status);
        paint(row.getCell(resCol), r.status);
        row.getCell(bugCol).value = r.mine.map((b) => b.id).join(', ');
        row.getCell(lastCol).value = startedAt;
      });
    }
    await wb.xlsx.writeFile(file);
    done.push(file);
  }
  return done;
}
