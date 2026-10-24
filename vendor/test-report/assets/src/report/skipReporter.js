// Reporter phụ: hook afterTest của WebdriverIO không chạy cho test bị skip (it.skip / describe.skip / this.skip()),
// nên ghi trạng thái Skipped vào reports/results/ từ sự kiện của reporter.
import fs from 'node:fs';
import path from 'node:path';
import WDIOReporter from '@wdio/reporter';

export default class SkipReporter extends WDIOReporter {
  constructor(options) {
    super({ ...options, stdout: false });
    this.dir = options.resultsDir;
  }

  onTestSkip(test) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${Date.now()}-${process.pid}-skip-${Math.random().toString(36).slice(2, 7)}.json`), JSON.stringify({
      suite: test.parent, title: test.title, passed: false, status: 'skipped', duration: 0, error: null, case: null, bugs: [], failShot: null,
    }));
  }
}
