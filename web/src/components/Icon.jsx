// Icon nét 16px, cùng bộ với canvas (stroke = currentColor)
const P = {
  apps: <path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />,
  cases: <path d="M3 4h10M3 8h10M3 12h10" />,
  map: <path d="M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5zM6 2.5v9.5M10 4v9.5" />,
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
  play: <path d="M4.5 3v10l8-5z" />,
  runs: <path d="M2.5 13.5h11M4 11V7M8 11V3.5M12 11V5.5" />,
  gear: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  upload: <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" />,
  record: <circle cx="8" cy="8" r="4.5" />,
  spark: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />,
  stop: <path d="M4 4h8v8H4z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />,
  warn: <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5h.01" />,
  arrow: <path d="M6 4l4 4-4 4" />,
  ext: <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />,
  phone: <><path d="M4.5 1.5h7v13h-7z" /><path d="M7 12.5h2" /></>,
  file: <path d="M4 1.5h5.5L12.5 4.5v10H4zM9.5 1.5v3h3" />,
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={`i ${className}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">{P[name]}</svg>
  );
}
