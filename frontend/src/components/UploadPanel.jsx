import { useEffect, useRef, useState } from 'react';
import { UPLOAD_ERROR_KINDS, uploadFile } from '../api/uploads.js';
import {
  FILE_INPUT_ACCEPT,
  filePresentation,
  MAX_FILE_SIZE_BYTES,
  policyForFile,
  SUPPORTED_FORMAT_GUIDANCE,
} from '../utils/file-policy.js';
import { formatBytes } from '../utils/format.js';
import { FileTypeIcon, Icon } from './Icons.jsx';

const FILE_UPLOAD_CONCURRENCY = 2;
const ACTIVE_PHASES = new Set(['preparing', 'uploading', 'verifying']);
const REMOVABLE_STATUSES = new Set(['waiting', 'failed', 'cancelled', 'complete']);
let fallbackQueueId = 0;

function createQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackQueueId += 1;
  return `upload-${Date.now()}-${fallbackQueueId}`;
}

// Queue-local duplicate protection only: metadata identity is not a content hash.
function fileIdentity(file) {
  return `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

function validate(file) {
  if (!policyForFile(file)) return 'The file extension and type must match a supported format.';
  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) return 'The file must be 250 MiB or smaller.';
  return null;
}

function uploadFailure(error) {
  const requestId = error?.requestId;
  switch (error?.kind) {
    case UPLOAD_ERROR_KINDS.API_INITIATION:
      return { message: 'Vaulta could not prepare this upload. Please try again.', requestId };
    case UPLOAD_ERROR_KINDS.PART_AUTHORIZATION:
      return { message: 'Vaulta could not authorize the file transfer. Please try again.', requestId };
    case UPLOAD_ERROR_KINDS.STORAGE_NETWORK:
      return { message: 'The upload could not reach file storage. Check your connection and try again.' };
    case UPLOAD_ERROR_KINDS.STORAGE_REJECTED:
      return { message: 'File storage rejected part of the upload. Please try again.' };
    case UPLOAD_ERROR_KINDS.MISSING_ETAG:
      return { message: 'File storage returned an incomplete response. Please try again.' };
    case UPLOAD_ERROR_KINDS.FINALIZATION:
      if (error.code === 'FILE_CONTENT_MISMATCH') {
        return { message: 'Vaulta could not verify this file because its contents do not match its file type.', requestId };
      }
      if (error.code === 'FILE_SIZE_MISMATCH') {
        return { message: 'Vaulta could not verify this file because its uploaded size changed.', requestId };
      }
      return { message: 'Vaulta could not verify and finalize this upload. Please try again.', requestId };
    default:
      return { message: 'The upload could not be completed. Please try again.', requestId };
  }
}

function statusCopy(item) {
  switch (item.status) {
    case 'waiting':
      return 'Waiting';
    case 'preparing':
      return 'Preparing upload';
    case 'uploading':
      return `Uploading — ${item.progress}%`;
    case 'verifying':
      return 'Verifying upload';
    case 'complete':
      return 'Complete';
    case 'failed':
      return item.validationFailure ? 'File not supported' : 'Upload failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return item.status;
  }
}

function QueueItem({ item, onCancel, onRemove, onRetry }) {
  const active = ACTIVE_PHASES.has(item.status);
  const policy = policyForFile(item.file);
  const presentation = item.validationFailure
    ? { badge: 'FILE', style: 'generic' }
    : filePresentation(item.file.type);

  return (
    <article className={`upload-queue-item queue-${item.status}`} data-upload-id={item.id}>
      <span className={`file-icon file-${presentation.style}`} aria-hidden="true">
        <FileTypeIcon style={presentation.style} />
        <small>{presentation.badge}</small>
      </span>
      <div className="queue-file-details">
        <strong title={item.file.name}>{item.file.name}</strong>
        <span>{policy?.label || item.file.type || 'Unsupported file type'} · {formatBytes(item.file.size)}</span>
      </div>
      <div className="queue-status" role="status" aria-live="polite">
        <strong>{statusCopy(item)}</strong>
        {item.status === 'verifying' && <span>Transfer complete; final checks continue.</span>}
      </div>

      {(item.status === 'uploading' || item.status === 'verifying') && (
        <div
          className="queue-progress"
          role="progressbar"
          aria-label={`Upload progress for ${item.file.name}`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={item.progress}
        >
          <span style={{ width: `${item.progress}%` }} />
        </div>
      )}

      {item.error && (
        <div className="queue-error" role="alert">
          <span>{item.error.message}</span>
          {item.error.requestId && <small>Reference: {item.error.requestId}</small>}
        </div>
      )}

      <div className="queue-item-actions">
        {active && (
          <button type="button" className="action-button danger-text" onClick={() => onCancel(item.id)}>
            Cancel
          </button>
        )}
        {!item.validationFailure && (item.status === 'failed' || item.status === 'cancelled') && (
          <button type="button" className="action-button" onClick={() => onRetry(item.id)}>
            Retry
          </button>
        )}
        {REMOVABLE_STATUSES.has(item.status) && (
          <button type="button" className="action-button" onClick={() => onRemove(item.id)}>
            Remove
          </button>
        )}
      </div>
    </article>
  );
}

export function UploadPanel({ onUploaded }) {
  const inputRef = useRef(null);
  const itemsRef = useRef([]);
  const pendingRef = useRef([]);
  const runningRef = useRef(new Set());
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);
  const onUploadedRef = useRef(onUploaded);
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(() => {
    const controllers = controllersRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = [];
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  function replaceItems(updater) {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
  }

  function patchItem(id, patch) {
    replaceItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    replaceItems((current) => {
      const identities = new Set(current.map((item) => fileIdentity(item.file)));
      const additions = [];
      for (const file of incoming) {
        const identity = fileIdentity(file);
        if (identities.has(identity)) continue;
        identities.add(identity);
        const validationError = validate(file);
        additions.push({
          id: createQueueId(),
          file,
          status: validationError ? 'failed' : 'waiting',
          progress: 0,
          error: validationError ? { message: validationError } : null,
          requestId: null,
          backendFileId: null,
          validationFailure: Boolean(validationError),
        });
      }
      return additions.length ? [...current, ...additions] : current;
    });
  }

  function scheduleQueue() {
    if (!mountedRef.current) return;
    while (runningRef.current.size < FILE_UPLOAD_CONCURRENCY && pendingRef.current.length > 0) {
      const id = pendingRef.current.shift();
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item || item.status !== 'waiting' || runningRef.current.has(id)) continue;
      runningRef.current.add(id);
      void runItem(item);
    }
    if (runningRef.current.size === 0 && pendingRef.current.length === 0) {
      setQueueRunning(false);
    }
  }

  function enqueue(ids) {
    const pending = new Set(pendingRef.current);
    let added = false;
    for (const id of ids) {
      if (pending.has(id) || runningRef.current.has(id)) continue;
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item || item.status !== 'waiting') continue;
      pendingRef.current.push(id);
      pending.add(id);
      added = true;
    }
    if (!added) return;
    setQueueRunning(true);
    scheduleQueue();
  }

  async function runItem(item) {
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);
    patchItem(item.id, { status: 'preparing', progress: 0, error: null, requestId: null });
    try {
      const completed = await uploadFile(item.file, {
        signal: controller.signal,
        onPhase: (status) => {
          if (mountedRef.current && ACTIVE_PHASES.has(status)) patchItem(item.id, { status });
        },
        onProgress: (loaded) => {
          if (!mountedRef.current) return;
          const percentage = Math.round((loaded / item.file.size) * 100);
          patchItem(item.id, { progress: Math.min(100, Math.max(0, percentage)) });
        },
      });
      if (!mountedRef.current) return;
      patchItem(item.id, {
        status: 'complete',
        progress: 100,
        backendFileId: completed.id,
        error: null,
        requestId: null,
      });
      onUploadedRef.current?.(completed);
    } catch (error) {
      if (!mountedRef.current) return;
      if (error.name === 'AbortError') {
        patchItem(item.id, { status: 'cancelled', error: null, requestId: null });
      } else {
        const failure = uploadFailure(error);
        patchItem(item.id, {
          status: 'failed',
          error: failure,
          requestId: failure.requestId || null,
        });
      }
    } finally {
      controllersRef.current.delete(item.id);
      runningRef.current.delete(item.id);
      if (mountedRef.current) scheduleQueue();
    }
  }

  function uploadAll() {
    enqueue(itemsRef.current.filter((item) => item.status === 'waiting').map((item) => item.id));
  }

  function retry(id) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item || item.validationFailure || !['failed', 'cancelled'].includes(item.status)) return;
    patchItem(id, { status: 'waiting', progress: 0, error: null, requestId: null });
    enqueue([id]);
  }

  function cancel(id) {
    controllersRef.current.get(id)?.abort();
  }

  function remove(id) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item || !REMOVABLE_STATUSES.has(item.status)) return;
    pendingRef.current = pendingRef.current.filter((pendingId) => pendingId !== id);
    replaceItems((current) => current.filter((candidate) => candidate.id !== id));
    scheduleQueue();
  }

  const waitingCount = items.filter((item) => item.status === 'waiting').length;
  const completeCount = items.filter((item) => item.status === 'complete').length;
  const activeCount = items.filter((item) => ACTIVE_PHASES.has(item.status)).length;

  return (
    <section className="upload-card" aria-labelledby="upload-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">New uploads</p>
          <h2 id="upload-heading">Add files to your vault</h2>
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
          addFiles(event.dataTransfer.files);
        }}
      >
        <span className="upload-icon" aria-hidden="true">
          <Icon name="upload" />
        </span>
        <div>
          <strong>Drop one or more files here</strong>
          <p>{SUPPORTED_FORMAT_GUIDANCE}</p>
        </div>
        <button
          className="button button-secondary file-button"
          type="button"
          onClick={() => {
            if (!inputRef.current) return;
            inputRef.current.value = '';
            inputRef.current.click();
          }}
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept={FILE_INPUT_ACCEPT}
          multiple
          tabIndex={-1}
          aria-label="Choose one or more files to upload"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="upload-queue" aria-label="Files selected for upload">
          <div className="queue-summary" role="status" aria-live="polite">
            <span>{items.length} {items.length === 1 ? 'file' : 'files'} in queue</span>
            <span>{completeCount} complete{activeCount ? ` · ${activeCount} active` : ''}</span>
          </div>
          {items.map((item) => (
            <QueueItem
              key={item.id}
              item={item}
              onCancel={cancel}
              onRemove={remove}
              onRetry={retry}
            />
          ))}
        </div>
      )}

      <div className="upload-actions">
        {items.length === 0 && <p className="upload-hint">Choose one or more supported files to begin.</p>}
        {items.length > 0 && waitingCount === 0 && !queueRunning && (
          <p className="upload-hint">Add more files, retry an item, or remove completed entries.</p>
        )}
        <button
          className="button button-primary"
          type="button"
          disabled={waitingCount === 0 || queueRunning}
          onClick={uploadAll}
        >
          {queueRunning ? 'Upload queue running…' : 'Upload all'}
        </button>
      </div>
    </section>
  );
}
