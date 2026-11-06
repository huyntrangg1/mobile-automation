// Bảng route → trang.
import { Apps } from './Apps.jsx';
import { AppSettings } from './AppSettings.jsx';
import { LocatorMap } from './LocatorMap.jsx';
import { CaptureLive } from './CaptureLive.jsx';
import { TestCases } from './TestCases.jsx';
import { ScriptReview } from './ScriptReview.jsx';
import { RunConfig } from './RunConfig.jsx';
import { RunView } from './RunView.jsx';
import { Runs } from './Runs.jsx';
import { SmokeTest } from './SmokeTest.jsx';
import { SmokeRunView } from './SmokeRunView.jsx';
import { useMatch } from 'react-router-dom';

// Test Cases và drawer Run là cùng một trang (cùng component) → mở / huỷ drawer không dựng lại bảng case,
// giữ case đã tick, bộ lọc, ô tìm
function CasesPage(p) {
  const run = !!useMatch('/apps/:appId/run');
  return <><TestCases {...p} />{run && <RunConfig {...p} />}</>;
}

export const PAGES = [
  { path: '/apps', Comp: Apps },
  { path: '/apps/:appId/locators', Comp: LocatorMap },
  { path: '/apps/:appId/capture/:captureId', Comp: CaptureLive },
  { path: '/apps/:appId/settings', Comp: AppSettings },
  { path: '/apps/:appId/cases', Comp: CasesPage },
  { path: '/apps/:appId/scripts', Comp: ScriptReview },
  { path: '/apps/:appId/run', Comp: CasesPage },
  { path: '/apps/:appId/smoke', Comp: SmokeTest },
  { path: '/smoke/:id', Comp: SmokeRunView },
  { path: '/runs', Comp: Runs },
  { path: '/runs/:runId', Comp: RunView },
];
