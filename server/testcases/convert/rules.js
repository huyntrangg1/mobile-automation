// Lấy một mục của SKILL.md (vendor) làm quy tắc đưa vào prompt — đọc lúc chạy để bộ quy tắc chỉ có một bản (skill), không chép vào code.
import fs from 'node:fs';
import path from 'node:path';
import { SELECT_AUTOMATION_VENDOR } from '../../paths.js';

// Mục = dòng tiêu đề (# …) có chứa `title` + mọi dòng sau đó tới tiêu đề cùng cấp hoặc cao hơn
export function rulesFrom(title) {
  const lines = fs.readFileSync(path.join(SELECT_AUTOMATION_VENDOR, 'SKILL.md'), 'utf8').split('\n');
  const head = (l) => l.match(/^(#{1,6})\s+(.*)$/);
  const start = lines.findIndex((l) => head(l) && head(l)[2].toLowerCase().includes(title.toLowerCase()));
  if (start < 0) throw new Error(`Không thấy mục "${title}" trong SKILL.md của skill select-automation-testcases`);
  const level = head(lines[start])[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = head(lines[i]);
    if (h && h[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}
