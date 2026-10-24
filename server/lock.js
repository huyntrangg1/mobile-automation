// Một job dùng simulator tại một thời điểm (lấy locator hoặc run).
const JOB_COLS = ['runs', 'captures'];

export function createLock() {
  let holder = null;
  return {
    acquire(job) {
      if (holder) return { ok: false, holder: { ...holder } };
      holder = { ...job, since: new Date().toISOString() };
      return { ok: true };
    },
    release(id) {
      if (holder?.id === id) holder = null;
    },
    current: () => (holder ? { ...holder } : null),
    // Khởi động lại server giữa chừng: job đang chạy không còn tiến trình nào theo dõi
    recover(store) {
      holder = null;
      for (const col of JOB_COLS) {
        for (const j of store.list(col)) {
          if (j.status === 'running') store.patch(col, j.id, { status: 'interrupted', finishedAt: new Date().toISOString() });
        }
      }
      for (const c of store.list('cases')) {
        if (c.script?.status === 'generating') store.patch('cases', c.id, { script: { ...c.script, status: 'failed', error: 'Server khởi động lại khi đang gen — gen lại' } });
      }
      for (const a of store.list('apps')) {
        if (a.status === 'preparing') store.patch('apps', a.id, { status: 'error', error: 'Server khởi động lại khi đang chuẩn bị project — bấm Chuẩn bị lại' });
      }
    },
  };
}
