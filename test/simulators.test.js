import test from 'node:test';
import assert from 'node:assert/strict';
import { listSimulators } from '../server/device/simulators.js';

const SIMCTL = JSON.stringify({ devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
    { udid: 'C8F5', name: 'iPhone 17 Pro Max', state: 'Booted', isAvailable: true },
    { udid: 'A111', name: 'iPhone 16e', state: 'Shutdown', isAvailable: true },
  ],
  'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [{ udid: 'W1', name: 'Apple Watch', state: 'Shutdown', isAvailable: true }],
} });

test('chỉ iOS, có os, booted lên đầu', async () => {
  const list = await listSimulators(async () => SIMCTL);
  assert.deepEqual(list, [
    { udid: 'C8F5', name: 'iPhone 17 Pro Max', os: 'iOS 26.5', booted: true },
    { udid: 'A111', name: 'iPhone 16e', os: 'iOS 26.5', booted: false },
  ]);
});
