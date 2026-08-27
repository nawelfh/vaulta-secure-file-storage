import { useRef, useState } from 'react';
import { uploadFile } from '../api/uploads.js';
import { formatBytes } from '../utils/format.js';

const MAX_BYTES = 250 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/zip']);

function validate(file) {
  if (!file) return 'Choose a file first.';
  if (!ALLOWED_TYPES.has(file.type)) return 'Use a PDF, PNG, JPEG, TXT, or ZIP file.';
  if (file.size <= 0 || file.size > MAX_BYTES) return 'The file must be smaller than 250 MB.';
  return null;
}

export function UploadPanel({ onUploaded }) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  function choose(file) {
    const validationError = validate(file);
    setError(validationError || '');
    setSelected(validationError ? null : file);
    setProgress(0);
  }

  async function startUpload() {
    if (!selected || uploading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setError('');
    try {
      const file = await uploadFile(selected, {
        signal: controller.signal,
        onProgress: (loaded) => setProgress(Math.round((loaded / selected.size) * 100)),
      });
      setSelected(null);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded(file);
    } catch (uploadError) {
      setError(uploadError.name === 'AbortError' ? 'Upload cancelled.' : uploadError.message);
    } finally {
      abortRef.current = null;
      setUploading(false);
    }
  }

  return (
    <section className="upload-card" aria-labelledby="upload-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">New upload</p>
          <h2 id="upload-heading">Add a file to your vault</h2>
        </div>
        <span className="security-note">Private by default</span>
      </div>

      <div
        className={`drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        <span className="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
        </span>
        <div>
          <strong>{selected ? selected.name : 'Drop a file here'}</strong>
          <p>{selected ? formatBytes(selected.size) : 'PDF, PNG, JPEG, TXT or ZIP · up to 250 MB'}</p>
        </div>
        <label className="button button-secondary file-button">
          Browse files
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.zip"
            disabled={uploading}
            onChange={(event) => choose(event.target.files[0])}
          />
        </label>
      </div>

      {uploading && (
        <div className="progress-row" aria-live="polite">
          <div className="progress-meta"><span>Encrypting connection and uploading…</span><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="upload-actions">
        {uploading ? (
          <button className="button button-ghost danger-text" type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button>
        ) : (
          <button className="button button-primary" type="button" disabled={!selected} onClick={startUpload}>Upload securely</button>
        )}
      </div>
    </section>
  );
}
