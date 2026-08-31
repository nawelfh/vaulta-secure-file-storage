import { Link } from 'react-router-dom';
import { VaultaMark } from './Icons.jsx';

export function Logo({ linked = true }) {
  const content = (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <VaultaMark />
      </span>
      <span>Vaulta</span>
    </span>
  );
  return linked ? <Link className="brand-link" to="/">{content}</Link> : content;
}
