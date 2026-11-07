import { realDeps } from './runs/preflight.js';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createLock } from './lock.js';
import { emit } from './events.js';
import { DATA } from './paths.js';
import { ROUTERS } from './routes/index.js';
import { createScreenMap } from './locators/screenMap.js';
import { createCaptures } from './locators/record.js';
import { openSession, attachSession } from './device/session.js';
import { exploreLoop } from './locators/explore.js';
import { createGenerator } from './scripts/generate.js';
import { createConverter } from './testcases/convert/converter.js';
import { createRunner } from './runs/runner.js';
import { createTryLive } from './locators/tryLive.js';
import { createSmoke } from './smoke/run.js';
import { lanUrls } from './net/lan.js';

const store = createStore(DATA);
const lock = createLock();
lock.recover(store);
const map = createScreenMap({ store, dataDir: DATA });
// Bộ đọc page source có thể giữ thêm loại phần tử ở bản mới → bổ sung cho các màn đã lưu, sinh lại locators/map.js
for (const app of store.list('apps')) if (map.refreshElements(app.id) && app.workspace) { try { map.exportLocators(app.id); } catch {} }
const captures = createCaptures({ store, lock, emit, map, openSession, attachSession, loops: { explore: (...a) => exploreLoop(...a) } });
const generator = createGenerator({ store, map, emit });
const converter = createConverter({ store, map, emit, generator, dataDir: DATA });
const runner = createRunner({ store, lock, emit, dataDir: DATA, scriptPath: generator.scriptPath, preflightDeps: ({ specPath, build }) => realDeps({ specPath, build }) });
const tryLive = createTryLive({ store, lock, dataDir: DATA });
const smoke = createSmoke({ store, lock, emit, dataDir: DATA });
smoke.recover();
const ctx = { store, lock, emit, map, captures, generator, converter, runner, tryLive, smoke };
const PORT = Number(process.env.PORT || 5178);
// HOST=0.0.0.0 (mặc định) → máy khác trong mạng LAN mở được, không cần đăng nhập.
// HOST=127.0.0.1 → chỉ máy này như bản demo cũ.
const HOST = process.env.HOST || '0.0.0.0';
// Lỗi lọt ra ngoài không được làm sập server đang giữ simulator
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
createApp(ctx, ROUTERS).listen(PORT, HOST, () => {
  console.log(`QA Pipeline: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const u of lanUrls(PORT)) console.log(`  Team trong mạng LAN: ${u}`);
});
