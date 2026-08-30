import { useEffect, useRef, useState } from 'react';
import { UPLOAD_ERROR_KINDS, uploadFile } from '../api/uploads.js';
import {
  FILE_INPUT_ACCEPT,
  MAX_FILE_SIZE_BYTES,
  policyForFile,
  SUPPORTED_FORMAT_GUIDANCE,
} from '../utils/file-policy.js';
import { formatBytes } from '../utils/format.js';

const ACTIVE_PHASES = new Set(['preparing', 'uploading', 'verifying']);

function validate(file) {
  if (!file) return 'Choose a file first.';
  if (!policyForFile(file)) return 'The file extension and type must match a supported format.';
  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) return 'The file must be 250 MiB or smaller.';
  return null;
}

function uploadFailure(error) {
  const reference = error?.requestId;
  switch (error?.kind) {
    case UPLOAD_ERROR_KINDS.API_INITIATION:
      return { message: 'Vaulta could not prepare this upload. Please try again.', reference };
    case UPLOAD_ERROR_KINDS.PART_AUTHORIZATION:
      return { message: 'Vaulta could not authorize the file transfer. Please try again.', reference };
    case UPLOAD_ERROR_KINDS.STORAGE_NETWORK:
      return { message: 'The upload could not reach file storage. Check your connection and try again.' };
    case UPLOAD_ERROR_KINDS.STORAGE_REJECTED:
      return { message: 'File storage rejected part of the upload. Please try again.' };
    case UPLOAD_ERROR_KINDS.MISSING_ETAG:
      return { message: 'File storage returned an incomplete response. Please try again.' };
    case UPLOAD_ERROR_KINDS.FINALIZATION:
      if (error.code === 'FILE_CONTENT_MISMATCH') {
        return { message: 'Vaulta could not verify this file because its contents do not match its file type.', reference };
      }
      if (error.code === 'FILE_SIZE_MISMATCH') {
        return { message: 'Vaulta could not verify this file because its uploaded size changed.', reference };
      }
      return { message: 'Vaulta could not verify and finalize this upload. Please try again.', reference };
    default:
      return { message: 'The upload could not be completed. Please try again.', reference };
  }
}

function phaseMessage(phase, progress) {
  switch (phase) {
    case 'selected':
      return { title: 'Ready to upload', detail: 'Review the file, then press Upload securely.' };
    case 'preparing':
      return { title: 'Preparing upload', detail: 'Vaulta is creating a secure file transfer.' };
    case 'uploading':
      return { title: `Uploading securely — ${progress}%`, detail: 'File bytes are being transferred to storage.' };
    case 'verifying':
      return { title: 'Upload transferred', detail: 'Vaulta is finalizing and verifying the file.' };
    case 'complete':
      return { title: 'Upload complete', detail: 'The file is ready in your vault.' };
    case 'cancelled':
      return { title: 'Upload cancelled', detail: 'The selected file is still ready if you want to try again.' };
    default:
      return null;
  }
}

export function UploadPanel({ onUploaded }) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const activeUploadRef = useRef(false);
  const [selected, setSelected] = useState(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  const active = ACTIVE_PHASES.has(phase);

  useEffect(() => () => abortRef.current?.abort(), []);

  function choose(file) {
    const validationError = validate(file);
    setError(validationError ? { message: validationError, kind: 'validation' } : null);
    setSelected(validationError ? null : file);
    setProgress(0);
    setPhase(validationError ? 'failed' : 'selected');
  }

  function openChooser() {
    if (active || !inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  }

  async function startUpload() {
    if (!selected || activeUploadRef.current) return;
    activeUploadRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('preparing');
    setError(null);
    setProgress(0);
    try {
      const file = await uploadFile(selected, {
        signal: controller.signal,
        onPhase: setPhase,
        onProgress: (loaded) => {
          const percentage = Math.round((loaded / selected.size) * 100);
          setProgress(Math.min(100, Math.max(0, percentage)));
        },
      });
      setSelected(null);
      setProgress(100);
      setPhase('complete');
      if (inputRef.current) inputRef.current.value = '';
      onUploaded(file);
    } catch (uploadError) {
      if (uploadError.name === 'AbortError') {
        setPhase('cancelled');
        setError(null);
      } else {
        setPhase('failed');
        setError(uploadFailure(uploadError));
      }
    } finally {
      abortRef.current = null;
      activeUploadRef.current = false;
    }
  }

  const lifecycle = phaseMessage(phase, progress);
  const selectedPolicy = policyForFile(selected);

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
        onDragEnter={(event) => {
          event.preventDefault();
          if (!active) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (active) return;
          choose(event.dataTransfer.files[0]);
        }}
      >
        <span className="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
        </span>
        <div>
          <strong>{selected ? selected.name : 'Drop a file here'}</strong>
          <p>
            {selected
              ? `${selectedPolicy.label} · ${formatBytes(selected.size)}`
              : SUPPORTED_FORMAT_GUIDANCE}
          </p>
        </div>
        <button
          className="button button-secondary file-button"
          type="button"
          disabled={active}
          onClick={openChooser}
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept={FILE_INPUT_ACCEPT}
          disabled={active}
          tabIndex={-1}
          aria-label="Choose one file to upload"
          onChange={(event) => {
            const file = event.target.files[0];
            choose(file);
            event.target.value = '';
          }}
        />
      </div>

      {lifecycle && (
        <div className={`upload-lifecycle phase-${phase}`} role="status" aria-live="polite">
          <strong>{lifecycle.title}</strong>
          <p>{lifecycle.detail}</p>
        </div>
      )}
      {(phase === 'uploading' || phase === 'verifying') && (
        <div className="progress-row" aria-live="polite">
          <div className="progress-meta">
            <span>{phase === 'uploading' ? 'Uploading securely…' : 'Transfer complete; verification continues…'}</span>
            <strong>{progress}%</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="File upload progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          <span>{error.message}</span>
          {error.reference && <small>Reference: {error.reference}</small>}
        </div>
      )}
      <div className="upload-actions">
        {!selected && !active && phase !== 'complete' && (
          <p className="upload-hint">Choose a supported file before uploading.</p>
        )}
        {active ? (
          <button className="button button-ghost danger-text" type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button>
        ) : (
          <button className="button button-primary" type="button" disabled={!selected} onClick={startUpload}>Upload securely</button>
        )}
      </div>
    </section>
  );
}
