import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { filePresentation } from '../utils/file-policy.js';
import { formatBytes, formatDate } from '../utils/format.js';
import { FileTypeIcon, Icon } from './Icons.jsx';

export function FileIcon({ mimeType }) {
  const presentation = filePresentation(mimeType);
  return (
    <span className={`file-icon file-${presentation.style}`} role="img" aria-label={`${presentation.badge} file type`}>
      <FileTypeIcon style={presentation.style} />
      <small>{presentation.badge}</small>
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
  files, onChange, onFavorite, onTrash, onRestore, onDelete, loading = false, error = '', pagination, onPageChange,
  onRetry, onUpload, title = 'Your Files', description = 'Review access, download securely, or manage sharing.',
  search, onSearchChange, sort, onSortChange, visibility, onVisibilityChange, sharedOnly = false, view = 'dashboard',
}) {
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deleteKind, setDeleteKind] = useState('trash');
  const [deleteError, setDeleteError] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const deleteDialogRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRefs = useRef(new Map());
  const focusMenuOnOpen = useRef(false);
  const menuScope = `${view}:${pagination?.page || 1}`;
  const activeMenu = openMenu?.scope === menuScope ? openMenu : null;

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (fileToDelete && !dialog.open) dialog.showModal();
    if (!fileToDelete && dialog.open) dialog.close();
  }, [fileToDelete]);

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
        <label className="toolbar-search"><span className="sr-only">Search files</span><Icon name="search" /><input type="search" value={search} maxLength="100" placeholder="Search file names" onChange={(event) => onSearchChange(event.target.value)} /></label>
        {view === 'recent' ? <span className="toolbar-fixed-filter"><Icon name="clock" /> Newest first</span> : (
          <label><span>Sort</span><select value={sort} onChange={(event) => onSortChange(event.target.value)}>{view === 'trash' ? <><option value="deleted-newest">Recently deleted</option><option value="deleted-oldest">Oldest deleted</option></> : <><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="size-asc">Smallest first</option><option value="size-desc">Largest first</option></>}</select></label>
        )}
        {sharedOnly ? <span className="toolbar-fixed-filter"><Icon name="globe" /> Public files</span> : view === 'trash' ? <span className="toolbar-fixed-filter"><Icon name="trash" /> Trashed files</span> : (
          <label><span>Visibility</span><select value={visibility} onChange={(event) => onVisibilityChange(event.target.value)}><option value="">All files</option><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></label>
        )}
      </div>

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
        <div className="file-table" role="table" aria-label="Files">
          <div className="file-table-header" role="row"><span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Visibility</span><span role="columnheader">{view === 'trash' ? 'Trashed' : 'Uploaded'}</span><span role="columnheader">Actions</span></div>
          {files.map((file) => {
            const presentation = filePresentation(file.mimeType);
            return (
              <article className={`file-row${activeMenu?.fileId === file.id ? ' has-open-menu' : ''}`} key={file.id} role="row">
                <div className="file-name-cell" role="cell"><FileIcon mimeType={file.mimeType} /><strong title={file.originalName}>{file.originalName}</strong></div>
                <span className="file-type-cell" role="cell">
                  <span className={`file-type-badge file-${presentation.style}`}>{presentation.badge}</span>
                </span>
                <span role="cell">{formatBytes(file.sizeBytes)}</span>
                <span role="cell" className={`status status-${file.visibility.toLowerCase()}`}><Icon name={file.visibility === 'PUBLIC' ? 'globe' : 'lock'} />{file.visibility === 'PUBLIC' ? 'Public' : 'Private'}</span>
                <time role="cell" dateTime={view === 'trash' ? file.trashedAt : file.createdAt}>{formatDate(view === 'trash' ? file.trashedAt : file.createdAt)}</time>
                <div className="file-actions" role="cell">
                  {view !== 'trash' && (
                    <button type="button" className={`action-button favorite-button${file.favorite ? ' is-favorite' : ''}`} aria-label={file.favorite ? 'Remove from favorites' : 'Add to favorites'} title={file.favorite ? 'Remove from favorites' : 'Add to favorites'} disabled={busyId === file.id} onClick={(event) => { event.stopPropagation(); changeFavorite(file); }}><Icon name="star" /></button>
                  )}
                  <button
                    type="button"
                    className="action-button actions-menu-trigger"
                    aria-label={`Open actions for ${file.originalName}`}
                    aria-haspopup="menu"
                    aria-expanded={activeMenu?.fileId === file.id}
                    aria-controls={activeMenu?.fileId === file.id ? `file-actions-${file.id}` : undefined}
                    disabled={busyId === file.id}
                    ref={(node) => { if (node) menuButtonRefs.current.set(file.id, node); else menuButtonRefs.current.delete(file.id); }}
                    onClick={(event) => toggleMenu(event, file.id)}
                  ><Icon name="moreVertical" /></button>
                  {activeMenu?.fileId === file.id && (
                    <div ref={menuRef} id={`file-actions-${file.id}`} className="actions-menu" role="menu" aria-label={`Actions for ${file.originalName}`} onClick={(event) => event.stopPropagation()} onKeyDown={handleMenuKeyDown}>
                      {view === 'trash' ? <>
                        <button type="button" role="menuitem" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => restore(file))}><Icon name="restore" /> Restore</button>
                        <div className="actions-menu-divider" role="separator" />
                        <button type="button" role="menuitem" className="danger-text" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => { setDeleteError(''); setDeleteKind('permanent'); setFileToDelete(file); })}><Icon name="trash" /> Delete permanently</button>
                      </> : <>
                        <button type="button" role="menuitem" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => download(file))}><Icon name="download" /> Download</button>
                        {file.visibility === 'PUBLIC' && <button type="button" role="menuitem" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => copyLink(file))}><Icon name="link" /> Copy public link</button>}
                        <button type="button" role="menuitem" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => changeVisibility(file))}><Icon name={file.visibility === 'PUBLIC' ? 'lock' : 'globe'} /> Make {file.visibility === 'PUBLIC' ? 'private' : 'public'}</button>
                        <div className="actions-menu-divider" role="separator" />
                        <button type="button" role="menuitem" className="danger-text" disabled={busyId === file.id} onClick={(event) => selectMenuAction(event, () => { setDeleteError(''); setDeleteKind('trash'); setFileToDelete(file); })}><Icon name="trash" /> Move to Trash</button>
                      </>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !error && <Pagination pagination={pagination} onPageChange={onPageChange} />}

      <dialog ref={deleteDialogRef} className="delete-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onCancel={cancelRemove}>
        <div className="delete-dialog-icon" aria-hidden="true"><Icon name="trash" /></div><p className="eyebrow">{deleteKind === 'trash' ? 'Move file' : 'Confirm deletion'}</p><h3 id="delete-dialog-title">{deleteKind === 'trash' ? 'Move this file to Trash?' : 'Delete this file permanently?'}</h3>
        <p id="delete-dialog-description"><strong>“{fileToDelete?.originalName}”</strong> {deleteKind === 'trash' ? 'will leave normal file views and can be restored later.' : 'will be removed from storage. This action cannot be undone.'}</p>
        {deleteError && <p className="form-error delete-dialog-error" role="alert">{deleteError}</p>}
        <div className="delete-dialog-actions"><button type="button" className="button button-secondary" disabled={busyId === fileToDelete?.id} onClick={cancelRemove}>Cancel</button><button type="button" className={deleteKind === 'trash' ? 'button button-primary' : 'button button-danger'} disabled={busyId === fileToDelete?.id} onClick={confirmRemove}>{busyId === fileToDelete?.id ? 'Working…' : deleteKind === 'trash' ? 'Move to Trash' : 'Delete permanently'}</button></div>
      </dialog>
    </section>
  );
}
