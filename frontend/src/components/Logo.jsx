import { Link } from 'react-router-dom';

export function Logo({ linked = true }) {
  const content = (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <path d="M16 3 26 7v7c0 7-4.3 12.2-10 15-5.7-2.8-10-8-10-15V7l10-4Z" />
          <path d="m11.5 16 3 3 6-7" />
        </svg>
      </span>
      <span>Vaulta</span>
    </span>
  );
  return linked ? <Link className="brand-link" to="/">{content}</Link> : content;
}
