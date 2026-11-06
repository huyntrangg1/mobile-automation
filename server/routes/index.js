// Mỗi router: (ctx) => express.Router()
import device from './device.js';
import apps from './apps.js';
import locators from './locators.js';
import testcases from './testcases.js';
import manual from './manual.js';
import scripts from './scripts.js';
import runs from './runs.js';
import upload from './upload.js';
import smoke from './smoke.js';

export const ROUTERS = [device, apps, locators, testcases, manual, scripts, runs, upload, smoke];
