import { Logo } from './Logo.jsx';

export function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="app-footer">
      <div className="footer-identity">
        <Logo linked={false} />
        <p>Secure storage and intentional sharing, without the noise.</p>
      </div>
      <div className="footer-meta">
        <span>© {year} Vaulta</span>
        <span>Private by default</span>
      </div>
    </footer>
  );
}
