// Dấu vết build: đổi khi cài build mới kể cả khi version không tăng.
//   iOS .app: hash _CodeSignature/CodeResources (chứa hash mọi file trong bundle) + Info.plist; .apk / không ký: kích thước + giờ sửa
//   at = lúc build có trong workspace (giờ sửa Info.plist / file apk). Không đọc được → null
// Dùng chung: Run (BUILD_STAMP của sơ đồ màn), lấy locator (ghi cạnh sơ đồ màn), chạy thử luồng chung khi chuyển đổi
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function buildStamp(appPath) {
  try {
    const dir = fs.statSync(appPath).isDirectory();
    const main = dir ? path.join(appPath, 'Info.plist') : appPath;
    const st = fs.statSync(main);
    const parts = dir ? [path.join(appPath, '_CodeSignature/CodeResources'), main].filter((f) => fs.existsSync(f)) : [];
    const stamp = parts.length
      ? crypto.createHash('sha1').update(Buffer.concat(parts.map((f) => fs.readFileSync(f)))).digest('hex').slice(0, 12)
      : `${st.size}-${Math.round(st.mtimeMs)}`;
    return { stamp, at: new Date(st.mtimeMs).toISOString() };
  } catch {
    return null;
  }
}
