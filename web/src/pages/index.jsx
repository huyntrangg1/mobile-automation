// Bảng route → trang. Các task sau thay placeholder bằng trang thật.
import { Placeholder } from './Placeholder.jsx';
import { Apps } from './Apps.jsx';
import { AppSettings } from './AppSettings.jsx';
import { LocatorMap } from './LocatorMap.jsx';
import { CaptureLive } from './CaptureLive.jsx';
import { TestCases } from './TestCases.jsx';
import { ScriptReview } from './ScriptReview.jsx';
import { RunConfig } from './RunConfig.jsx';
import { RunView } from './RunView.jsx';
import { Runs } from './Runs.jsx';

const ph = (title) => (props) => <Placeholder title={title} {...props} />;

export const PAGES = [
  { path: '/apps', Comp: Apps },
  { path: '/apps/:appId/locators', Comp: LocatorMap },
  { path: '/apps/:appId/capture/:captureId', Comp: CaptureLive },
  { path: '/apps/:appId/settings', Comp: AppSettings },
  { path: '/apps/:appId/cases', Comp: TestCases },
  { path: '/apps/:appId/scripts', Comp: ScriptReview },
  { path: '/apps/:appId/run', Comp: (p) => <><TestCases {...p} /><RunConfig {...p} /></> },
  { path: '/runs', Comp: Runs },
  { path: '/runs/:runId', Comp: RunView },
];
