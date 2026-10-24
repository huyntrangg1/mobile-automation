// Mỗi router: (ctx) => express.Router()
import device from './device.js';
import apps from './apps.js';
import locators from './locators.js';
import testcases from './testcases.js';
import scripts from './scripts.js';
import runs from './runs.js';

export const ROUTERS = [device, apps, locators, testcases, scripts, runs];
