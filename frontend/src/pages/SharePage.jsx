import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { AppFooter } from '../components/AppFooter.jsx';
import { Icon } from '../components/Icons.jsx';
import { Logo } from '../components/Logo.jsx';
import { formatBytes } from '../utils/format.js';

function isUnavailableError(error) {
  return error?.status === 404
    || error?.code === 'FILE_NOT_FOUND'
    || error?.code === 'VALIDATION_ERROR';
}

export function SharePage() {
  const { shareToken } = useParams();
  const [share, setShare] = useState(null);
  const [status, setStatus] = useState('loading');
  const [downloading, setDownloading] = useState(false);

  async function loadShare() {
    setStatus('loading');
    try {
      const data = await apiFetch(`/api/public/${shareToken}`);
      setShare(data);
      setStatus('ready');
    } catch (error) {
      setShare(null);
      setStatus(isUnavailableError(error) ? 'unavailable' : 'error');
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkShare() {
      try {
        const data = await apiFetch(`/api/public/${shareToken}`);
        if (cancelled) return;
        setShare(data);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setShare(null);
        setStatus(isUnavailableError(error) ? 'unavailable' : 'error');
      }
    }

    void checkShare();

    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function downloadFile() {
    setDownloading(true);
    try {
      const { url } = await apiFetch(`/api/public/${shareToken}/download`);
      window.location.assign(url);
    } catch (error) {
      if (isUnavailableError(error)) {
        setShare(null);
        setStatus('unavailable');
      } else {
        setStatus('error');
      }
    } finally {
      setDownloading(false);
    }
  }

  let card;
  if (status === 'loading') {
    card = (
      <section className="share-card" aria-live="polite">
        <span className="share-symbol"><span className="spinner" /></span>
        <p className="eyebrow">Secure link</p>
        <h1>Checking file availability</h1>
        <p>Vaulta is verifying that this sharing link is still active.</p>
      </section>
    );
  } else if (status === 'unavailable') {
    card = (
      <section className="share-card" aria-live="polite">
        <span className="share-symbol share-symbol-muted"><Icon name="linkOff" /></span>
        <p className="eyebrow">Link unavailable</p>
        <h1>This file is no longer available</h1>
        <p>The owner may have made the file private, removed it, or the sharing link is no longer valid.</p>
        <small>Ask the sender for a new Vaulta sharing link if you still need the file.</small>
      </section>
    );
  } else if (status === 'error') {
    card = (
      <section className="share-card" aria-live="polite">
        <span className="share-symbol share-symbol-warning"><Icon name="alert" /></span>
        <p className="eyebrow">Unable to verify link</p>
        <h1>We could not check this file right now</h1>
        <p>Please try again. The link may still be valid.</p>
        <button className="button button-primary button-wide" type="button" onClick={loadShare}>
          Try again
        </button>
      </section>
    );
  } else {
    const expiryMinutes = Math.max(1, Math.round(share.downloadExpiresIn / 60));
    card = (
      <section className="share-card">
        <span className="share-symbol"><Icon name="download" /></span>
        <p className="eyebrow">Shared securely</p>
        <h1>A Vaulta user shared a file with you</h1>
        <p>
          <strong>{share.originalName}</strong>
          <br />
          {formatBytes(share.sizeBytes)}
        </p>
        <p>
          Vaulta will create a temporary download authorization valid for {expiryMinutes} minutes.
          The private storage location is never exposed by the sharing link.
        </p>
        <button
          className="button button-primary button-wide"
          type="button"
          onClick={downloadFile}
          disabled={downloading}
        >
          {downloading ? 'Preparing download…' : 'Download file'}
        </button>
        <small>Only download files you were expecting.</small>
      </section>
    );
  }

  return (
    <div className="share-page-shell">
      <main className="share-layout">
        <Logo />
        {card}
      </main>
      <AppFooter />
    </div>
  );
}
