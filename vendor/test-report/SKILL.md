---
name: test-report
description: Use when a WebdriverIO + Appium test project needs a bug report with red-box evidence, bug cards, test case statuses (Passed / Failed / Blocked / Skipped / Not Run), Excel write-back or Asana logging; when adding a spec to that report; when changing the report code; or when regenerating the report without re-running tests.
---

# Test report

## Overview
Every failed check becomes a bug with a screenshot that has a red box around the element that failed.
- Results are written back into the test case xlsx file.
- The report is one HTML file: `reports/bug-report.html`.

The code in `assets/src/` (this folder) is the master copy. Projects get it through `scripts/install.sh`. The agreed rules are in `reference.md`; read it before changing behaviour.

## Install into a project
1. Run `bash scripts/install.sh <project>`. It copies `src/report/*` (with the UI files in `src/report/ui/`) and `src/utils/{evidence,softAssert}.js`.
   - Use `--check` to compare the project's copy with the skill. Use `--force` to overwrite the utils files too.
2. Install the dev dependencies: `npm i -D pngjs exceljs @wdio/reporter`. You need macOS, because the report uses `sips`.
3. Add the config below to the wdio config.

## Config
```js
import { beforeEachTest, buildHtml, writeEnv, writeHookFailure, writePlanned, writeResult } from '../src/report/hooks.js';
import SkipReporter from '../src/report/skipReporter.js';
const REPORTS = path.join(ROOT, 'reports');
const startedAt = new Date();
// in config:
reporters: [['spec', { realtimeReporting: true }], [SkipReporter, { resultsDir: path.join(REPORTS, 'results') }]],
onPrepare() { for (const d of ['screenshots', 'results', 'evidence', 'bug-report.html', 'test-results.xlsx']) fs.rmSync(path.join(REPORTS, d), { recursive: true, force: true }); },
before() { writeEnv(REPORTS); },
beforeTest() { beforeEachTest(); },
async afterTest(test, ctx, result) {
  let shot = null;
  if (!result.passed) { shot = path.join(REPORTS, 'screenshots', `${Date.now()}.png`); fs.mkdirSync(path.dirname(shot), { recursive: true }); await browser.saveScreenshot(shot).catch(() => { shot = null; }); }
  writeResult(REPORTS, test, result, shot);
},
afterHook(test, ctx, result) { writeHookFailure(REPORTS, test, result); },
after() { writePlanned(REPORTS); },
async onComplete() { await buildHtml(REPORTS, startedAt, { appName: '<app name>', open: true }); },
```
The report is built automatically when every wdio run ends (`onComplete`), and `open: true` opens it in the browser. It does not open on CI or when `REPORT_OPEN=0` is set.
For a non-iOS app, set the `APP_VERSION` environment variable. On iOS the version is read from the app's `Info.plist`.

## Instrumenting a spec
1. `FILE = testcaseFile('<name>.xlsx')`, then `loadTestcases(FILE)`. The file has a TestCases sheet and a TestData sheet.
2. For each data row:
   - call `planTest({ suite, title, case: { id, title, file: FILE, dataSet, run } })`;
   - then `it(title, …)`.

   Without `planTest`, the row cannot be marked Not Run and nothing is written back to Excel.
3. At the start of the test, call `setCase({ id, title, priority, feature, file, dataSet, run, precondition, steps, expected })`. Use `fillTemplate` to fill in the lines.
4. Read the value from the app. Then call `snapshot('<screen>', { key: selectorOfTheCheckedElement }, { key: anchor })` on that same screen, before navigating away.
   - `anchor` (optional) is for "is displayed" checks: the element the checked one should appear right under, e.g. the Password field for "Password must be at least 8 characters", the submit button for a link below it. A selector or an async function returning the element.
   - If the checked element is missing, the report boxes the spot under the anchor with a dashed red frame, and quotes any text found there in Actual.
5. For each check, call `softAssert().eq(step, label, actual, expected, evidence[key], { keyword, target, value, screen })`. Finish with `assertAll()`.
   - The last argument lets the report word the bug naturally (see "Bug fields" in reference.md). Without it the report falls back to the label.
   - Log every action with `logStep({ kind: 'Action', step, screen, keyword, target, value, ok })` so Steps to Reproduce follow the real order.

## Rules for checks
- **The label names what is checked, never the data.** Same failure on other data sets → one representative bug.
- **The evidence selector is the element being checked.** If it is missing, the report shows "không tìm thấy phần tử" with no box. Never box a neighbouring element.
- **Label keywords drive classification:** `enable/disable` → state, `màn/sheet` → screen, `chọn/bật` → selection. A visibility boolean → UI.
- **Navigation errors and timeouts are not checks.** Let them throw; the test becomes Blocked.

## Quick reference
| Task | How |
|---|---|
| Run + report | wdio run → `reports/bug-report.html`, `reports/test-results.xlsx`, write-back into the case xlsx |
| Rebuild the report only (no test run, no xlsx write) | `node --input-type=module -e "const {buildHtml}=await import('./src/report/hooks.js'); await buildHtml('reports', new Date(), { sync: false, appName: '<app name>' })"` |
| Change the report code | Edit `assets/src/` in this skill, then `bash scripts/install.sh <project>` for every project that uses it |

## Common mistakes
| Mistake | Fix |
|---|---|
| Page JS written inside html.js | Put it in `assets/src/report/ui/*.js` (embedded verbatim, plain JS). Then check the generated `<script>` with `new Function(...)` |
| Running wdio just to re-render the report | `onPrepare` wipes `reports/results`. Use `buildHtml(..., { sync: false })` instead |
| Classifying on formatted text | `classify()` takes the raw `actualRaw` / `expectedRaw` values |
| Editing `src/report/` only inside one project | The other projects drift from it. Edit the skill copy and reinstall |
| Logging every mismatch to Asana | A mismatch means the app differs from the xlsx. Confirm the expected data first |
