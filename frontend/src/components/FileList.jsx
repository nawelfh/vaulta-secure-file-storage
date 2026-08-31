import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { filePresentation } from '../utils/file-policy.js';
import { formatDate, formatFileSize } from '../utils/format.js';
import { FileTypeIcon, Icon } from './Icons.jsx';

const BULK_CONCURRENCY = 2;
const EMPTY_SELECTION = new Set();
const IMAGE_PREVIEW_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_INLINE_PREVIEW_BYTES = 2 * 1024 * 1024;

async function runBounded(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(BULK_CONCURRENCY, items.length) },
    () => runWorker(),
  );
  await Promise.allSettled(workers);
  return results;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

export function FileIcon({ mimeType }) {
  const presentation = filePresentation(mimeType);
  return (
    <span className={`file-icon file-${presentation.style}`} role="img" aria-label={`${presentation.badge} file type`}>
      <FileTypeIcon style={presentation.style} />
      <small>{presentation.badge}</small>
    </span>
  );
}

function canLoadInlinePreview(file) {
  return IMAGE_PREVIEW_TYPES.has(file.mimeType)
    && Number.isSafeInteger(file.sizeBytes)
    && file.sizeBytes > 0
    && file.sizeBytes <= MAX_INLINE_PREVIEW_BYTES
    && file.status === 'READY'
    && !file.trashedAt;
}

export function FilePreview({ file }) {
  const previewable = canLoadInlinePreview(file);
  const previewKey = `${file.id}:${file.mimeType}:${file.sizeBytes}`;
  const [preview, setPreview] = useState({ key: '', url: '', loaded: false, failed: false });

  useEffect(() => {
    if (!previewable) return undefined;
    const controller = new AbortController();
    let current = true;

    apiFetch(`/api/files/${file.id}/download`, { signal: controller.signal })
      .then((result) => {
        if (!current) return;
        if (typeof result?.url !== 'string' || !result.url) {
          setPreview({ key: previewKey, url: '', loaded: false, failed: true });
          return;
        }
        setPreview({ key: previewKey, url: result.url, loaded: false, failed: false });
      })
      .catch((error) => {
        if (current && error?.name !== 'AbortError') {
          setPreview({ key: previewKey, url: '', loaded: false, failed: true });
        }
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [file.id, previewable, previewKey]);

  const showImage = previewable && preview.key === previewKey && preview.url && !preview.failed;

  return (
    <span className="file-preview" data-preview-state={showImage && preview.loaded ? 'ready' : showImage ? 'loading' : 'fallback'}>
      {(!showImage || !preview.loaded) && <FileIcon mimeType={file.mimeType} />}
      {showImage && (
        <img
          className={preview.loaded ? 'is-loaded' : ''}
          src={preview.url}
          alt={`Preview of ${file.originalName}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setPreview((current) => ({ ...current, loaded: true }))}
          onError={() => setPreview({ key: previewKey, url: '', loaded: false, failed: true })}
        />
      )}
    </span>
  );
}

function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page > 0 && page <= total)
    .sort((a, b) => a - b);
  const result = [];
  pages.forEach((page, index) => {
    if (index && page - pages[index - 1] > 1) result.push(`gap-${page}`);
    result.push(page);
  });
  return result;
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;
  const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);
  return (
    <div className="file-pagination">
      <span>Showing {start} to {end} of {pagination.total.toLocaleString()}</span>
      {pagination.totalPages > 1 && (
        <nav className="page-buttons" aria-label="File pages">
          <button type="button" aria-label="Previous page" disabled={!pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}><Icon name="chevronLeft" /></button>
          {pageItems(pagination.page, pagination.totalPages).map((item) => (
            typeof item === 'number' ? (
              <button type="button" key={item} aria-label={`Page ${item}`} aria-current={item === pagination.page ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>
            ) : <span key={item} aria-hidden="true">…</span>
          ))}
          <button type="button" aria-label="Next page" disabled={!pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}><Icon name="chevronRight" /></button>
        </nav>
      )}
    </div>
  );
}

export function FileList({
  files, onChange, onFavorite, onTrash, onRestore, onDelete, onBulkComplete, loading = false, error = '', pagination, onPageChange,
  onRetry, onUpload, title = 'Your Files', description = 'Review access, download securely, or manage sharing.',
  search, onSearchChange, sort, onSortChange, visibility, onVisibilityChange, sharedOnly = false, view = 'dashboard',
}) {
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deleteKind, setDeleteKind] = useState('trash');
  const [deleteError, setDeleteError] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const [selection, setSelection] = useState(() => ({ scope: '', ids: new Set() }));
  const [bulkOperation, setBulkOperation] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const deleteDialogRef = useRef(null);
  const bulkDialogRef = useRef(null);
  const selectAllRef = useRef(null);
  const mobileSelectAllRef = useRef(null);
  const bulkRunningRef = useRef(false);
  const onBulkCompleteRef = useRef(onBulkComplete);
  const menuRef = useRef(null);
  const menuButtonRefs = useRef(new Map());
  const focusMenuOnOpen = useRef(false);
  const menuScope = `${view}:${pagination?.page || 1}`;
  const activeMenu = openMenu?.scope === menuScope ? openMenu : null;
  const selectionScope = JSON.stringify([view, pagination?.page || 1, search, sort, visibility, sharedOnly]);
  const visibleIds = files.map((file) => file.id);
  const selectedIds = selection.scope === selectionScope ? selection.ids : EMPTY_SELECTION;
  const bulkAction = bulkOperation?.scope === selectionScope ? bulkOperation.action : null;
  const selectedFiles = files.filter((file) => selectedIds.has(file.id));
  const allSelected = files.length > 0 && selectedFiles.length === files.length;
  const someSelected = selectedFiles.length > 0 && !allSelected;

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (fileToDelete && !dialog.open) dialog.showModal();
    if (!fileToDelete && dialog.open) dialog.close();
  }, [fileToDelete]);

  useEffect(() => {
    onBulkCompleteRef.current = onBulkComplete;
  }, [onBulkComplete]);

  useEffect(() => {
    const dialog = bulkDialogRef.current;
    if (bulkAction && !dialog.open) dialog.showModal();
    if (!bulkAction && dialog.open) dialog.close();
  }, [bulkAction]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
    if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    if (!activeMenu) return undefined;

    if (focusMenuOnOpen.current) {
      menuRef.current?.querySelector('[role="menuitem"]')?.focus();
      focusMenuOnOpen.current = false;
    }

    function closeFromOutside(event) {
      if (!menuRef.current?.contains(event.target)
        && !menuButtonRefs.current.get(activeMenu.fileId)?.contains(event.target)) {
        setOpenMenu(null);
      }
    }

    function closeFromEscape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenMenu(null);
      menuButtonRefs.current.get(activeMenu.fileId)?.focus();
    }

    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [activeMenu]);

  function toggleMenu(event, fileId) {
    event.stopPropagation();
    const isOpen = activeMenu?.fileId === fileId;
    focusMenuOnOpen.current = !isOpen;
    setOpenMenu(isOpen ? null : { fileId, scope: menuScope });
  }

  function selectMenuAction(event, action) {
    event.stopPropagation();
    setOpenMenu(null);
    action();
  }

  function handleMenuKeyDown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items.at(-1).focus();
    else if (event.key === 'ArrowDown') items[(currentIndex + 1) % items.length].focus();
    else items[(currentIndex - 1 + items.length) % items.length].focus();
  }

  async function changeVisibility(file) {
    setBusyId(file.id);
    setNotice('');
    try {
      const nextVisibility = file.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
      const result = await apiFetch(`/api/files/${file.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: nextVisibility }) });
      await onChange(result.file);
      setNotice(`${file.originalName} is now ${nextVisibility.toLowerCase()}.`);
    } catch (actionError) {
      setNotice(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function download(file) {
    setBusyId(file.id);
    setNotice('');
    try {
      const result = await apiFetch(`/api/files/${file.id}/download`);
      window.location.assign(result.url);
    } catch (actionError) {
      setNotice(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(file) {
    try {
      await navigator.clipboard.writeText(file.shareUrl);
      setNotice(`Link copied for ${file.originalName}.`);
    } catch {
      setNotice('Could not copy the link. Please try again.');
    }
  }

  async function changeFavorite(file) {
    setBusyId(file.id);
    setNotice('');
    try {
      const result = await apiFetch(`/api/files/${file.id}/favorite`, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: !file.favorite }),
      });
      await onFavorite(result.file);
      setNotice(`${file.originalName} was ${result.file.favorite ? 'added to' : 'removed from'} favorites.`);
    } catch (actionError) {
      setNotice(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function restore(file) {
    setBusyId(file.id);
    setNotice('');
    try {
      await apiFetch(`/api/files/${file.id}/restore`, { method: 'POST' });
      setNotice(`${file.originalName} was restored.`);
      await onRestore(file.id);
    } catch (actionError) {
      setNotice(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  function cancelRemove(event) {
    if (busyId === fileToDelete?.id) {
      event?.preventDefault();
      return;
    }
    setFileToDelete(null);
    setDeleteError('');
  }

  async function confirmRemove() {
    if (!fileToDelete) return;
    const file = fileToDelete;
    setBusyId(file.id);
    setNotice('');
    setDeleteError('');
    try {
      if (deleteKind === 'trash') {
        await apiFetch(`/api/files/${file.id}/trash`, { method: 'POST' });
      } else {
        await apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
      }
      setFileToDelete(null);
      setNotice(deleteKind === 'trash' ? `${file.originalName} was moved to Trash.` : `${file.originalName} was permanently deleted.`);
      await (deleteKind === 'trash' ? onTrash(file.id) : onDelete(file.id));
    } catch (actionError) {
      setDeleteError(actionError.message);
    } finally {
      setBusyId(null);
    }
  }

  function toggleFileSelection(fileId) {
    setSelection(() => {
      const next = new Set(selectedIds);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return { scope: selectionScope, ids: next };
    });
  }

  function toggleAllVisible() {
    setSelection({ scope: selectionScope, ids: allSelected ? new Set() : new Set(visibleIds) });
  }

  function clearSelection() {
    setSelection({ scope: selectionScope, ids: new Set() });
  }

  function changePage(nextPage) {
    clearSelection();
    onPageChange(nextPage);
  }

  function changeSearch(nextSearch) {
    clearSelection();
    onSearchChange(nextSearch);
  }

  function changeSort(nextSort) {
    clearSelection();
    onSortChange(nextSort);
  }

  function changeVisibilityFilter(nextVisibility) {
    clearSelection();
    onVisibilityChange(nextVisibility);
  }

  function cancelBulk(event) {
    if (bulkRunningRef.current) {
      event?.preventDefault();
      return;
    }
    setBulkOperation(null);
  }

  async function confirmBulk() {
    if (!bulkAction || bulkRunningRef.current || busyId) return;
    const action = bulkAction;
    const targets = selectedFiles;
    if (targets.length === 0) {
      setBulkOperation(null);
      return;
    }

    bulkRunningRef.current = true;
    setBulkRunning(true);
    setNotice('');
    const results = await runBounded(targets, (file) => {
      if (action === 'trash') return apiFetch(`/api/files/${file.id}/trash`, { method: 'POST' });
      if (action === 'restore') return apiFetch(`/api/files/${file.id}/restore`, { method: 'POST' });
      return apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
    });
    const succeededIds = targets.filter((_, index) => results[index].status === 'fulfilled').map((file) => file.id);
    const failedIds = targets.filter((_, index) => results[index].status === 'rejected').map((file) => file.id);
    const succeeded = succeededIds.length;
    const failed = failedIds.length;
    const successCopy = action === 'trash'
      ? `${succeeded} ${plural(succeeded, 'file')} moved to Trash.`
      : action === 'restore'
        ? `${succeeded} ${plural(succeeded, 'file')} restored.`
        : `${succeeded} ${plural(succeeded, 'file')} permanently deleted.`;
    const failureCopy = failed > 0 ? ` ${failed} ${plural(failed, 'file')} could not be ${action === 'trash' ? 'moved' : action === 'restore' ? 'restored' : 'deleted'}.` : '';

    setSelection({ scope: selectionScope, ids: new Set(failedIds) });
    setBulkOperation(null);
    setNotice(`${successCopy}${failureCopy}`);
    bulkRunningRef.current = false;
    setBulkRunning(false);
    if (succeeded > 0) await onBulkCompleteRef.current?.({ action, succeededIds, failedIds, successCount: succeeded });
  }

  const bulkCount = selectedFiles.length;
  const bulkHeading = bulkAction === 'trash'
    ? `Move ${bulkCount} ${plural(bulkCount, 'file')} to Trash?`
    : bulkAction === 'restore'
      ? `Restore ${bulkCount} ${plural(bulkCount, 'file')}?`
      : `Permanently delete ${bulkCount} ${plural(bulkCount, 'file')}?`;

  const emptyCopy = search
    ? `No files match “${search}”.`
    : sharedOnly ? 'You have no public files.'
      : view === 'favorites' ? 'Files you favorite will appear here.'
        : view === 'trash' ? 'Files moved to Trash will appear here.'
          : 'Upload your first file to start building your Vaulta storage.';

  return (
    <section className="files-section" aria-labelledby="files-heading" aria-busy={loading}>
      <div className="section-heading file-heading">
        <div><p className="eyebrow">File management</p><h2 id="files-heading">{title}</h2><p>{description}</p></div>
        <span className="file-count">{pagination ? `${pagination.total.toLocaleString()} total` : `${files.length} loaded`}</span>
      </div>

      <div className="file-toolbar">
        <label className="toolbar-search"><span className="sr-only">Search files</span><Icon name="search" /><input type="search" value={search} maxLength="100" placeholder="Search file names" onChange={(event) => changeSearch(event.target.value)} /></label>
        {view === 'recent' ? <span className="toolbar-fixed-filter"><Icon name="clock" /> Newest first</span> : (
          <label><span>Sort</span><select value={sort} onChange={(event) => changeSort(event.target.value)}>{view === 'trash' ? <><option value="deleted-newest">Recently deleted</option><option value="deleted-oldest">Oldest deleted</option></> : <><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="size-asc">Smallest first</option><option value="size-desc">Largest first</option></>}</select></label>
        )}
        {sharedOnly ? <span className="toolbar-fixed-filter"><Icon name="globe" /> Public files</span> : view === 'trash' ? <span className="toolbar-fixed-filter"><Icon name="trash" /> Trashed files</span> : (
          <label><span>Visibility</span><select value={visibility} onChange={(event) => changeVisibilityFilter(event.target.value)}><option value="">All files</option><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></label>
        )}
      </div>

      {bulkCount > 0 && (
        <div className="bulk-action-toolbar" aria-label="Bulk file actions">
          <strong>{bulkCount} selected</strong>
          <div>
            {view === 'trash' ? (
              <>
                <button type="button" className="button button-secondary" disabled={bulkRunning || Boolean(busyId)} onClick={() => setBulkOperation({ scope: selectionScope, action: 'restore' })}>Restore selected files</button>
                <button type="button" className="button button-danger" disabled={bulkRunning || Boolean(busyId)} onClick={() => setBulkOperation({ scope: selectionScope, action: 'permanent' })}>Delete selected files permanently</button>
              </>
            ) : (
              <button type="button" className="button button-primary" disabled={bulkRunning || Boolean(busyId)} onClick={() => setBulkOperation({ scope: selectionScope, action: 'trash' })}>Move selected files to Trash</button>
            )}
            <button type="button" className="bulk-clear-button" disabled={bulkRunning} onClick={clearSelection}>Clear selection</button>
          </div>
        </div>
      )}

      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {loading && files.length > 0 && <p className="table-loading" role="status"><span className="spinner" /> Updating files…</p>}
      {error && files.length > 0 && <div className="inline-file-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div>}
      {loading && files.length === 0 ? (
        <div className="empty-state"><span className="spinner" /><p>Loading your files…</p></div>
      ) : error && files.length === 0 ? (
        <div className="empty-state file-error-state"><span className="empty-icon empty-icon-error"><Icon name="alert" /></span><h3>Your files could not be loaded</h3><p role="alert">{error}</p><button type="button" className="button button-secondary" onClick={onRetry}>Retry</button></div>
      ) : files.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><Icon name={sharedOnly ? 'globe' : view === 'favorites' ? 'star' : view === 'trash' ? 'trash' : 'files'} /></span><h3>{search ? 'No matching files' : sharedOnly ? 'Nothing shared yet' : view === 'favorites' ? 'No favorites yet' : view === 'trash' ? 'Trash is empty' : 'No files yet'}</h3><p>{emptyCopy}</p>{!search && !sharedOnly && !['favorites', 'trash'].includes(view) && <button type="button" className="button button-primary empty-state-action" onClick={onUpload}>Upload files</button>}</div>
      ) : (
        <>
          <label className="mobile-select-all">
            <input
              ref={mobileSelectAllRef}
              type="checkbox"
              checked={allSelected}
              aria-checked={someSelected ? 'mixed' : allSelected}
              disabled={bulkRunning || Boolean(busyId)}
              onChange={toggleAllVisible}
            />
            Select all files on this page
          </label>
          <div className="file-table" role="table" aria-label="Files">
          <div className="file-table-header" role="row">
            <span className="selection-cell" role="columnheader">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                aria-checked={someSelected ? 'mixed' : allSelected}
                aria-label="Select all files on this page"
                disabled={bulkRunning || Boolean(busyId)}
                onChange={toggleAllVisible}
              />
            </span>
            <span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Visibility</span><span role="columnheader">{view === 'trash' ? 'Trashed' : 'Uploaded'}</span><span role="columnheader">Actions</span>
          </div>
          {files.map((file) => {
            const presentation = filePresentation(file.mimeType);
            const rowBusy = busyId === file.id || (bulkRunning && selectedIds.has(file.id));
            return (
              <article className={`file-row${selectedIds.has(file.id) ? ' is-selected' : ''}${activeMenu?.fileId === file.id ? ' has-open-menu' : ''}`} key={file.id} role="row">
                <span className="selection-cell" role="cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(file.id)}
                    aria-label={`Select ${file.originalName}`}
                    disabled={bulkRunning || busyId === file.id}
                    onChange={() => toggleFileSelection(file.id)}
                  />
                </span>
                <div className="file-name-cell" role="cell"><FilePreview file={file} /><strong title={file.originalName}>{file.originalName}</strong></div>
                <span className="file-type-cell" role="cell">
                  <span className={`file-type-badge file-${presentation.style}`}>{presentation.badge}</span>
                </span>
                <span className="file-size-cell" role="cell">{formatFileSize(file.sizeBytes)}</span>
                <span role="cell" className={`status status-${file.visibility.toLowerCase()}`}><Icon name={file.visibility === 'PUBLIC' ? 'globe' : 'lock'} />{file.visibility === 'PUBLIC' ? 'Public' : 'Private'}</span>
                <time className="file-date-cell" role="cell" dateTime={view === 'trash' ? file.trashedAt : file.createdAt}>{formatDate(view === 'trash' ? file.trashedAt : file.createdAt)}</time>
                <div className="file-actions" role="cell">
                  {view !== 'trash' && (
                    <button type="button" className={`action-button favorite-button${file.favorite ? ' is-favorite' : ''}`} aria-label={file.favorite ? 'Remove from favorites' : 'Add to favorites'} title={file.favorite ? 'Remove from favorites' : 'Add to favorites'} disabled={rowBusy} onClick={(event) => { event.stopPropagation(); changeFavorite(file); }}><Icon name="star" /></button>
                  )}
                  <button
                    type="button"
                    className="action-button actions-menu-trigger"
                    aria-label={`Open actions for ${file.originalName}`}
                    aria-haspopup="menu"
                    aria-expanded={activeMenu?.fileId === file.id}
                    aria-controls={activeMenu?.fileId === file.id ? `file-actions-${file.id}` : undefined}
                    disabled={rowBusy}
                    ref={(node) => { if (node) menuButtonRefs.current.set(file.id, node); else menuButtonRefs.current.delete(file.id); }}
                    onClick={(event) => toggleMenu(event, file.id)}
                  ><Icon name="moreVertical" /></button>
                  {activeMenu?.fileId === file.id && (
                    <div ref={menuRef} id={`file-actions-${file.id}`} className="actions-menu" role="menu" aria-label={`Actions for ${file.originalName}`} onClick={(event) => event.stopPropagation()} onKeyDown={handleMenuKeyDown}>
                      {view === 'trash' ? <>
                        <button type="button" role="menuitem" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => restore(file))}><Icon name="restore" /> Restore</button>
                        <div className="actions-menu-divider" role="separator" />
                        <button type="button" role="menuitem" className="danger-text" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => { setDeleteError(''); setDeleteKind('permanent'); setFileToDelete(file); })}><Icon name="trash" /> Delete permanently</button>
                      </> : <>
                        <button type="button" role="menuitem" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => download(file))}><Icon name="download" /> Download</button>
                        {file.visibility === 'PUBLIC' && <button type="button" role="menuitem" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => copyLink(file))}><Icon name="link" /> Copy public link</button>}
                        <button type="button" role="menuitem" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => changeVisibility(file))}><Icon name={file.visibility === 'PUBLIC' ? 'lock' : 'globe'} /> Make {file.visibility === 'PUBLIC' ? 'private' : 'public'}</button>
                        <div className="actions-menu-divider" role="separator" />
                        <button type="button" role="menuitem" className="danger-text" disabled={rowBusy} onClick={(event) => selectMenuAction(event, () => { setDeleteError(''); setDeleteKind('trash'); setFileToDelete(file); })}><Icon name="trash" /> Move to Trash</button>
                      </>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          </div>
        </>
      )}
      {!loading && !error && <Pagination pagination={pagination} onPageChange={changePage} />}

      <dialog ref={deleteDialogRef} className="delete-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onCancel={cancelRemove}>
        <div className="delete-dialog-icon" aria-hidden="true"><Icon name="trash" /></div><p className="eyebrow">{deleteKind === 'trash' ? 'Move file' : 'Confirm deletion'}</p><h3 id="delete-dialog-title">{deleteKind === 'trash' ? 'Move this file to Trash?' : 'Delete this file permanently?'}</h3>
        <p id="delete-dialog-description"><strong>“{fileToDelete?.originalName}”</strong> {deleteKind === 'trash' ? 'will leave normal file views and can be restored later.' : 'will be removed from storage. This action cannot be undone.'}</p>
        {deleteError && <p className="form-error delete-dialog-error" role="alert">{deleteError}</p>}
        <div className="delete-dialog-actions"><button type="button" className="button button-secondary" disabled={busyId === fileToDelete?.id} onClick={cancelRemove}>Cancel</button><button type="button" className={deleteKind === 'trash' ? 'button button-primary' : 'button button-danger'} disabled={busyId === fileToDelete?.id} onClick={confirmRemove}>{busyId === fileToDelete?.id ? 'Working…' : deleteKind === 'trash' ? 'Move to Trash' : 'Delete permanently'}</button></div>
      </dialog>

      <dialog ref={bulkDialogRef} className="delete-dialog" aria-labelledby="bulk-dialog-title" aria-describedby="bulk-dialog-description" onCancel={cancelBulk}>
        <div className="delete-dialog-icon" aria-hidden="true"><Icon name={bulkAction === 'restore' ? 'restore' : 'trash'} /></div>
        <p className="eyebrow">{bulkAction === 'trash' ? 'Move files' : bulkAction === 'restore' ? 'Restore files' : 'Confirm deletion'}</p>
        <h3 id="bulk-dialog-title">{bulkHeading}</h3>
        <p id="bulk-dialog-description">
          {bulkAction === 'trash' && 'These files will leave normal file views and can be restored later.'}
          {bulkAction === 'restore' && 'These files will return to their previous active views.'}
          {bulkAction === 'permanent' && 'These files will be removed from storage. This action cannot be undone.'}
        </p>
        <div className="delete-dialog-actions">
          <button type="button" className="button button-secondary" disabled={bulkRunning} onClick={cancelBulk}>Cancel</button>
          <button type="button" className={bulkAction === 'permanent' ? 'button button-danger' : 'button button-primary'} disabled={bulkRunning || Boolean(busyId)} onClick={confirmBulk}>
            {bulkRunning ? 'Working…' : bulkAction === 'trash' ? 'Move to Trash' : bulkAction === 'restore' ? 'Restore files' : 'Delete permanently'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
