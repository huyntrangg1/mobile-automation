import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { PopMenu } from '../components/PopMenu.jsx';
import { Drawer, Empty, ErrorNote, PageHeader, fmtTime, initials } from '../components/ui.jsx';

// Build app đang dùng: cùng bundle id + version, tạo trước lần thêm / cập nhật build gần nhất.
// Cùng version nhưng tạo sau đó = build lại (dev hay build lại không tăng version) → coi là build mới.
const buildAt = (a) => Date.parse(a.buildAt || a.createdAt || 0);
export const inUse = (a, b) => a.bundleId === b.bundleId && a.version === b.version && b.mtime <= buildAt(a);
// Build trên máy mới hơn build app đang dùng
export const newerBuild = (a, builds) => (builds || []).find((b) => b.bundleId === a.bundleId && b.mtime > buildAt(a) && !inUse(a, b));

export function Apps({ apps, reloadApps }) {
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [builds, setBuilds] = useState(null);
  useEffect(() => { api.get('/builds').then(setBuilds).catch(() => setBuilds([])); }, []);
  return (
    <main className="content">
      <PageHeader title="Apps" sub="Mỗi app có locator map, test case, script và lịch sử run riêng.">
        <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Thêm app</button>
      </PageHeader>
      {apps.length === 0 ? (
        <section className="card">
          <Empty icon="phone" title="Chưa có app nào">
            <span>Thêm file .app (iOS) hoặc .apk (Android) để tool lấy locator, rồi import test case.</span>
            <button className="btn btn-primary" type="button" onClick={() => setAdding(true)} style={{ marginTop: 8 }}><Icon name="plus" />Thêm app đầu tiên</button>
          </Empty>
        </section>
      ) : (
        <AppTable apps={apps} builds={builds} onDeleted={reloadApps} onUpdate={setUpdating} />
      )}
      {adding && <AddApp apps={apps} onClose={() => setAdding(false)} onDone={reloadApps} onUpdate={(a) => { setAdding(false); setUpdating(a); }} />}
      {updating && <UpdateBuild app={updating} onClose={() => setUpdating(null)} onDone={() => { reloadApps(); api.get('/builds').then(setBuilds).catch(() => {}); }} />}
    </main>
  );
}

const SORT = {
  name: (a) => a.name.toLowerCase(),
  version: (a) => a.version || '',
  screens: (a) => a.screens || 0,
  cases: (a) => a.cases || 0,
  run: (a) => Date.parse(a.lastRun?.startedAt || 0) || 0,
};
const TABS = [['all', 'Tất cả'], ['iOS', 'iOS'], ['Android', 'Android']];

function AppTable({ apps, builds, onDeleted, onUpdate }) {
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState(null); // { key, dir }
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);
  const count = (k) => (k === 'all' ? apps.length : apps.filter((a) => (a.platform || 'iOS') === k).length);
  const rows = useMemo(() => {
    const s = term.trim().toLowerCase();
    const list = apps.filter((a) => (tab === 'all' || (a.platform || 'iOS') === tab) && (!s || `${a.name} ${a.bundleId} ${a.version}`.toLowerCase().includes(s)));
    if (!sort) return list;
    const f = SORT[sort.key];
    return [...list].sort((x, y) => (f(x) > f(y) ? 1 : f(x) < f(y) ? -1 : 0) * sort.dir);
  }, [apps, term, tab, sort]);
  const toggleSort = (key) => setSort((c) => (c?.key === key ? { key, dir: -c.dir } : { key, dir: 1 }));
  const remove = async (a) => {
    const what = [a.cases && `${a.cases} test case`, a.screens && `${a.screens} màn locator`, a.lastRun && 'lịch sử run + report'].filter(Boolean).join(', ');
    if (!window.confirm(`Xoá app "${a.name}"?\nXoá hẳn ${what ? `${what}, ` : ''}project WebdriverIO và build đã copy vào tool. File app bạn nhập đường dẫn tay (nằm ngoài tool) vẫn giữ.`)) return;
    setBusyId(a.id);
    setErr(null);
    try { await api.del(`/apps/${a.id}`); onDeleted(); } catch (x) { setErr(x); }
    setBusyId(null);
  };
  const Th = ({ k, children }) => (
    <th scope="col" aria-sort={sort?.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="ap-sort" onClick={() => toggleSort(k)}>{children}<Icon name={sort?.key === k && sort.dir === -1 ? 'chev' : 'arrow'} size={10} className={sort?.key === k ? 'on' : ''} /></button>
    </th>
  );
  return (
    <>
      <div className="ap-flt">
        <div className="search">
          <Icon name="search" />
          <input className="inp" type="search" placeholder="Tìm app, bundle id…" aria-label="Tìm app" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="chips" role="tablist" aria-label="Nền tảng">
          {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}<span className="count">{count(k)}</span></button>)}
        </div>
      </div>
      {err && <ErrorNote error={err} />}
      <div className="ap-wrap">
        <table className="ap-tbl">
          <thead>
            <tr>
              <Th k="name">App</Th><Th k="version">Version</Th><Th k="screens">Locator</Th><Th k="cases">Case</Th><Th k="run">Run gần nhất</Th>
              <th scope="col">Kết quả</th><th scope="col"><span className="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => <AppRow key={a.id} a={a} newer={newerBuild(a, builds)} busy={busyId === a.id} onUpdate={() => onUpdate(a)} onRemove={() => remove(a)} />)}
            {rows.length === 0 && <tr><td colSpan={7} className="ap-none">Không có app khớp “{term}”.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AppRow({ a, newer, busy, onUpdate, onRemove }) {
  const c = a.lastRun?.counts;
  const out = c ? [c.passed && ['b-pass', '✓', c.passed], c.failed && ['b-fail', '✕', c.failed], c.blocked && ['b-blocked', '⊘', c.blocked]].filter(Boolean) : [];
  return (
    <>
      <tr>
        <td>
          <div className="ap-name">
            <span className="ap-av" aria-hidden="true">{initials(a.name)}</span>
            <Link to={`/apps/${a.id}/cases`} className="ap-nm" title={a.name}>{a.name}</Link>
            {a.status === 'preparing' && <span className="ap-tag ap-prep">Đang chuẩn bị</span>}
            {a.status === 'error' && <span className="ap-tag ap-err">Lỗi</span>}
            {newer && <button type="button" className="ap-tag ap-new" onClick={onUpdate} title="Có build mới trên máy — bấm để cập nhật"><Icon name="upload" size={12} />Build mới v{newer.version}</button>}
          </div>
        </td>
        <td className="ap-num" title={a.bundleId}><span className={a.platform === 'Android' ? 'plat plat-and' : 'plat'}>{a.platform || 'iOS'}</span>{a.version}</td>
        <td className="ap-num"><Link to={`/apps/${a.id}/locators`} className={a.screens ? '' : 'ap-dim'} title={a.screens ? undefined : 'Chưa lấy locator'}>{a.screens || '—'}</Link></td>
        <td className="ap-num"><Link to={`/apps/${a.id}/cases`} className={a.cases ? '' : 'ap-dim'} title={a.cases ? undefined : 'Chưa import test case'}>{a.cases || '—'}</Link></td>
        <td>{a.lastRun ? <><Link to={`/runs/${a.lastRun.id}`} className="mono">{a.lastRun.id}</Link> <span className="cap">{fmtTime(a.lastRun.startedAt)}</span></> : <span className="cap">—</span>}</td>
        <td>{a.lastRun ? (
          <div className="ap-res">{out.length ? out.map(([cls, g, n]) => <span key={cls} className={`badge ${cls}`}><span aria-hidden="true">{g}</span>{n}</span>) : <span className="badge b-notrun">{c?.notrun || 0} chưa chạy</span>}</div>
        ) : <span className="cap">—</span>}</td>
        <td><RowMenu a={a} disabled={busy} onUpdate={onUpdate} onRemove={onRemove} /></td>
      </tr>
      {a.status === 'error' && <tr className="ap-errrow"><td colSpan={7}><ErrorNote error={a.error} /></td></tr>}
    </>
  );
}

function RowMenu({ a, disabled, onUpdate, onRemove }) {
  return (
    <PopMenu label={`Thao tác ${a.name}`} disabled={disabled}>
      {(close) => (
        <>
          <button type="button" role="menuitem" onClick={() => { close(); onUpdate(); }}><Icon name="upload" />Cập nhật build…</button>
          <hr />
          <button type="button" role="menuitem" className="danger" disabled={a.status === 'preparing'} title={a.status === 'preparing' ? 'Đang chuẩn bị — chờ xong rồi xoá' : undefined} onClick={() => { close(); onRemove(); }}><Icon name="trash" />Xoá app…</button>
        </>
      )}
    </PopMenu>
  );
}

// Tải file build từ máy của mình lên máy chạy tool (.apk, hoặc .zip chứa .app build cho Simulator)
function UploadBuild({ onUploaded, label = 'Hoặc tải file build từ máy bạn' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const send = async (file) => {
    if (!file) return;
    setErr(null);
    setBusy(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      onUploaded(await api.post('/builds/upload', fd));
    } catch (x) { setErr(x); }
    setBusy(null);
  };
  return (
    <div className="field"><span className="label">{label}</span>
      <ErrorNote error={err} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" type="button" disabled={!!busy} onClick={() => ref.current?.click()}><Icon name="upload" />{busy ? `Đang tải lên ${busy}…` : 'Chọn file .apk / .zip'}</button>
        <input ref={ref} type="file" accept=".apk,.zip" hidden onChange={(e) => { send(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <span className="cap">Android: file .apk. iOS: nén thư mục .app (build cho Simulator) thành .zip — chuột phải → Nén.</span></div>
  );
}

function AddApp({ apps = [], onClose, onDone, onUpdate }) {
  const nav = useNavigate();
  const [packs, setPacks] = useState([]);
  const [f, setF] = useState({ name: '', appPath: '', helperPack: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [builds, setBuilds] = useState(null);
  const [buildErr, setBuildErr] = useState(null);
  const loadBuilds = () => {
    setBuilds(null);
    setBuildErr(null);
    api.get('/builds').then(setBuilds).catch((x) => { setBuildErr(x); setBuilds([]); });
  };
  useEffect(() => { api.get('/helper-packs').then(setPacks).catch(() => {}); loadBuilds(); }, []);
  // Tên do tool điền theo build: chọn build khác thì đổi theo; tên gõ tay thì giữ
  const [autoName, setAutoName] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (b) => {
    setF({ ...f, appPath: b.path, name: !f.name.trim() || f.name === autoName ? b.name : f.name });
    setAutoName(b.name);
  };
  const plat = /\.apk$/i.test(f.appPath.trim()) ? 'Android' : /\.app\/?$/i.test(f.appPath.trim()) ? 'iOS' : null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const a = await api.post('/apps', { ...f, helperPack: f.helperPack || null });
      onDone();
      nav(`/apps/${a.id}/locators`);
    } catch (x) {
      setErr(x);
      setBusy(false);
    }
  };
  return (
    <Drawer title="Thêm app" sub="iOS (.app) hoặc Android (.apk)" onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={onClose}>Huỷ</button><button className="btn btn-primary" type="submit" form="add-app" disabled={busy || !f.name || !f.appPath}>{busy ? 'Đang tạo…' : 'Tạo app'}</button></>}>
      <form id="add-app" onSubmit={submit} className="stack-16">
        <ErrorNote error={err} />
        <div className="field"><span className="label build-h">Build có sẵn trên máy<button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={loadBuilds} disabled={!builds} aria-label="Quét lại" title="Quét lại"><Icon name="refresh" /></button></span>
          <ErrorNote error={buildErr} />
          <BuildPicker builds={builds} selected={f.appPath} onPick={pick} usedBy={(b) => apps.filter((a) => inUse(a, b)).map((a) => a.name)} />
          {(() => {
            const b = builds?.find((x) => x.path === f.appPath);
            if (!b) return null;
            const using = apps.filter((a) => inUse(a, b));
            if (using.length) return (
              <div className="alert alert-info"><Icon name="check" /><div style={{ flex: 1 }}>
                <b>{using.map((a) => `"${a.name}"`).join(', ')}</b> đang dùng đúng build này (<span className="mono">v{b.version}</span>) — không cần thêm app mới.
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{using.map((a) => <Link key={a.id} className="btn btn-sm" to={`/apps/${a.id}/cases`} onClick={onClose}>Mở {a.name}</Link>)}</div>
              </div></div>
            );
            const same = apps.filter((a) => a.bundleId === b.bundleId);
            return same.length > 0 && (
              <div className="alert alert-warn"><Icon name="warn" /><div style={{ flex: 1 }}>
                <b>{same.map((a) => `"${a.name}" (đang v${a.version})`).join(', ')}</b> cùng bundle id <span className="mono">{b.bundleId}</span>. Build <span className="mono">v{b.version}</span> này là bản mới của app đó? Cập nhật build sẽ giữ nguyên test case, script, locator và lịch sử run.
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{same.map((a) => <button key={a.id} className="btn btn-sm btn-primary" type="button" onClick={() => onUpdate?.({ ...a, preselect: b.path })}>Cập nhật build cho {a.name}</button>)}</div>
              </div></div>
            );
          })()}
          <span className="cap">Build lấy từ simulator được copy vào workspace của app, vì đường dẫn gốc đổi mỗi lần cài lại.</span></div>
        <UploadBuild onUploaded={(b) => { setF((x) => ({ ...x, appPath: b.path, name: !x.name.trim() || x.name === autoName ? (b.label || '') : x.name })); setAutoName(b.label || ''); }} />
        <label className="field"><span className="label">Tên app</span><input className="inp" value={f.name} onChange={set('name')} placeholder="IK Fitness" required /></label>
        <label className="field"><span className="label">Hoặc nhập đường dẫn file app</span>
          <input className="inp mono" value={f.appPath} onChange={set('appPath')} placeholder="/Users/…/ikFitness.app hoặc …/ikFitness.apk" required />
          <span className="cap">{plat === 'Android' ? 'Android: tool đọc package name, version, activity từ APK.' : plat === 'iOS' ? 'iOS: build cho Simulator; tool đọc bundle id và version từ Info.plist.' : '.app = iOS Simulator, .apk = Android. Tool tự nhận nền tảng.'}</span></label>
        <label className="field"><span className="label">Helper pack</span>
          <select className="sel" value={f.helperPack} onChange={set('helperPack')}>
            <option value="">Không dùng</option>
            {packs.map((p) => <option key={p.id} value={p.id} disabled={!!plat && p.platform !== plat}>{p.id} ({p.platform}){plat && p.platform !== plat ? ' — không dùng được cho app này' : ''}</option>)}
          </select>
          <span className="cap">Code viết tay sẵn cho app (page object, thao tác đặc biệt như kéo thước, popup hệ thống). AI gọi lại thay vì tự viết.</span></label>
        <div className="alert alert-info"><Icon name="map" /><div>Sau khi tạo, tool chuẩn bị project WebdriverIO cho app (khoảng 1–2 phút) và đưa bạn tới bước lấy locator.</div></div>
      </form>
    </Drawer>
  );
}

const fmtSize = (n) => (n == null ? '?' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const fmtDate = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const KINDS = [['all', 'Tất cả'], ['simulator', 'Simulator'], ['xcode', 'Xcode']];

// Danh sách build kiểu SimUtil: nhóm theo app (icon, tên, số build, version mới nhất), mở ra thấy từng build
export function BuildPicker({ builds, selected, onPick, usedBy = () => [] }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [open, setOpen] = useState({});
  if (!builds) return <div className="bp"><span className="cap" style={{ padding: 12 }}>Đang quét simulator và Xcode DerivedData…</span></div>;
  const term = q.trim().toLowerCase();
  const groups = [];
  for (const b of builds) {
    if (kind !== 'all' && b.kind !== kind) continue;
    if (term && !`${b.name} ${b.bundleId} ${b.version} ${b.source}`.toLowerCase().includes(term)) continue;
    let g = groups.find((x) => x.bundleId === b.bundleId);
    if (!g) groups.push(g = { bundleId: b.bundleId, name: b.name, icon: b.icon, builds: [] });
    g.builds.push(b);
    g.icon ||= b.icon;
  }
  const isOpen = (g) => open[g.bundleId] ?? (!!term || groups.length === 1 || g.builds.some((b) => b.path === selected));
  // Chỉ hiện chip nguồn khi có từ hai nguồn trở lên; có một nguồn thì chip chẳng lọc được gì
  const kinds = KINDS.filter(([k]) => k === 'all' || builds.some((b) => b.kind === k));
  return (
    <div className="bp">
      <div className="bp-tools">
        <label className="bp-search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm app, bundle id, version…" aria-label="Tìm build" /></label>
        {kinds.length > 2 && <div className="chips" role="tablist" aria-label="Nguồn build">{kinds.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{l}<span className="count">{k === 'all' ? builds.length : builds.filter((b) => b.kind === k).length}</span></button>)}</div>}
      </div>
      {groups.length === 0 ? <p className="cap bp-empty">{builds.length ? 'Không có build nào khớp.' : 'Không thấy build iOS nào. Cài app lên simulator hoặc build bằng Xcode, rồi quét lại.'}</p> : (
        <ul className="bp-list" role="listbox" aria-label="Build có sẵn">
          {groups.map((g) => (
            <li key={g.bundleId}>
              <button type="button" className="bp-app" aria-expanded={isOpen(g)} onClick={() => setOpen({ ...open, [g.bundleId]: !isOpen(g) })}>
                <Icon name="arrow" className={isOpen(g) ? 'bp-chev open' : 'bp-chev'} />
                {g.icon ? <img className="bp-ic" src={`/api/builds/icon/${g.icon}`} alt="" /> : <span className="bp-ic bp-ic-txt">{g.name.slice(0, 2).toUpperCase()}</span>}
                <span className="bp-title"><b>{g.name}</b><span className="bp-meta"><span className="bp-count">{g.builds.length} build</span><span className="cap mono trunc">{g.bundleId}</span></span></span>
                <span className="bp-ver mono">v{g.builds[0].version.split(' ')[0]}</span>
              </button>
              {isOpen(g) && (
                <ul className="bp-builds">
                  {g.builds.map((b) => (
                    <li key={b.path}>
                      <button type="button" role="option" aria-selected={b.path === selected} className={b.path === selected ? 'bp-build on' : 'bp-build'} onClick={() => onPick(b)} title={b.path}>
                        <Icon name="box" className="bp-box" />
                        <span className="bp-title"><b className="mono">v{b.version}{usedBy(b).length > 0 && <span className="bp-used">Đang dùng · {usedBy(b).join(', ')}</span>}</b><span className="cap mono">{b.source} · {fmtSize(b.size)} · {fmtDate(b.mtime)}</span></span>
                        {b.path === selected && <Icon name="check" className="bp-tick" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Drawer cập nhật build cho app đã có: chỉ hiện build cùng bundle id, hoặc nhập đường dẫn
export function UpdateBuild({ app, onClose, onDone }) {
  const [builds, setBuilds] = useState(null);
  const [appPath, setAppPath] = useState(app.preselect || '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const load = () => { setBuilds(null); api.get('/builds').then((l) => setBuilds(l.filter((b) => b.bundleId === app.bundleId))).catch((e) => { setErr(e); setBuilds([]); }); };
  useEffect(load, [app.bundleId]);
  // Không có build nào để chọn từ danh sách thì mở sẵn hai cách còn lại
  useEffect(() => { if (builds && builds.length === 0) setMore(true); }, [builds]);
  const picked = builds?.find((b) => b.path === appPath);
  const same = picked && inUse(app, picked);
  // Lịch sử build gộp trùng: v1.0.4 (1) dùng 5 lần → "v1.0.4 (1) ×5"
  const history = [];
  for (const h of app.buildHistory || []) { const x = history.find((y) => y.version === h.version); if (x) x.n += 1; else history.push({ version: h.version, n: 1 }); }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/apps/${app.id}/build`, { appPath });
      onDone?.();
      onClose();
    } catch (x) {
      setErr(x);
      setBusy(false);
    }
  };
  return (
    <Drawer title={`Cập nhật build · ${app.name}`} sub={`${app.bundleId} · đang dùng v${app.version}`} onClose={onClose}
      footer={<><span className="cap">Giữ nguyên test case, script, locator map và lịch sử run.</span><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={onClose}>Huỷ</button><button className="btn btn-primary" type="submit" form="update-build" disabled={busy || !appPath.trim() || same}>{busy ? 'Đang cập nhật…' : same ? 'Đang dùng build này' : picked ? `Dùng v${picked.version}` : 'Cập nhật build'}</button></>}>
      <form id="update-build" onSubmit={submit} className="stack-16">
        <ErrorNote error={err} />
        <div className="field"><span className="label build-h">Build của {app.name} trên máy<button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={load} disabled={!builds} aria-label="Quét lại" title="Quét lại"><Icon name="refresh" /></button></span>
          <BuildPicker builds={builds} selected={appPath} onPick={(b) => setAppPath(b.path)} usedBy={(b) => (inUse(app, b) ? [app.name] : [])} />
          {builds && builds.length > 0 && builds.every((b) => inUse(app, b)) && <span className="cap">Chưa có build mới — trên máy chỉ có build app đang dùng. Cài bản mới lên simulator hoặc build bằng Xcode rồi bấm quét lại.</span>}
          <span className="cap">Lần Run sau sẽ cài build mới lên thiết bị.</span></div>
        <details className="more" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
          <summary><Icon name="arrow" size={12} />Cách khác: tải file hoặc nhập đường dẫn</summary>
          <div className="more-body">
            <UploadBuild label="Tải file build từ máy bạn" onUploaded={(b) => setAppPath(b.path)} />
            <label className="field"><span className="label">Đường dẫn file app</span>
              <input className="inp mono" value={appPath} onChange={(e) => setAppPath(e.target.value)} placeholder={app.platform === 'Android' ? '/Users/…/app.apk' : '/Users/…/App.app'} />
              <span className="cap">Phải cùng bundle id <span className="mono">{app.bundleId}</span> và cùng nền tảng {app.platform || 'iOS'}.</span></label>
          </div>
        </details>
        {history.length > 0 && (
          <div className="field"><span className="label">Build đã dùng trước đây</span>
            <div className="chips">{history.map((h) => <span key={h.version} className="plat mono" style={{ margin: 0 }}>v{h.version}{h.n > 1 && <span className="cap"> ×{h.n}</span>}</span>)}</div></div>
        )}
      </form>
    </Drawer>
  );
}
