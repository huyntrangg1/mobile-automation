import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = async () => (await promisify(execFile)('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).stdout;

// Simulator iOS khả dụng, máy đang bật (Booted) lên đầu
export async function listSimulators(execImpl = run) {
  const { devices } = JSON.parse(await execImpl());
  const out = [];
  for (const [runtime, list] of Object.entries(devices)) {
    const m = runtime.match(/SimRuntime\.iOS-(\d+)-(\d+)/);
    if (!m) continue;
    for (const d of list) {
      if (d.isAvailable === false) continue;
      out.push({ udid: d.udid, name: d.name, os: `iOS ${m[1]}.${m[2]}`, booted: d.state === 'Booted' });
    }
  }
  return out.sort((a, b) => Number(b.booted) - Number(a.booted));
}
