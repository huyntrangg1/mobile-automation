// Dạng locator hợp lệ khi tester sửa / thêm tay: ~id, -ios predicate string:…, -ios class chain:…, android=…, //xpath, id=…,
// point:<x>,<y> (vị trí theo tỉ lệ màn hình 0..1 — chỉ dùng cho Tap)
const FORMS = [/^~.+/, /^-ios predicate string:.+/, /^-ios class chain:.+/, /^android=.+/, /^\/\/.+/, /^id=.+/];
const POINT = /^point:(\d*\.?\d+),(\d*\.?\d+)$/;

export function checkLocator(locator) {
  const s = String(locator ?? '').trim();
  const p = s.match(POINT);
  const ok = p ? Number(p[1]) <= 1 && Number(p[2]) <= 1 : FORMS.some((re) => re.test(s));
  if (!ok) throw Object.assign(new Error(`Locator không đúng dạng: "${s}" — dùng ~id, -ios predicate string:…, -ios class chain:…, android=…, //xpath hoặc point:x,y (0..1)`), { status: 400 });
  return s;
}
