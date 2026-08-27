import { Logo } from './Logo.jsx';

export function LoadingScreen() {
  return (
    <main className="loading-screen">
      <Logo linked={false} />
      <span className="spinner" aria-label="Loading" />
    </main>
  );
}
