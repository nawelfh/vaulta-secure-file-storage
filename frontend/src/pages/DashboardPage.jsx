import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { FileList } from '../components/FileList.jsx';
import { Logo } from '../components/Logo.jsx';
import { UploadPanel } from '../components/UploadPanel.jsx';
import { useAuth } from '../context/useAuth.js';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/api/files?limit=50')
      .then((result) => {
        if (!active) return;
        setFiles(result.items);
        setError('');
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Logo />
        <div className="account-menu">
          <span className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
          <span className="account-email">{user.email}</span>
          <button type="button" className="button button-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="dashboard">
        <div className="welcome-row">
          <div>
            <p className="eyebrow">Personal dashboard</p>
            <h1>Your secure space</h1>
            <p>Upload, manage, and share without giving up control.</p>
          </div>
          <span className="secure-pill"><span>✓</span> Storage protected</span>
        </div>
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        <UploadPanel onUploaded={(file) => setFiles((current) => [file, ...current.filter((item) => item.id !== file.id)])} />
        <FileList
          files={files}
          loading={loading}
          onChange={(changed) => setFiles((current) => current.map((file) => file.id === changed.id ? changed : file))}
          onDelete={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
        />
      </main>
      <footer className="app-footer"><span>Vaulta</span><span>Files stay private unless you share them.</span></footer>
    </div>
  );
}
