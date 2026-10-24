import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, matchPath } from 'react-router-dom';
import { api } from './api.js';
import { useEvents } from './useEvents.js';
import { Sidebar } from './components/Sidebar.jsx';
import { PAGES } from './pages/index.jsx';

export function App() {
  const [apps, setApps] = useState([]);
  const [lock, setLock] = useState(null);
  const loc = useLocation();
  const reload = useCallback(() => {
    api.get('/apps').then(setApps).catch(() => {});
    api.get('/health').then((h) => setLock(h.lock)).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useEvents('app', reload);
  useEvents('lock', setLock);
  const appId = matchPath('/apps/:appId/*', loc.pathname)?.params.appId;
  const shared = { apps, reloadApps: reload, lock };
  return (
    <div className="shell app-shell">
      <div className="side-wrap"><SidebarAt apps={apps} lock={lock} appId={appId} /></div>
      <div className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/apps" replace />} />
          {PAGES.map(({ path, Comp }) => <Route key={path} path={path} element={<Comp {...shared} />} />)}
          <Route path="*" element={<Navigate to="/apps" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// Sidebar cần appId ngay cả khi nằm ngoài <Route>
function SidebarAt({ apps, lock, appId }) {
  return (
    <Routes>
      <Route path="/apps/:appId/*" element={<Sidebar apps={apps} lock={lock} />} />
      <Route path="*" element={<Sidebar apps={apps} lock={lock} key={appId || 'none'} />} />
    </Routes>
  );
}
