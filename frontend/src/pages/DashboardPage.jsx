import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getFiles } from '../api/files.js';
import { getStorageStats } from '../api/storage.js';
import { AppFooter } from '../components/AppFooter.jsx';
import { DashboardSidebar } from '../components/DashboardSidebar.jsx';
import { FileList } from '../components/FileList.jsx';
import { Icon } from '../components/Icons.jsx';
import { StorageOverview } from '../components/StorageOverview.jsx';
import { UploadPanel } from '../components/UploadPanel.jsx';
import { useAuth } from '../context/useAuth.js';

const PAGE_SIZE = 5;
const VALID_VIEWS = new Set(['files', 'shared', 'recent', 'favorites', 'trash']);

function emptyPagination() {
  return { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0, hasPrevious: false, hasNext: false };
}

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const activeView = VALID_VIEWS.has(requestedView) ? requestedView : 'dashboard';
  const fileControllerRef = useRef(null);
  const statsControllerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const statsSequenceRef = useRef(0);
  const uploadRef = useRef(null);
  const pendingUploadFocusRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState('');
  const [pagination, setPagination] = useState(emptyPagination);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [trashSort, setTrashSort] = useState('deleted-newest');
  const [visibility, setVisibility] = useState('');
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [accountError, setAccountError] = useState('');

  const effectiveVisibility = activeView === 'shared' ? 'PUBLIC' : visibility;
  const listView = ['recent', 'favorites', 'trash'].includes(activeView) ? activeView : 'active';
  const effectiveSort = activeView === 'recent' ? 'newest' : activeView === 'trash' ? trashSort : sort;
  const displayName = user.name?.trim() || '';
  const avatarInitial = (displayName || user.email || '?').charAt(0).toUpperCase();

  const loadFiles = useCallback(async ({ requestedPage = page } = {}) => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    fileControllerRef.current?.abort();
    const controller = new AbortController();
    fileControllerRef.current = controller;
    setFilesLoading(true);
    setFilesError('');
    try {
      const result = await getFiles({
        page: requestedPage,
        limit: PAGE_SIZE,
        search,
        sort: effectiveSort,
        visibility: effectiveVisibility,
        view: listView,
        signal: controller.signal,
      });
      if (sequence !== requestSequenceRef.current) return;
      setFiles(result.files);
      setPagination(result.pagination);
      if (result.pagination.page !== requestedPage) setPage(result.pagination.page);
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === requestSequenceRef.current) setFilesError(error.message);
    } finally {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current) setFilesLoading(false);
    }
  }, [effectiveSort, effectiveVisibility, listView, page, search]);

  const loadStats = useCallback(async ({ background = false } = {}) => {
    const sequence = statsSequenceRef.current + 1;
    statsSequenceRef.current = sequence;
    statsControllerRef.current?.abort();
    const controller = new AbortController();
    statsControllerRef.current = controller;
    if (background) setStatsRefreshing(true);
    else setStatsLoading(true);
    setStatsError('');
    try {
      const result = await getStorageStats({ signal: controller.signal });
      if (sequence === statsSequenceRef.current) setStats(result);
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === statsSequenceRef.current) setStatsError(error.message);
    } finally {
      if (!controller.signal.aborted && sequence === statsSequenceRef.current) {
        setStatsLoading(false);
        setStatsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadFiles();
    });
    return () => {
      active = false;
      fileControllerRef.current?.abort();
    };
  }, [loadFiles]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadStats();
    });
    return () => {
      active = false;
      statsControllerRef.current?.abort();
    };
  }, [loadStats]);

  useEffect(() => {
    if (activeView !== 'dashboard' || !pendingUploadFocusRef.current) return;
    pendingUploadFocusRef.current = false;
    requestAnimationFrame(() => {
      uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      uploadRef.current?.querySelector('.file-button')?.focus({ preventScroll: true });
    });
  }, [activeView]);

  async function signOut() {
    setAccountError('');
    try {
      await logout();
    } catch (error) {
      setAccountError(error.message);
    }
  }

  function changePage(nextPage) {
    if (nextPage === page || nextPage < 1) return;
    setPage(nextPage);
    document.querySelector('.files-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changeSort(nextSort) {
    if (activeView === 'trash') setTrashSort(nextSort);
    else setSort(nextSort);
    setPage(1);
  }

  function changeVisibility(nextVisibility) {
    setVisibility(nextVisibility);
    setPage(1);
  }

  function showUploader() {
    pendingUploadFocusRef.current = true;
    if (activeView !== 'dashboard') {
      setSearchParams({}, { replace: false });
      return;
    }
    pendingUploadFocusRef.current = false;
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    uploadRef.current?.querySelector('.file-button')?.focus({ preventScroll: true });
  }

  async function refreshAfterMutation({ firstPage = false } = {}) {
    void loadStats({ background: true });
    if (firstPage && page !== 1) setPage(1);
    else await loadFiles({ requestedPage: firstPage ? 1 : page });
  }

  function handleUploaded() {
    void refreshAfterMutation({ firstPage: effectiveSort === 'newest' });
  }

  function handleChanged() {
    return refreshAfterMutation();
  }

  function handleFavorite(changed) {
    if (activeView === 'favorites' && !changed.favorite) return loadFiles({ requestedPage: page });
    setFiles((current) => current.map((file) => file.id === changed.id ? changed : file));
    return Promise.resolve();
  }

  function handleStorageMutation() {
    return refreshAfterMutation();
  }

  function handleBulkMutation() {
    return refreshAfterMutation();
  }

  const listContent = {
    dashboard: ['Current Files', 'Your latest completed uploads.'],
    files: ['My Files', 'All active completed files in your secure vault.'],
    shared: ['Shared Files', 'Public files you own and have chosen to share.'],
    recent: ['Recent Files', 'Your active files ordered by most recent upload.'],
    favorites: ['Favorites', 'Active files you have marked for quick access.'],
    trash: ['Trash', 'Restore files or remove them permanently. Trashed files still use storage.'],
  }[activeView];

  return (
    <div className="app-shell dashboard-shell">
      <div className="dashboard-frame">
        <DashboardSidebar activeView={activeView} open={sidebarOpen} stats={stats} onClose={() => setSidebarOpen(false)} onNavigate={() => setPage(1)} onSignOut={signOut} />
        {sidebarOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

        <div className="dashboard-workspace">
          <header className="dashboard-topbar">
            <button type="button" className="mobile-menu-button" aria-label="Open navigation" aria-controls="dashboard-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
            <div className="topbar-welcome">
              <h1>Welcome back{displayName ? `, ${displayName}` : ''}</h1>
              <p>Here&apos;s what&apos;s happening with your files today.</p>
            </div>
            <label className="header-search"><span className="sr-only">Search all your files</span><Icon name="search" /><input type="search" value={searchInput} maxLength="100" placeholder="Search files" onChange={(event) => setSearchInput(event.target.value)} /></label>
            <button type="button" className="button button-primary header-upload" onClick={showUploader}><Icon name="upload" /> Upload</button>
            <span className="avatar" aria-label={`Account: ${displayName || user.email}`}>{avatarInitial}</span>
          </header>

          <main className="dashboard-main">
            {accountError && <p className="form-error dashboard-error" role="alert">{accountError}</p>}
            {activeView === 'dashboard' && (
              <>
                <section className="dashboard-page-heading" aria-labelledby="dashboard-heading"><div><p className="eyebrow">Dashboard overview</p><h2 id="dashboard-heading">Your secure workspace</h2></div><span className="secure-pill"><span><Icon name="lock" /></span> Storage protected</span></section>
                <StorageOverview stats={stats} loading={statsLoading} refreshing={statsRefreshing} error={statsError} onRetry={() => loadStats({ background: Boolean(stats) })} />
                <div id="upload" className="dashboard-upload-panel" ref={uploadRef}><UploadPanel onUploaded={handleUploaded} /></div>
              </>
            )}

            <FileList
              files={files}
              loading={filesLoading}
              error={filesError}
              pagination={pagination}
              onRetry={() => loadFiles()}
              onUpload={showUploader}
              onPageChange={changePage}
              onChange={handleChanged}
              onFavorite={handleFavorite}
              onTrash={handleStorageMutation}
              onRestore={handleStorageMutation}
              onDelete={handleStorageMutation}
              onBulkComplete={handleBulkMutation}
              title={listContent[0]}
              description={listContent[1]}
              search={searchInput}
              onSearchChange={setSearchInput}
              sort={effectiveSort}
              onSortChange={changeSort}
              visibility={visibility}
              onVisibilityChange={changeVisibility}
              sharedOnly={activeView === 'shared'}
              view={activeView}
            />
          </main>
          <AppFooter />
        </div>
      </div>
    </div>
  );
}
