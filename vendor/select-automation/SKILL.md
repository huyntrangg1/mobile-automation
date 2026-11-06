---
name: select-automation-testcases
description: 'Use when turning a full manual test case workbook (kit v2 xlsx with a "Test Case #" header, e.g. testcase/<ten-du-an>/<feature>.xlsx) into automation test cases, or when small cases each reinstall the app and should run back-to-back instead.'
---
# Select automation test cases

Turn a manual workbook into automation v2 files: pick the cases, order them to run back-to-back, write each as keyword rows.

- Every selected TC stays its own automation TC, same ID, own checks. Never merge TCs.
- One output xlsx per feature sheet. Reinstall the app only when a TC needs a fresh state.
- The file is written **before the app exists**: names and copy come from the design, PRD and Q&A, never from the running app.
- Stop after writing the files; the user reviews them. No spec code.

Rules marked ✱ are enforced by `write.mjs`.

## Setup

Node 18+. `<skill>` = this folder. If `<skill>/node_modules/exceljs` is missing, run `npm install --prefix <skill>` once.

## Steps

### 1. Extract

`node <skill>/scripts/extract.mjs <kit.xlsx> --out <scratch>/cases.json` reads every functional sheet (RTM sheets skipped) and selects every High and Medium case plus Low cases with Test Type Positive. Never re-filter by hand.

### 2. Read every selected case

Scenario, steps, expected, pre-condition.

### 3. Set aside the manual cases (each with a reason)

- Third-party popups: Google / Apple OAuth.
- Outside the app under test: a second device or app (watch, system Settings, Health, an incoming call, the store review popup), content of a web page (only its URL is checked, `Verify external URL`).
- Network off on iOS (Android: `Set network`, Platform Android).
- In-app purchase / store payment (needs a sandbox account).
- A specific device model, screen size or OS version: the runner only filters by platform.
- The TC's main Expected cannot be checked in the app (e.g. a permission's state in Settings). Do not automate only the side steps; name the TC that already covers the flow part.
- Colour, animation, icons and pictures with no text. Text drawn inside a picture is automated (OCR, step 5).
- A step no keyword can express: reason `Thiếu keyword: <what is missing>`.
- Blocked by an open Q&A, or written for a design that will not ship.

UI / UX TCs are not set aside as a group: automate the readable parts (copy, presence, counts, selection, layout) and say in the report which parts stay manual.

**Q&A.** Before setting a case aside for an open Q&A or a missing value (text, locator), ask the user: every open point, with AskUserQuestion (4 per call, several calls if needed). Record answers in the Q&A file as `Đã chốt (user, <date>): …`. Expected results follow the spec even when the app behaves differently. A later decision (closed Q&A, bug thread, PO) replaces the manual Expected: use it, record it in Q&A as `Đã chốt`, and name it in the report so the manual file gets updated.

### 4. Order the TCs into runs

One feature sheet at a time, in the app's screen order. Each TC starts where the previous one ended.

- **`fresh: true` (reinstall)** only when the state cannot be reached from there: never onboarded, account exists or still logged in, permission already asked, kill and relaunch, data that cannot be undone. The first TC of a sheet is always fresh ✱. Data the app can change back (Back, re-select, edit) stays in the run.
- **Keep failures local.** A Blocked TC blocks the rest of its run (a Failed one does not).
  - A run is one group of adjacent screens, at most 10 TCs ✱.
  - A TC whose own rows contain a risky step goes last in its run or runs alone. Risky: `Relaunch app` / `Reset app data` / `Background app` / `Set network` ✱, and `Handle permission`, `Close browser`, a screen that moves on by itself, a multi-step guide. The `Run flow` path of a fresh TC does not count.
  - A branching or suspected-buggy flow (several sources, plans…): each TC runs alone.
- **Path of a fresh TC = flows** ✱, never prose in `pre` (the AI rereads prose differently each time).
  - One flow per hop (`Welcome → Login`), ending with a `Nav` plus the destination's exact title. The TC calls the hops with `Run flow` rows at Step 0; `pre` keeps only device / OS conditions. Flow rows become the Steps to Reproduce of the TC's bugs.
  - Take the most stable branch, away from screens under test or suspected buggy.
  - No rows for the App Tracking dialog (the runner closes it). Other permission dialogs: `Handle permission` Allow / Don't allow.
- **`pre` of a follow-on TC** = plain navigation from where the previous TC always ends: actions, not states (`chọn "<option>"`, not `("<option>" đang chọn)`), the end state rather than the difference (`chọn "<B>"`, not `bỏ chọn "<A>"`), no conditions (`Nếu …`). Deselect-all is a `Deselect all` row at Step 0, never prose ✱.

### 5. Write each TC as v2 rows

For every check, ask: which bug would still pass it?

**Screens**
- A failed `Nav` (Verify screen) is Blocked, a failed Check is Failed. Use Nav for screens passed on the way; a screen that *is* the Expected (goes to, back to, reopens on, skips) is a `Verify text` on its title. No Nav right after `Relaunch app` / `Reset app data` / `Background app` ✱.
- Every Nav is followed by a positive check unique to that screen, usually its exact title ✱. A TC never relies only on `Verify not displayed` ✱.
- Recognise a screen by its design title, not by a header, list item or badge that only shows in some states. A screen with no title: an element it always shows (tab bar item, empty-state text), listed for review.
- Tell look-alike screens (several guides, plans) apart by title or copy, not by a shared counter; inside one guide the counter shows the step.

**Targets and copy**
- Target = the label the user sees in the design. A tap area marked by a hint (coach mark "Tap here", "Tap to continue") uses the hint text.
- No label at all (part of a picture, an icon): a short description (`Ảnh minh hoạ`), used only in `Tap`, listed for review — a described target never matches a check, so `Verify not displayed` on it always passes. List keywords (`Verify count`, `Verify order`, `Deselect all`) name the list itself (`Danh sách <mục>`).
- Copy matches to the character (full stops, quotes, emoji). Precedence: closed Q&A, then design, then PRD / manual. Copy carrying earlier data (a name, a dish, a date) uses the value the TC entered. Copy the design does not show is an assumption: listed for review.

**Checks**
- Single-select, deselect, toggles: check both sides (`Verify selected` new, `Verify not selected` old).
- Spec'd order: `Verify order`. Fixed count: `Verify count`.
- Exact copy: `equals`. `contains` only when the full copy is unknown; date / time text: `regex` (✱ must be valid). Both listed for review.
- "Unchanged / has changed": `Save value`, then compare `{{name}}` (`not equals` for changed). Variables live in their TC ✱. Data usable once (sign-up email): `Generate data`.

**Timing**
- Popups and toasts: `Wait until displayed / not displayed` first, never an immediate `Verify displayed` ✱. A fixed `Wait` only when the spec gives seconds or nothing marks the end.
- **Screens that move on by themselves** (processing / loading slide, splash, setup, timed guide step): no wait, tap or check on them — they are gone before the runner looks. (✱ only `Wait until displayed` / `Tap` on a screen or target named Importing / Loading / Uploading / Processing…; the rest is on you.) Wait for the destination, or for the previous step's marker to disappear. Assume a step may move on when the spec does not say; a processing slide stays in this group even if the spec says to tap it (listed for review).
- **Multi-step guide:** read the step marker if the design shows one, then tap the step's target right away — at most one quick check before, never a check on text drawn in the picture (OCR is too slow). A path flow may simply wait for each step.

**Pictures and layout**
- Text drawn in a picture, chart or mockup, or a badge without an ID: write it like any text check; the runner reads the screenshot (OCR) when no element matches. Not colour, weight or icons. Text that animates in needs a short `Wait` first.
- Layout: `Verify layout`, Value = `;`-separated `<metric> <op> <number>` in points ✱, op `<=` `>=` `=` `<` `>` — `width`, `height`, `left`, `right`, `top`, `bottom`, `centerOffset`, `lines` (text lines on the screenshot), `spaceAbove`, `spaceBelow` (to the nearest drawn thing). E.g. `width <= 260; centerOffset <= 4; spaceBelow >= 36`. Numbers from the design with a few points of margin, listed for review.

**Reuse and hooks**
- A sub-flow repeated across TCs: declare it once in `flows`, call it with `Run flow` ✱. Flows hold no `Launch fresh` / `Relaunch app` / `Reset app data` / `Background app` / `Set network` and call no other flow ✱.
- Data or checks only dev can reach (seed data, forced errors, backend records): `Run setup` / `Run check` with a hook name.

**Write.** `node <skill>/scripts/write.mjs plan.json cases.json <out-dir>` (default `automation-tc/<ten-du-an>/`). Fix the plan until it prints `Độ phủ + format v2: OK`. It also checks coverage, required Targets / Values, Compare values, Platform, and undeclared or unused flows.

### 6. Report in chat and stop

- Per output file: TCs, manual cases, installs (and installs before: 1 per TC).
- Manual cases with reasons; for UI TCs, the parts left manual.
- For review: everything `write.mjs` lists under "Cần review", plus assumed copy and data, described targets, single-use data, device date, hooks for dev, open Q&A, `Thiếu keyword` cases, and expected results changed by later decisions.

## Reference

### Output (written by write.mjs)

`<sheet>-automation.xlsx`: sheets **TestCases**, **TestData**, **Flows** (when `Run flow` is used) and a hidden **Lists** for the Keyword dropdown, styled like the v2 template.

TestCases columns: `TC ID | Title | Priority | Pre-condition | Data Set | Step | Screen | Kind | Keyword | Target | Value | Compare | Platform | Check label | Test Result | Last Run`. Each TC is a **Case** row (ID, title, priority from the original) followed by its rows. Pre-condition line 1 is `Cài lại app` or `Tiếp nối <previous TC>`, added by the script. Sheet order = run order.

### plan.json

```json
{
  "testcases": [{
    "id": "TC_SEX_001", "fresh": true, "pre": [],
    "rows": [
      { "step": 0, "screen": "", "kind": "Action", "keyword": "Run flow", "value": "Welcome → Sex" },
      { "step": 1, "screen": "Sex", "kind": "Check", "keyword": "Verify disabled", "target": "Continue", "label": "Continue disable khi chưa chọn giới tính" }
    ]
  }],
  "flows": {
    "Welcome → Sex": [
      { "step": 0, "screen": "Welcome", "kind": "Action", "keyword": "Tap", "target": "Continues as guest" },
      { "step": 0, "screen": "Sex", "kind": "Nav", "keyword": "Verify screen", "target": "Sex" },
      { "step": 0, "screen": "Sex", "kind": "Check", "keyword": "Verify text", "target": "What is your sex?", "value": "What is your sex?", "compare": "equals", "label": "Tiêu đề màn Sex" }
    ]
  },
  "testdata": [],
  "manual": [{ "tc": "TC_WEL_005", "reason": "Đăng nhập Google: popup OAuth bên thứ 3" }]
}
```

- `testcases` in run order; `fresh` required. `"platform": "Android"` (or iOS) on a TC that exists on one platform only: Skipped elsewhere.
- **Step:** the TC's own step number; an Action and the checks after it share it.
- **Check label** ✱: required on every Check; short Vietnamese, names what is checked (never the value); the report uses it as the bug label.
- **Data:** concrete values; `dataSet` + `testdata` only when a TC runs with several data sets.
- No notes in the file (`Ghi chú…`, assumptions): they go in the report.

### Keywords

- **Action**
  - App: Launch fresh, Relaunch app, Reset app data, Background app, Open deep link, Open URL, Open notification.
  - Touch / input: Tap, Double tap, Long press, Tap outside, Toggle, Deselect all, Enter, Clear, Press key, Hide keyboard, Set ruler, Select date, Select picker, Scroll, Scroll to, Swipe, Back, Close browser.
  - System / time: Handle permission, Set network, Wait, Wait until displayed, Wait until not displayed, Wait until enabled.
  - Data / reuse: Run flow, Save value, Set variable, Generate data, Run setup.
- **Nav:** Verify screen.
- **Check:** Verify displayed, Verify not displayed, Verify text, Verify value, Verify placeholder, Verify focused, Verify attribute, Verify keyboard displayed, Verify keyboard not displayed, Verify enabled, Verify disabled, Verify selected, Verify not selected, Verify order, Verify count, Verify layout, Verify external URL, Verify app opened, Run check.

Notes: `Scroll` moves a container, `Scroll to` scrolls until the Target shows (prefer it). `Toggle` sets on / off (safe to repeat; use it on switches). `Reset app data` clears data and relaunches, treated like `Relaunch app`. `Swipe` with a Target swipes that element. The runner handles platform differences for `Back`, `Close browser`, `Tap outside`: one row, Platform All.

Every keyword acting on or checking one element needs a Target ✱. Values ✱:

| Keyword | Value |
|---|---|
| `Swipe`, `Scroll` | `left` / `right` / `up` / `down` (Scroll: Target = container or empty) |
| `Wait` | seconds |
| `Wait until displayed` / `not displayed` / `enabled` | timeout in seconds |
| `Background app` | seconds in background |
| `Long press` | seconds, or empty |
| `Set network` | `on` / `off`, Platform Android |
| `Handle permission` | `Allow` / `Don't allow`; Target = permission name (OS dialog, not a Tap) |
| `Toggle` | `on` / `off` |
| `Open deep link` / `Open URL` | `scheme://…` / `http(s)://…` |
| `Open notification` | none; Target = notification title |
| `Enter`, `Set ruler`, `Select date`, `Select picker` | the text, number, date or wheel item |
| `Press key` | `ENTER`, `DEL`, `TAB`… |
| `Run flow` | a name in `flows` |
| `Save value` | variable name (letters, digits, `_`), used later as `{{name}}` |
| `Set variable` / `Generate data` | value / `email`·`phone`·`text`·`number`·`uuid`; Target = variable name |
| `Run setup` / `Run check` | hook name from dev |
| `Verify value` / `Verify placeholder` | expected text |
| `Verify attribute` | `<attribute>=<value>` (`checked=true`) |
| `Verify count` / `Verify order` | number / labels separated by `;`; Target = the list |
| `Verify layout` | `<metric> <op> <number>` rules joined by `;` |
| `Verify external URL` | URL or fragment, Compare `contains` |
| `Verify app opened` | bundle id / package of the app in front ("does not open X": the app under test) |

**Compare** ✱: (empty), equals, not equals, contains, not contains, regex (JS, whole Value), greater than, greater or equal, less than, less or equal (numeric Value), empty, not empty (empty Value), number, unit, date:DD/MM/YYYY, all-on.
