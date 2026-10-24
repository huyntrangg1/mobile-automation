// Quy đổi đơn vị và đọc giá trị dạng chữ trong test case / TestData.
import { toNumber } from './ui.js';

const round1 = (n) => Math.round(n * 10) / 10;

// "5 ft 3 in" → 160 (cm, làm tròn gần nhất)
export function ftToCm(text) {
  const m = String(text).match(/(\d+)\s*ft\s*(\d+)\s*in/);
  if (!m) throw new Error(`Chiều cao "${text}" không đúng dạng "<ft> ft <in> in"`);
  return Math.round((Number(m[1]) * 12 + Number(m[2])) * 2.54);
}

// 132.3 → 60.0 (kg, 1 chữ số thập phân như thước Weight)
export const lbToKg = (lb) => round1(Number(lb) * 0.45359237);

// "1,498 kcal" → { n: 1498, unit: 'kcal' }
export function parseAmount(text) {
  const [n, unit] = String(text).trim().split(/\s+/);
  return { n: toNumber(n), unit };
}
