// Bảng sửa locator khi chạy (chế độ sửa tay: "Fix script & go on") — workspace/locators/overrides.json
//   { "<màn Excel>|<target>": { locator, element, at } } — bước chung `k` tra bảng này trước locator trong script
import fs from 'node:fs';
import path from 'node:path';
import { checkLocator } from '../locators/locatorFormat.js';

const fileOf = (workspace) => path.join(workspace, 'locators/overrides.json');

function load(workspace) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(workspace), 'utf8')) || {};
  } catch {
    return {};
  }
}

function save(workspace, all) {
  fs.mkdirSync(path.dirname(fileOf(workspace)), { recursive: true });
  fs.writeFileSync(fileOf(workspace), JSON.stringify(all, null, 2));
}

// key → locator
export const readOverrides = (workspace) => Object.fromEntries(Object.entries(load(workspace)).map(([k, v]) => [k, v?.locator]).filter(([, l]) => l));

export function saveOverride(workspace, key, { locator, element = '' }) {
  save(workspace, { ...load(workspace), [key]: { locator, element, at: new Date().toISOString() } });
}

// Sửa locator của dòng đã có (giữ phần tử đã chọn)
export function updateOverride(workspace, key, locator) {
  const all = load(workspace);
  if (!all[key]) throw Object.assign(new Error('Không có dòng sửa này'), { status: 404 });
  save(workspace, { ...all, [key]: { ...all[key], locator: checkLocator(locator), at: new Date().toISOString() } });
}

export function removeOverride(workspace, key) {
  const all = load(workspace);
  delete all[key];
  save(workspace, all);
}

export function listOverrides(workspace) {
  return Object.entries(load(workspace)).map(([key, v]) => {
    const i = key.indexOf('|');
    return { key, screen: key.slice(0, i), target: key.slice(i + 1), locator: v?.locator, element: v?.element || '', at: v?.at || null };
  });
}
