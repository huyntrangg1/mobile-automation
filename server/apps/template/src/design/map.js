// Màn cần so với Figma (tool ghi file DESIGN_MAP trước mỗi Run): { token?, tolerance?, screens: { "<tên màn>": { url, ignore?, tolerance? } } }
import fs from 'node:fs';

let cache = null;
export function designMap(file = process.env.DESIGN_MAP) {
  if (cache && cache.file === file) return cache.screens;
  let screens = {};
  try { screens = file ? JSON.parse(fs.readFileSync(file, 'utf8')).screens || {} : {}; } catch { screens = {}; }
  cache = { file, screens };
  return screens;
}
// Tên file theo tên màn (bỏ dấu, ký tự lạ)
export const slug = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'screen';
