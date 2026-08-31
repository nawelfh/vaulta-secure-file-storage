const ICON_PATHS = {
  alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17.5v.1" /></>,
  archive: <><path d="M6 3h12v18H6zM9 3v4h6V3" /><path d="M12 8v2m0 2v2m0 2v2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  files: <><path d="M8 3h7l4 4v13H8z" /><path d="M15 3v5h5M5 7v14h10" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9S9.5 5.6 12 3z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m5 18 5-5 3 3 2-2 4 4" /></>,
  linkOff: <><path d="m9.5 14.5-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 4.8-.1M14.5 9.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-4.8.1M3 3l18 18" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  pdf: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  storage: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  text: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></>,
  upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>,
};

export function Icon({ name, className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name] || ICON_PATHS.file}
    </svg>
  );
}

export function VaultaMark({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 3 26 7v7c0 7-4.3 12.2-10 15-5.7-2.8-10-8-10-15V7l10-4Z" />
      <path d="m11.5 16 3 3 6-7" />
    </svg>
  );
}

export function FileTypeIcon({ style }) {
  const icon = {
    img: 'image',
    video: 'video',
    pdf: 'pdf',
    txt: 'text',
    zip: 'archive',
  }[style] || 'file';
  return <Icon name={icon} />;
}
