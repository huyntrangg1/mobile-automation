import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { Drawer, Empty, ErrorNote, ExecBadge, PageHeader, fmtTime } from '../components/ui.jsx';

const STATUS = { preparing: ['badge b-running', 'Đang chuẩn bị'], ready: ['badge b-pass', 'Sẵn sàng'], error: ['badge b-fail', 'Lỗi'] };

export function Apps({ apps, reloadApps }) {
  const [adding, setAdding] = useState(false);
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
        <div className="app-grid">{apps.map((a) => <AppCard key={a.id} a={a} />)}</div>
      )}
      {adding && <AddApp onClose={() => setAdding(false)} onDone={reloadApps} />}
    </main>
  );
}

function AppCard({ a }) {
  const [cls, label] = STATUS[a.status] || STATUS.ready;
  const steps = [
    { done: a.screens > 0, label: 'Locator', value: a.screens ? `${a.screens} màn` : 'Chưa lấy', to: `/apps/${a.id}/locators` },
    { done: a.cases > 0, label: 'Test case', value: a.cases ? `${a.cases} case` : 'Chưa import', to: `/apps/${a.id}/cases` },
    { done: !!a.lastRun, label: 'Run gần nhất', value: a.lastRun ? a.lastRun.id : 'Chưa chạy', to: a.lastRun ? `/runs/${a.lastRun.id}` : `/apps/${a.id}/cases` },
  ];
  return (
    <article className="card app-card">
      <header className="app-card-h">
        <span className="app-ic"><Icon name="phone" size={20} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2><Link to={`/apps/${a.id}/cases`}>{a.name}</Link></h2>
          <span className="cap mono trunc" style={{ display: 'block', maxWidth: '100%' }}><span className={a.platform === 'Android' ? 'plat plat-and' : 'plat'}>{a.platform || 'iOS'}</span> {a.bundleId} · {a.version}</span>
        </div>
        <span className={cls}>{label}</span>
      </header>
      {a.status === 'error' && <ErrorNote error={a.error} />}
      <ol className="app-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="dot" aria-hidden="true">{s.done ? <Icon name="check" size={12} /> : null}</span>
            <Link to={s.to}><span className="overline">{s.label}</span><span>{s.value}</span></Link>
          </li>
        ))}
      </ol>
      {a.lastRun && (
        <footer className="app-card-f">
          <span className="cap">{fmtTime(a.lastRun.startedAt)}</span>
          <span style={{ flex: 1 }} />
          {['passed', 'failed', 'blocked'].filter((k) => a.lastRun.counts?.[k]).map((k) => (
            <span key={k} className="app-count"><ExecBadge status={k} /> <b className="mono">{a.lastRun.counts[k]}</b></span>
          ))}
        </footer>
      )}
    </article>
  );
}

function AddApp({ onClose, onDone }) {
  const nav = useNavigate();
  const [packs, setPacks] = useState([]);
  const [f, setF] = useState({ name: '', appPath: '', helperPack: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/helper-packs').then(setPacks).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
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
        <label className="field"><span className="label">Tên app</span><input className="inp" value={f.name} onChange={set('name')} placeholder="IK Fitness" required autoFocus /></label>
        <label className="field"><span className="label">Đường dẫn file app</span>
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
