// Đánh giá máy có chạy được QA Pipeline không. probes = các hàm hỏi máy (thật ở doctor.js, giả ở test).
const safe = async (fn) => { try { return await fn(); } catch { return undefined; } };
const major = (v) => Number(String(v || '').replace(/^v/, '').split('.')[0]) || 0;

export async function runChecks(p) {
  const items = [];
  const add = (group, id, label, status, detail = '', fix = '') => items.push({ group, id, label, status, detail, fix });

  // ---- Bắt buộc
  const node = await safe(p.node);
  add('Chung', 'node', 'Node.js ≥ 20', major(node) >= 20 ? 'ok' : 'fail', node ? `v${String(node).replace(/^v/, '')}` : 'không thấy', 'Cài Node 20 trở lên: brew install node (hoặc nvm install 20)');
  const os = await safe(p.os);
  add('Chung', 'os', 'macOS', os === 'darwin' ? 'ok' : 'fail', os || '?', 'Tool chạy simulator iOS / emulator qua Xcode và Android SDK trên macOS');
  const deps = await safe(p.deps);
  add('Chung', 'deps', 'Thư viện của tool (npm install)', deps ? 'ok' : 'fail', deps ? '' : 'chưa cài', 'Chạy: npm install (trong thư mục qa-pipeline-demo)');
  const appium = await safe(p.appium);
  add('Chung', 'appium', 'Appium 2 trở lên', appium && major(appium) >= 2 ? 'ok' : 'fail', appium ? `v${appium}` : 'không thấy', 'Cài: npm install -g appium');
  const claude = await safe(p.claude);
  add('Chung', 'claude', 'Claude Code đã đăng nhập (gen script, tự khám phá)', claude?.loggedIn ? 'ok' : 'fail',
    claude ? (claude.loggedIn ? `v${claude.version}` : `v${claude.version} — chưa đăng nhập${claude.error ? `: ${claude.error}` : ''}`) : 'không thấy lệnh claude',
    claude ? 'Đăng nhập: chạy claude trong terminal rồi gõ /login' : 'Cài Claude Code: npm install -g @anthropic-ai/claude-code, rồi chạy claude và /login');
  const tr = await safe(p.testReport);
  add('Chung', 'test-report', 'Report chung (vendor/test-report)', tr ? 'ok' : 'fail', tr ? '' : 'không thấy', 'Thiếu thư mục vendor/test-report — clone lại repo');
  const sync = await safe(p.reportSync);
  if (sync === 'diff') add('Chung', 'report-sync', 'Report trong tool khớp skill gốc (../.claude/skills/test-report)', 'warn', 'đang khác', 'Chạy: npm run sync-report (rồi Cài đặt app → Chuẩn bị lại cho từng app)');
  else if (sync === 'same') add('Chung', 'report-sync', 'Report trong tool khớp skill gốc (../.claude/skills/test-report)', 'ok');
  const ikf = await safe(p.ikFitness);
  add('Chung', 'ik-fitness', 'Helper pack IK Fitness (../ik-fitness, tuỳ chọn)', ikf ? 'ok' : 'warn', ikf ? '' : 'không có — app khác vẫn chạy bình thường', 'Chỉ cần khi test app IK Fitness: đặt project ik-fitness cạnh thư mục tool');

  const drivers = (await safe(p.drivers)) || [];

  // ---- iOS (tuỳ chọn)
  const xcode = await safe(p.xcode);
  const sims = (await safe(p.simulators)) || 0;
  const xcui = drivers.includes('xcuitest');
  add('iOS', 'xcode', 'Xcode + simctl', xcode ? 'ok' : 'warn', xcode || 'không thấy', 'Cài Xcode từ App Store, mở một lần, rồi: xcode-select --install');
  add('iOS', 'simulators', 'iOS Simulator', sims > 0 ? 'ok' : 'warn', `${sims} simulator`, 'Xcode → Settings → Platforms → tải iOS Simulator');
  add('iOS', 'driver-xcuitest', 'Appium driver xcuitest', xcui ? 'ok' : 'warn', xcui ? '' : 'chưa cài', 'Cài: appium driver install xcuitest');
  const iosReady = Boolean(xcode && sims > 0 && xcui);

  // ---- Android (tuỳ chọn)
  const sdk = await safe(p.androidSdk);
  const adb = await safe(p.adb);
  const aapt2 = await safe(p.aapt2);
  const ua2 = drivers.includes('uiautomator2');
  const devs = (await safe(p.androidDevices)) || 0;
  add('Android', 'android-sdk', 'Android SDK (ANDROID_HOME)', sdk ? 'ok' : 'warn', sdk || 'không thấy', 'Cài Android Studio (SDK ở ~/Library/Android/sdk) hoặc đặt ANDROID_HOME');
  add('Android', 'adb', 'adb (platform-tools)', adb ? 'ok' : 'warn', adb ? '' : 'không thấy', 'Android Studio → SDK Manager → SDK Tools → Android SDK Platform-Tools');
  add('Android', 'aapt2', 'aapt2 (build-tools, đọc file .apk)', aapt2 ? 'ok' : 'warn', aapt2 ? '' : 'không thấy', 'Android Studio → SDK Manager → SDK Tools → Android SDK Build-Tools');
  add('Android', 'driver-uiautomator2', 'Appium driver uiautomator2', ua2 ? 'ok' : 'warn', ua2 ? '' : 'chưa cài', 'Cài: appium driver install uiautomator2');
  const androidReady = Boolean(sdk && adb && aapt2 && ua2);
  add('Android', 'android-devices', 'Emulator / máy Android đang bật', devs > 0 ? 'ok' : 'warn', `${devs} thiết bị`, 'Mở emulator: Android Studio → Device Manager → ▶, hoặc cắm máy thật bật USB debugging');

  if (!iosReady && !androidReady) add('Chung', 'platform', 'Ít nhất một nền tảng sẵn sàng (iOS hoặc Android)', 'fail', 'chưa có', 'Làm theo các mục iOS hoặc Android bên dưới');
  return { ok: !items.some((i) => i.status === 'fail'), platforms: { iOS: iosReady, Android: androidReady }, items };
}
