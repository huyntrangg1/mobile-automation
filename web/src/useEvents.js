import { useEffect, useRef } from 'react';

let source = null;
const listeners = new Map();

function ensure() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onerror = () => {}; // EventSource tự kết nối lại
}

// Nghe 1 loại sự kiện SSE từ server (capture, script, run, app)
export function useEvents(type, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensure();
    const fn = (e) => ref.current(JSON.parse(e.data));
    if (!listeners.has(type)) listeners.set(type, 0);
    source.addEventListener(type, fn);
    return () => source.removeEventListener(type, fn);
  }, [type]);
}
