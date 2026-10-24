import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';

const link = ({ isActive }) => (isActive ? 'nav on' : 'nav');

export function Sidebar({ apps, lock }) {
  const { appId } = useParams();
  const nav = useNavigate();
  const app = apps.find((a) => a.id === appId) || apps[0];
  return (
    <nav className="side" aria-label="Điều hướng chính">
      <div className="brand"><span className="logo"><Icon name="check" /></span><span>QA Pipeline</span></div>
      <NavLink className={link} to="/apps" end><Icon name="apps" /><span>Apps</span></NavLink>
      <NavLink className={link} to="/runs"><Icon name="runs" /><span>Test Runs</span></NavLink>
      {app && (
        <>
          <div className="side-sep" />
          <label className="proj app-pick">
            <span className="overline">App</span>
            <select value={app.id} onChange={(e) => nav(`/apps/${e.target.value}/cases`)} aria-label="Chọn app">
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <NavLink className={link} to={`/apps/${app.id}/cases`}><Icon name="cases" /><span>Test Cases</span></NavLink>
          <NavLink className={link} to={`/apps/${app.id}/scripts`}><Icon name="code" /><span>Scripts</span></NavLink>
          <NavLink className={link} to={`/apps/${app.id}/locators`}><Icon name="map" /><span>Locator map</span></NavLink>
          <NavLink className={link} to={`/apps/${app.id}/settings`}><Icon name="gear" /><span>Cài đặt app</span></NavLink>
        </>
      )}
      <div className="side-foot">
        <span className={lock ? 'dev-dot busy' : 'dev-dot'} aria-hidden="true" />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Thiết bị</span>
          <span className="cap trunc">{lock ? lock.label : 'Đang rảnh'}</span>
        </span>
      </div>
    </nav>
  );
}
