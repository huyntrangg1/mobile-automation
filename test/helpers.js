import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-'));
