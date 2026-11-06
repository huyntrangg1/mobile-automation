// Kiểm file .json do plugin "QA Pipeline – Export frame" xuất: mỗi nhóm dữ liệu báo
//   ✓ ok   — có và đầy đủ
//   – none — design không có thứ này (bình thường, không phải lỗi)
//   ! warn — cần chú ý (vd chỉ có 1 frame)
//   ✗ bad  — design CÓ nhưng file thiếu / hỏng (lỗi thật của plugin hoặc file)
// Dùng: node scripts/check-figma-export.js <file.json>
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const walk = (n, fn) => { fn(n); for (const c of n.children || []) walk(c, fn); };
const hasNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function checkExport(data) {
  const frames = data.frames || [];
  const nodes = [];
  const paints = [];
  const effects = [];
  const refs = { variables: {}, styles: {}, components: {} };
  for (const f of frames) {
    walk(f.node, (n) => {
      nodes.push(n);
      for (const p of [...(n.fills || []), ...(n.strokes || [])]) paints.push(p);
      for (const e of n.effects || []) effects.push(e);
    });
    for (const k of Object.keys(refs)) Object.assign(refs[k], f.node.refs?.[k] || {});
  }
  const rows = [];
  const add = (key, label, status, detail) => rows.push({ key, label, status, detail });
  // none khi không có gì để kiểm; bad khi có nhưng thiếu; ok khi đủ
  const verdict = (key, label, total, good, noneText, okText, badText) => {
    if (!total) return add(key, label, 'none', noneText);
    return good === total ? add(key, label, 'ok', okText) : add(key, label, 'bad', badText);
  };

  add('version', 'Định dạng file', data.version === 3 ? 'ok' : 'bad', data.version === 3 ? 'version 3' : `version ${data.version} (cần xuất lại bằng plugin bản mới để có trường mới)`);
  add('frames', 'Số frame', frames.length > 1 ? 'ok' : 'warn', `${frames.length} frame${frames.length > 1 ? '' : ' (chỉ 1 frame: chọn thêm frame / cả Section nếu cần so nhiều màn)'}`);

  const auto = nodes.filter((n) => n.layoutMode);
  const autoOk = auto.filter((n) => hasNum(n.itemSpacing) || hasNum(n.paddingLeft) || hasNum(n.paddingTop)).length;
  verdict('autolayout', 'Auto layout (gap, padding)', auto.length, autoOk, 'design không có auto layout', `${auto.length} node, đủ gap / padding`, `${auto.length - autoOk}/${auto.length} node auto layout thiếu gap / padding`);

  const texts = nodes.filter((n) => n.type === 'TEXT');
  const lhOk = texts.filter((n) => n.style && n.style.lineHeightUnit).length;
  verdict('lineheight', 'Line-height, letter-spacing', texts.length, lhOk, 'design không có chữ', `${texts.length} text đều có line-height`, `${texts.length - lhOk}/${texts.length} text thiếu line-height`);

  const seg = texts.filter((n) => Array.isArray(n.styleSegments) && n.styleSegments.length > 1).length;
  add('styleSegments', 'Chữ nhiều style trong một layer', seg ? 'ok' : 'none', seg ? `${seg} text có styleSegments` : 'không thấy text nào nhiều style (bình thường nếu design không có; muốn kiểm thì tạo một text có hai kiểu chữ rồi xuất lại)');

  const grads = paints.filter((p) => /^GRADIENT_/.test(p.type));
  const gradOk = grads.filter((p) => Array.isArray(p.gradientStops) && p.gradientStops.length >= 2 && Array.isArray(p.gradientTransform)).length;
  verdict('gradient', 'Gradient (điểm màu, vị trí)', grads.length, gradOk, 'design không có gradient', `${grads.length} gradient đều có điểm màu + vị trí + ma trận`, `${grads.length - gradOk}/${grads.length} gradient thiếu điểm màu`);

  const shadows = effects.filter((e) => /SHADOW/.test(e.type));
  const spreadOk = shadows.filter((e) => hasNum(e.spread)).length;
  verdict('spread', 'Bóng (spread)', shadows.length, spreadOk, 'design không có bóng', `${shadows.length} bóng đều có spread`, `${shadows.length - spreadOk}/${shadows.length} bóng thiếu spread`);

  const hiddenSelf = nodes.filter((n) => n.visible === false).length;
  const hiddenAnc = nodes.filter((n) => n.hiddenByAncestor).length;
  add('hidden', 'Layer ẩn', hiddenSelf || hiddenAnc ? 'ok' : 'none', hiddenSelf || hiddenAnc ? `${hiddenSelf} ẩn, ${hiddenAnc} ẩn do cha` : 'design không có layer ẩn');

  const bound = nodes.filter((n) => n.boundVariables);
  const varRefs = Object.values(refs.variables);
  verdict('variables', 'Biến (tên, giá trị từng mode)', bound.length, varRefs.length && varRefs.every(Boolean) ? bound.length : 0, 'design không gắn biến', `${bound.length} node gắn biến, ${varRefs.length} biến có tên + giá trị`, 'có node gắn biến nhưng bảng refs.variables thiếu hoặc có biến không tra được (null)');

  const styled = nodes.filter((n) => ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId'].some((k) => n[k]));
  const styleRefs = Object.values(refs.styles);
  verdict('styles', 'Style (tên)', styled.length, styleRefs.length && styleRefs.every(Boolean) ? styled.length : 0, 'design không dùng style', `${styled.length} node dùng style, ${styleRefs.length} style có tên`, 'có node dùng style nhưng refs.styles thiếu hoặc có style không tra được (null)');

  const inst = nodes.filter((n) => n.type === 'INSTANCE');
  const compRefs = Object.values(refs.components);
  const instOk = inst.filter((n) => n.componentId).length;
  verdict('components', 'Component (tên, overrides)', inst.length, instOk === inst.length && compRefs.length && compRefs.every(Boolean) ? inst.length : 0, 'design không có instance', `${inst.length} instance, ${compRefs.length} component có tên, ${inst.filter((n) => n.overrides).length} có overrides`, 'có instance nhưng thiếu componentId hoặc refs.components');

  const rx = nodes.reduce((s, n) => s + (n.reactions?.length || 0), 0);
  add('reactions', 'Prototype (điểm đến, chuyển cảnh)', rx ? 'ok' : 'none', rx ? `${rx} chuyển cảnh` : 'design không có prototype');
  return rows;
}

const ICON = { ok: '✓', none: '–', warn: '!', bad: '✗' };
const main = () => {
  const file = process.argv[2];
  if (!file) { console.error('Dùng: node scripts/check-figma-export.js <file.json>'); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = checkExport(data);
  console.log(`${file}  (${data.file || '?'} / ${data.page || '?'})`);
  for (const r of rows) console.log(` ${ICON[r.status]} ${r.label.padEnd(36)} ${r.detail}`);
  const bad = rows.filter((r) => r.status === 'bad').length;
  console.log(bad ? `\n${bad} mục LỖI: design có nhưng file thiếu.` : '\nKhông có mục lỗi. Mục "–" là design không có thứ đó (bình thường).');
  process.exit(bad ? 1 : 0);
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
