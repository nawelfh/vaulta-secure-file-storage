import { useParams } from 'react-router-dom';
import { publicDownloadUrl } from '../api/client.js';
import { Logo } from '../components/Logo.jsx';

export function SharePage() {
  const { shareToken } = useParams();
  return (
    <main className="share-layout">
      <Logo />
      <section className="share-card">
        <span className="share-symbol" aria-hidden="true">↓</span>
        <p className="eyebrow">Shared securely</p>
        <h1>A Vaulta user shared a file with you</h1>
        <p>The download link is authorized for a 5 minutes and does not reveal the owner’s private storage.</p>
        <a className="button button-primary button-wide" href={publicDownloadUrl(shareToken)}>Download file</a>
        <small>Only download files you were expecting.</small>
      </section>
    </main>
  );
}
