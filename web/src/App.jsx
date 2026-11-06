import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, matchPath } from 'react-router-dom';
import { api } from './api.js';
import { useEvents } from './useEvents.js';
import { Sidebar } from './components/Sidebar.jsx';
import { PAGES } from './pages/index.jsx';
import { Empty, ErrorNote } from './components/ui.jsx';
import './leaveGuard.js';

const LAST_APP = 'qapd.lastApp';

export function App() {
  const [apps, setApps] = useState([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [appsErr, setAppsErr] = useState(null);
  const [lock, setLock] = useState(null);
  const loc = useLocation();
  const reload = useCallback(() => {
    api.get('/apps').then((l) => { setApps(l); setAppsLoaded(true); setAppsErr(null); }).catch(setAppsErr);
    api.get('/health').then((h) => setLock(h.lock)).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  useEvents('app', reload);
  useEvents('lock', setLock);
  // App đang làm: theo URL /apps/:appId/…; trang không có appId (Test Runs, run) giữ app gần nhất
  // (run thì RunView báo app của run) — không rơi về app đầu danh sách
  const urlAppId = matchPath('/apps/:appId/*', loc.pathname)?.params.appId;
  const [lastAppId, setLastAppId] = useState(() => { try { return localStorage.getItem(LAST_APP); } catch { return null; } });
  const setCurrentApp = useCallback((id) => {
    setLastAppId(id);
    try { localStorage.setItem(LAST_APP, id); } catch {}
  }, []);
  useEffect(() => { if (urlAppId) setCurrentApp(urlAppId); }, [urlAppId, setCurrentApp]);
  const appId = urlAppId || lastAppId;
  const shared = { apps, reloadApps: reload, lock, setCurrentApp };
  // Trang gắn với app / run nào thì key theo đó: đổi app ở sidebar hay sang run khác → trang dựng lại, không mang state cũ
  const pageKey = urlAppId || matchPath('/runs/:runId', loc.pathname)?.params.runId || 'root';
  const missingApp = urlAppId && appsLoaded && !apps.some((a) => a.id === urlAppId);
  return (
    <div className="shell app-shell">
      <div className="side-wrap"><Sidebar apps={apps} lock={lock} appId={appId} /></div>
      <div className="main">
        {appsErr && <div style={{ padding: '16px 24px 0' }}><ErrorNote error={`Không tải được danh sách app (server có đang chạy?): ${appsErr.message || appsErr}`} /></div>}
        {missingApp ? (
          <main className="content"><section className="card"><Empty icon="apps" title="App không tồn tại">
            <span>App này đã bị xoá hoặc đường dẫn sai.</span>
            <Link className="btn btn-primary" to="/apps" style={{ marginTop: 8 }}>Về danh sách app</Link>
          </Empty></section></main>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/apps" replace />} />
            {PAGES.map(({ path, Comp }) => <Route key={path} path={path} element={<Comp key={pageKey} {...shared} />} />)}
            <Route path="*" element={<Navigate to="/apps" replace />} />
          </Routes>
        )}
      </div>
    </div>
  );
}

