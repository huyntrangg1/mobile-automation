import { NavLink, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { confirmLeave } from '../leaveGuard.js';
import { Icon } from './Icon.jsx';
import { AppSwitcher } from './AppSwitcher.jsx';

const link = ({ isActive }) => (isActive ? 'nav on' : 'nav');

export function Sidebar({ apps, lock, appId }) {
  const nav = useNavigate();
  const loc = useLocation();
  // Đổi app thì ở lại đúng mục đang xem (Scripts → Scripts của app mới); trang riêng của app cũ (phiên lấy locator, drawer Run) → Test Cases
  const section = matchPath('/apps/:appId/:section/*', loc.pathname)?.params.section;
  const keep = ['cases', 'scripts', 'locators', 'smoke', 'settings'].includes(section) ? section : 'cases';
  const app = apps.find((a) => a.id === appId) || apps[0];
  // Phiên lấy locator (/apps/:id/capture/:id) thuộc nhóm Locator map
  const onCapture = !!app && loc.pathname.startsWith(`/apps/${app.id}/capture/`);
  // Trang kết quả một lần chạy (/smoke/:id) thuộc mục AI Smoke Test
  const onSmokeRun = loc.pathname.startsWith('/smoke/');
  return (
    <nav className="side" aria-label="Điều hướng chính">
      <div className="brand"><span className="logo"><Icon name="check" /></span><span>QA Pipeline</span></div>
      <NavLink className={link} to="/apps" end><Icon name="apps" /><span>Apps</span></NavLink>
      <NavLink className={link} to="/runs"><Icon name="runs" /><span>Test Runs</span></NavLink>
      {app && (
        <>
          <div className="side-sep" />
          <AppSwitcher apps={apps} app={app} onPick={(a) => confirmLeave() && nav(`/apps/${a.id}/${keep}`)} />
          <NavLink className={link} to={`/apps/${app.id}/cases`}><Icon name="cases" /><span>Test Cases</span>{app.cases > 0 && <span className="nav-n">{app.cases}</span>}</NavLink>
          <NavLink className={link} to={`/apps/${app.id}/scripts`}><Icon name="code" /><span>Scripts</span></NavLink>
          <NavLink className={(st) => (st.isActive || onCapture ? 'nav on' : 'nav')} aria-current={onCapture ? 'page' : undefined} to={`/apps/${app.id}/locators`}><Icon name="map" /><span>Locator map</span>{app.screens > 0 && <span className="nav-n">{app.screens}</span>}</NavLink>
          <NavLink className={(st) => (st.isActive || onSmokeRun ? 'nav on' : 'nav')} to={`/apps/${app.id}/smoke`}><Icon name="spark" /><span>AI Smoke Test</span></NavLink>
          <NavLink className={link} to={`/apps/${app.id}/settings`}><Icon name="gear" /><span>Cài đặt app</span></NavLink>
        </>
      )}
      <div className="side-foot" role="status" title={lock ? `Thiết bị đang bận: ${lock.label}` : 'Thiết bị test đang rảnh, chạy được ngay'}>
        <span className={lock ? 'dev-dot busy' : 'dev-dot'} aria-hidden="true" />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Thiết bị test</span>
          <span className="cap trunc">{lock ? `Đang bận · ${lock.label}` : 'Đang rảnh · sẵn sàng chạy'}</span>
        </span>
      </div>
    </nav>
  );
}
