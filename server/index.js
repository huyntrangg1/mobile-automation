import { createApp } from './app.js';
import { createStore } from './store.js';
import { createLock } from './lock.js';
import { emit } from './events.js';
import { DATA } from './paths.js';
import { ROUTERS } from './routes/index.js';
import { createScreenMap } from './locators/screenMap.js';
import { createCaptures } from './locators/record.js';
import { openSession } from './device/session.js';
import { exploreLoop } from './locators/explore.js';
import { createGenerator } from './scripts/generate.js';
import { createRunner } from './runs/runner.js';

const store = createStore(DATA);
const lock = createLock();
lock.recover(store);
const map = createScreenMap({ store, dataDir: DATA });
const captures = createCaptures({ store, lock, emit, map, openSession, loops: { explore: (...a) => exploreLoop(...a) } });
const generator = createGenerator({ store, map, emit });
const runner = createRunner({ store, lock, emit, dataDir: DATA, scriptPath: generator.scriptPath });
const ctx = { store, lock, emit, map, captures, generator, runner };
const PORT = Number(process.env.PORT || 5178);
// Lỗi lọt ra ngoài không được làm sập server đang giữ simulator
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
// Chỉ máy này truy cập được (API chạy code test và đọc biến môi trường của app)
createApp(ctx, ROUTERS).listen(PORT, '127.0.0.1', () => console.log(`QA Pipeline demo: http://localhost:${PORT}`));
