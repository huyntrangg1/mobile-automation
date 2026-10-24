// Kiểm tra nhanh: mở IK Fitness qua openSession, in vài phần tử đầu.
import { openSession } from '../server/device/session.js';
import { parseElements, toPrompt } from '../server/locators/pageSource.js';
import { IK_FITNESS } from '../server/paths.js';

const s = await openSession({ udid: process.env.UDID || 'C8F5C490-7394-47AD-A430-42EB9424EAB1', appPath: `${IK_FITNESS}/apps/ikFitnessHeathyApp.app`, bundleId: 'com.begamob.fitness' });
try {
  await s.driver.pause(3000);
  console.log(toPrompt(parseElements(await s.driver.getPageSource())).split('\n').slice(0, 8).join('\n'));
} finally { await s.close(); }
