import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { filePresentation } from '../utils/file-policy.js';
import { formatBytes, formatDate } from '../utils/format.js';
import { FileTypeIcon, Icon } from './Icons.jsx';

export function FileIcon({ mimeType }) {
  const presentation = filePresentation(mimeType);
  return (
    <span
      className={`file-icon file-${presentation.style}`}
      role="img"
      aria-label={`${presentation.badge} file type`}
    >
      <FileTypeIcon style={presentation.style} />
      <small>{presentation.badge}</small>
    </span>
  );
}

export function FileList({
  files,
  onChange,
  onDelete,
  loading,
  error,
  totalFiles,
  nextCursor,
  loadingMore,
  onLoadMore,
  onRetry,
}) {
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const deleteDialogRef = useRef(null);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (fileToDelete && !dialog.open) dialog.showModal();
    if (!fileToDelete && dialog.open) dialog.close();
  }, [fileToDelete]);

  async function changeVisibility(file) {
    setBusyId(file.id);
    setNotice('');
    try {
      const visibility = file.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
      const result = await apiFetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      });
      onChange(result.file);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyId(null);
    }
  }

  async function download(file) {
    setBusyId(file.id);
    try {
      const result = await apiFetch(`/api/files/${file.id}/download`);
      window.location.assign(result.url);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(file) {
    try {
      await navigator.clipboard.writeText(file.shareUrl);
      setNotice(`Link copied for ${file.originalName}.`);
    } catch {
      setNotice('Could not copy the link. Please copy it from the address bar.');
    }
  }

  function askToRemove(file) {
    setDeleteError('');
    setFileToDelete(file);
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
      await apiFetch(`/api/files/${file.id}`, { method: 'DELETE' });
      onDelete(file.id);
      setFileToDelete(null);
      setNotice(`${file.originalName} was deleted.`);
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="files-section" aria-labelledby="files-heading">
      <div className="section-heading file-heading">
        <div>
          <p className="eyebrow">File management</p>
          <h2 id="files-heading">Your Files</h2>
          <p>Review access, download securely, or manage sharing.</p>
        </div>
        <span className="file-count">
          {Number.isSafeInteger(totalFiles)
            ? `${totalFiles.toLocaleString()} total`
            : `${files.length.toLocaleString()} loaded`}
        </span>
      </div>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {error && files.length > 0 && (
        <div className="inline-file-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className="empty-state"><span className="spinner" /><p>Loading your files…</p></div>
      ) : error && files.length === 0 ? (
        <div className="empty-state file-error-state">
          <span className="empty-icon empty-icon-error"><Icon name="alert" /></span>
          <h3>Your files could not be loaded</h3>
          <p role="alert">{error}</p>
          <button type="button" className="button button-secondary" onClick={onRetry}>Retry</button>
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><Icon name="files" /></span>
          <h3>No files yet</h3>
          <p>Upload your first file to start building your Vaulta storage.</p>
          <a className="button button-primary empty-state-action" href="#upload">Upload files</a>
        </div>
      ) : (
        <div className="file-list">
          <div className="file-list-header" aria-hidden="true">
            <span>File</span><span>Visibility</span><span>Actions</span>
          </div>
          {files.map((file) => (
            <article className="file-row" key={file.id}>
              <FileIcon mimeType={file.mimeType} />
              <div className="file-main">
                <strong title={file.originalName}>{file.originalName}</strong>
                <span>{formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}</span>
              </div>
              <span className={`status status-${file.visibility.toLowerCase()}`}>
                <span aria-hidden="true" />{file.visibility === 'PUBLIC' ? 'Public' : 'Private'}
              </span>
              <div className="file-actions">
                {file.status === 'READY' && (
                  <>
                    <button type="button" className="action-button" disabled={busyId === file.id} onClick={() => download(file)}>Download</button>
                    <button type="button" className="action-button" disabled={busyId === file.id} onClick={() => changeVisibility(file)}>
                      Make {file.visibility === 'PUBLIC' ? 'private' : 'public'}
                    </button>
                    {file.visibility === 'PUBLIC' && <button type="button" className="action-button" onClick={() => copyLink(file)}>Copy link</button>}
                  </>
                )}
                <button type="button" className="action-button danger-text" disabled={busyId === file.id} onClick={() => askToRemove(file)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {nextCursor && !loading && (
        <div className="file-pagination">
          <span>{files.length.toLocaleString()} files loaded</span>
          <button
            type="button"
            className="button button-secondary"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      <dialog
        ref={deleteDialogRef}
        className="delete-dialog"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onCancel={cancelRemove}
      >
        <div className="delete-dialog-icon" aria-hidden="true">
          <Icon name="trash" />
        </div>
        <p className="eyebrow">Confirm deletion</p>
        <h3 id="delete-dialog-title">Delete this file?</h3>
        <p id="delete-dialog-description">
          <strong>“{fileToDelete?.originalName}”</strong> will be permanently deleted from your storage. This action cannot be undone.
        </p>
        {deleteError && <p className="form-error delete-dialog-error" role="alert">{deleteError}</p>}
        <div className="delete-dialog-actions">
          <button type="button" className="button button-secondary" disabled={busyId === fileToDelete?.id} onClick={cancelRemove}>Cancel</button>
          <button type="button" className="button button-danger" disabled={busyId === fileToDelete?.id} onClick={confirmRemove}>
            {busyId === fileToDelete?.id ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
