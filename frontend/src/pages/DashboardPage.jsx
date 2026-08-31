import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { getStorageStats } from '../api/storage.js';
import { AppFooter } from '../components/AppFooter.jsx';
import { FileList } from '../components/FileList.jsx';
import { Icon } from '../components/Icons.jsx';
import { Logo } from '../components/Logo.jsx';
import { StorageOverview } from '../components/StorageOverview.jsx';
import { UploadPanel } from '../components/UploadPanel.jsx';
import { useAuth } from '../context/useAuth.js';

function mergeUniqueFiles(current, incoming) {
  const byId = new Map(current.map((file) => [file.id, file]));
  for (const file of incoming) byId.set(file.id, file);
  return [...byId.values()];
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const fileControllersRef = useRef(new Set());
  const fileRequestsRef = useRef(new Set());
  const statsControllersRef = useRef(new Set());
  const statsRequestRef = useRef(0);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesLoadingMore, setFilesLoadingMore] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [accountError, setAccountError] = useState('');

  const loadFiles = useCallback(async ({ cursor = null, append = false } = {}) => {
    const requestKey = cursor || 'initial';
    if (fileRequestsRef.current.has(requestKey)) return;
    fileRequestsRef.current.add(requestKey);
    const controller = new AbortController();
    fileControllersRef.current.add(controller);
    if (append) setFilesLoadingMore(true);
    else setFilesLoading(true);
    setFilesError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const result = await apiFetch(`/api/files?${query}`, { signal: controller.signal });
      setFiles((current) => mergeUniqueFiles(current, result.items));
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (error.name !== 'AbortError') setFilesError(error.message);
    } finally {
      fileRequestsRef.current.delete(requestKey);
      fileControllersRef.current.delete(controller);
      if (!controller.signal.aborted) {
        setFilesLoading(false);
        setFilesLoadingMore(false);
      }
    }
  }, []);

  const loadStats = useCallback(async ({ background = false } = {}) => {
    const requestNumber = statsRequestRef.current + 1;
    statsRequestRef.current = requestNumber;
    const controller = new AbortController();
    statsControllersRef.current.add(controller);
    if (background) setStatsRefreshing(true);
    else setStatsLoading(true);
    setStatsError('');
    try {
      const result = await getStorageStats({ signal: controller.signal });
      if (requestNumber === statsRequestRef.current) setStats(result);
    } catch (error) {
      if (error.name !== 'AbortError' && requestNumber === statsRequestRef.current) {
        setStatsError(error.message);
      }
    } finally {
      statsControllersRef.current.delete(controller);
      if (!controller.signal.aborted && requestNumber === statsRequestRef.current) {
        setStatsLoading(false);
        setStatsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const fileControllers = fileControllersRef.current;
    const fileRequests = fileRequestsRef.current;
    const statsControllers = statsControllersRef.current;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void loadFiles();
      void loadStats();
    });
    return () => {
      active = false;
      for (const controller of fileControllers) controller.abort();
      for (const controller of statsControllers) controller.abort();
      fileControllers.clear();
      fileRequests.clear();
      statsControllers.clear();
    };
  }, [loadFiles, loadStats]);

  async function signOut() {
    setAccountError('');
    try {
      await logout();
    } catch (error) {
      setAccountError(error.message);
    }
  }

  function refreshStats() {
    void loadStats({ background: true });
  }

  function handleUploaded(file) {
    setFiles((current) => [file, ...current.filter((item) => item.id !== file.id)]);
    refreshStats();
  }

  function handleChanged(changed) {
    setFiles((current) => current.map((file) => file.id === changed.id ? changed : file));
    refreshStats();
  }

  function handleDeleted(id) {
    setFiles((current) => current.filter((file) => file.id !== id));
    refreshStats();
  }

  return (
    <div className="app-shell dashboard-shell">
      <header className="app-header dashboard-header">
        <Logo />
        <nav className="dashboard-nav" aria-label="Dashboard sections">
          <a href="#overview" aria-current="page">Overview</a>
          <a href="#files">My files</a>
        </nav>
        <div className="account-menu">
          <a className="button button-primary header-upload" href="#upload">Upload files</a>
          <span className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
          <span className="account-email">{user.email}</span>
          <button type="button" className="button button-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="dashboard">
        <section className="welcome-row" id="overview" aria-labelledby="dashboard-heading">
          <div>
            <p className="eyebrow">Personal dashboard</p>
            <h1 id="dashboard-heading">Welcome back</h1>
            <p>Manage and share your files securely.</p>
          </div>
          <span className="secure-pill"><span><Icon name="lock" /></span> Storage protected</span>
        </section>

        {accountError && <p className="form-error dashboard-error" role="alert">{accountError}</p>}

        <StorageOverview
          stats={stats}
          loading={statsLoading}
          refreshing={statsRefreshing}
          error={statsError}
          onRetry={() => loadStats({ background: Boolean(stats) })}
        />

        <div className="dashboard-content-grid">
          <div id="upload" className="dashboard-upload-panel">
            <UploadPanel onUploaded={handleUploaded} />
          </div>
          <aside className="dashboard-assurance" aria-labelledby="assurance-heading">
            <span className="assurance-icon"><Icon name="check" /></span>
            <p className="eyebrow">Private by default</p>
            <h2 id="assurance-heading">You control every share.</h2>
            <p>New files stay private until you explicitly make them public.</p>
            <ul>
              <li><Icon name="check" />Verified file contents</li>
              <li><Icon name="check" />Short-lived downloads</li>
              <li><Icon name="check" />Revocable public links</li>
            </ul>
          </aside>
        </div>

        <div id="files">
          <FileList
            files={files}
            loading={filesLoading}
            error={filesError}
            totalFiles={stats?.totalFiles}
            nextCursor={nextCursor}
            loadingMore={filesLoadingMore}
            onRetry={() => loadFiles()}
            onLoadMore={() => loadFiles({ cursor: nextCursor, append: true })}
            onChange={handleChanged}
            onDelete={handleDeleted}
          />
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
