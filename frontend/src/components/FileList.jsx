import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { formatBytes, formatDate } from '../utils/format.js';

function FileIcon({ mimeType }) {
  const label = mimeType === 'application/pdf' ? 'PDF'
    : mimeType === 'application/zip' ? 'ZIP'
      : mimeType.startsWith('image/') ? 'IMG' : 'TXT';
  return <span className={`file-icon file-${label.toLowerCase()}`}>{label}</span>;
}

export function FileList({ files, onChange, onDelete, loading }) {
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
          <p className="eyebrow">Your storage</p>
          <h2 id="files-heading">Files</h2>
        </div>
        <span className="file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
      </div>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {loading ? (
        <div className="empty-state"><span className="spinner" /><p>Loading your files…</p></div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">◇</span>
          <h3>Your vault is empty</h3>
          <p>Upload your first file. Everything starts private.</p>
        </div>
      ) : (
        <div className="file-list">
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
      <dialog
        ref={deleteDialogRef}
        className="delete-dialog"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onCancel={cancelRemove}
      >
        <div className="delete-dialog-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
          </svg>
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
