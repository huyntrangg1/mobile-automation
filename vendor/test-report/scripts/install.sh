#!/usr/bin/env bash
# Cài / cập nhật mã nguồn test report từ skill vào 1 dự án WebdriverIO.
#   bash scripts/install.sh <thư mục dự án>           cài / cập nhật src/report/*, thêm src/utils/{evidence,softAssert}.js nếu chưa có
#   bash scripts/install.sh <thư mục dự án> --force   ghi đè cả src/utils/{evidence,softAssert}.js
#   bash scripts/install.sh <thư mục dự án> --check   chỉ so sánh bản trong dự án với bản trong skill
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SKILL_DIR/assets/src"
PROJECT="${1:?Thiếu thư mục dự án}"
MODE="${2:-}"
[ -f "$PROJECT/package.json" ] || { echo "Không thấy package.json trong $PROJECT"; exit 1; }

if [ "$MODE" = "--check" ]; then
  status=0
  for f in report/annotate.js report/classify.js report/collector.js report/excel.js report/hooks.js report/html.js report/phrasing.js report/skipReporter.js report/ui/report.css report/ui/page.js report/ui/asana.js report/ui/dashboard.js utils/evidence.js utils/softAssert.js; do
    if [ ! -f "$PROJECT/src/$f" ]; then echo "THIẾU   src/$f"; status=1
    elif ! cmp -s "$SRC/$f" "$PROJECT/src/$f"; then echo "KHÁC    src/$f"; status=1
    else echo "GIỐNG   src/$f"; fi
  done
  exit $status
fi

mkdir -p "$PROJECT/src/report/ui" "$PROJECT/src/utils"
cp "$SRC"/report/*.js "$PROJECT/src/report/"
cp "$SRC"/report/ui/* "$PROJECT/src/report/ui/"
echo "Đã cài src/report/* (kèm giao diện src/report/ui/*)"
for f in evidence.js softAssert.js; do
  if [ -f "$PROJECT/src/utils/$f" ] && [ "$MODE" != "--force" ]; then
    echo "Giữ nguyên src/utils/$f (đã có — dùng --force để ghi đè)"
  else
    cp "$SRC/utils/$f" "$PROJECT/src/utils/$f"
    echo "Đã cài src/utils/$f"
  fi
done

cat <<'MSG'

Việc còn lại trong dự án:
  1. npm i -D pngjs exceljs @wdio/reporter      (cần macOS: dùng sips để thu nhỏ ảnh)
  2. Thêm hook + reporter vào wdio config (xem mục "Config" trong SKILL.md)
  3. Gắn spec theo mục "Instrumenting a spec" trong SKILL.md
MSG
