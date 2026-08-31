/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_ERROR_KINDS, UploadError, uploadFile } from '../api/uploads.js';
import { UploadPanel } from './UploadPanel.jsx';

vi.mock('../api/uploads.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, uploadFile: vi.fn() };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let onUploaded;

function button(label, scope = container) {
  return [...scope.querySelectorAll('button')].find((element) => element.textContent === label);
}

function file(name = 'report.pdf', type = 'application/pdf', contents = 'file contents', lastModified = 1) {
  return new File([contents], name, { type, lastModified });
}

function select(...files) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  return input;
}

function drop(...files) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  act(() => container.querySelector('.drop-zone').dispatchEvent(event));
}

function queueItems() {
  return [...container.querySelectorAll('.upload-queue-item')];
}

function queueItem(name) {
  return queueItems().find((item) => item.querySelector('.queue-file-details strong')?.textContent === name);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferredUploads() {
  const operations = [];
  uploadFile.mockImplementation((selectedFile, options) => new Promise((resolve, reject) => {
    const operation = { file: selectedFile, options, resolve, reject };
    operations.push(operation);
    options.signal.addEventListener(
      'abort',
      () => reject(new DOMException('Cancelled', 'AbortError')),
      { once: true },
    );
  }));
  return operations;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onUploaded = vi.fn();
  act(() => root.render(<UploadPanel onUploaded={onUploaded} />));
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('UploadPanel queue intake', () => {
  it('uses one native multi-file chooser activation', () => {
    const input = container.querySelector('input[type="file"]');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    act(() => button('Browse files').click());

    expect(click).toHaveBeenCalledTimes(1);
    expect(input.multiple).toBe(true);
  });

  it('adds one selected file as waiting without uploading it', () => {
    select(file());

    expect(queueItems()).toHaveLength(1);
    expect(queueItem('report.pdf').textContent).toContain('Waiting');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('adds multiple selected files as separate queue entries', () => {
    select(file('one.pdf'), file('two.txt', 'text/plain'));

    expect(queueItems()).toHaveLength(2);
    expect(queueItem('one.pdf')).toBeTruthy();
    expect(queueItem('two.txt')).toBeTruthy();
  });

  it('adds every file from a multi-file drop', () => {
    drop(file('photo.png', 'image/png'), file('clip.mp4', 'video/mp4'));

    expect(queueItems()).toHaveLength(2);
    expect(queueItem('photo.png')).toBeTruthy();
    expect(queueItem('clip.mp4')).toBeTruthy();
  });

  it('keeps valid and invalid files independently visible', () => {
    select(file('safe.pdf'), file('unsafe.exe', 'application/octet-stream'));

    expect(queueItem('safe.pdf').textContent).toContain('Waiting');
    expect(queueItem('unsafe.exe').textContent).toContain('File not supported');
    expect(queueItem('unsafe.exe').querySelector('[role="alert"]').textContent)
      .toContain('extension and type must match');
  });

  it('deduplicates identical metadata within one selection', () => {
    const duplicate = file('same.pdf', 'application/pdf', 'same', 42);
    select(duplicate, duplicate);

    expect(queueItems()).toHaveLength(1);
  });

  it('deduplicates identical metadata across selection and drop', () => {
    select(file('same.pdf', 'application/pdf', 'same', 42));
    drop(file('same.pdf', 'application/pdf', 'same', 42));

    expect(queueItems()).toHaveLength(1);
  });

  it('does not collapse same-name files with different metadata', () => {
    select(
      file('same.pdf', 'application/pdf', 'one', 42),
      file('same.pdf', 'application/pdf', 'longer contents', 43),
    );

    expect(queueItems()).toHaveLength(2);
  });

  it.each([
    ['document.pdf', 'application/pdf'],
    ['picture.png', 'image/png'],
    ['picture.jpg', 'image/jpeg'],
    ['picture.jpeg', 'image/jpeg'],
    ['animation.gif', 'image/gif'],
    ['picture.webp', 'image/webp'],
    ['clip.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['clip.mov', 'video/quicktime'],
    ['notes.txt', 'text/plain'],
    ['bundle.zip', 'application/zip'],
  ])('keeps supported file %s waiting', (name, type) => {
    select(file(name, type));
    expect(queueItem(name).textContent).toContain('Waiting');
  });

  it.each([
    ['animation.png', 'image/gif'],
    ['picture.webp', 'image/jpeg'],
    ['clip.exe', 'video/mp4'],
    ['clip.mp4', 'application/octet-stream'],
    ['clip.avi', 'video/x-msvideo'],
    ['page.html', 'text/html'],
  ])('rejects unsupported or mismatched file %s independently', (name, type) => {
    select(file(name, type));
    expect(queueItem(name).textContent).toContain('File not supported');
    expect(button('Retry', queueItem(name))).toBeUndefined();
  });

  it('preserves format guidance, accept filters, and video presentation', () => {
    select(file('camera-video.mp4', 'video/mp4', '1234567890'));

    expect(container.textContent)
      .toContain('JPG, PNG, GIF, WebP, MP4, WebM, MOV, PDF, TXT or ZIP · up to 250 MiB');
    expect(container.querySelector('input').accept).toContain('.webm');
    expect(queueItem('camera-video.mp4').textContent).toContain('MP4 video · <0.01 MB');
    expect(queueItem('camera-video.mp4').querySelector('.file-video')).toBeTruthy();
  });

  it('formats selected-file sizes in MB without exposing byte or KB units', () => {
    select(file('screenshot.png', 'image/png', new Uint8Array(54 * 1024)));

    expect(queueItem('screenshot.png').textContent).toContain('PNG image · 0.05 MB');
  });

  it('lets a validation failure be removed without affecting a valid neighbor', () => {
    select(file('safe.pdf'), file('unsafe.exe', 'application/octet-stream'));
    act(() => button('Remove', queueItem('unsafe.exe')).click());

    expect(queueItems()).toHaveLength(1);
    expect(queueItem('safe.pdf')).toBeTruthy();
  });
});

describe('UploadPanel queue scheduling and lifecycle', () => {
  it('starts all waiting entries only after Upload all is activated', () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'));
    expect(operations).toHaveLength(0);

    act(() => button('Upload all').click());

    expect(operations).toHaveLength(2);
    expect(queueItem('one.pdf').textContent).toContain('Preparing upload');
    expect(queueItem('two.pdf').textContent).toContain('Preparing upload');
  });

  it('never runs more than two files and starts the next after one settles', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'), file('three.pdf'));
    act(() => button('Upload all').click());

    expect(operations.map((operation) => operation.file.name)).toEqual(['one.pdf', 'two.pdf']);
    await act(async () => operations[0].resolve({ id: 'one' }));

    expect(operations.map((operation) => operation.file.name)).toEqual(['one.pdf', 'two.pdf', 'three.pdf']);
    expect(queueItem('three.pdf').textContent).toContain('Preparing upload');
  });

  it('updates percentage for only the reporting file', () => {
    const operations = deferredUploads();
    select(file('one.pdf', 'application/pdf', '1234567890'), file('two.pdf', 'application/pdf', '1234567890'));
    act(() => button('Upload all').click());
    act(() => {
      operations[0].options.onPhase('uploading');
      operations[0].options.onProgress(5);
    });

    expect(queueItem('one.pdf').textContent).toContain('Uploading — 50%');
    expect(queueItem('one.pdf').querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('50');
    expect(queueItem('two.pdf').querySelector('[role="progressbar"]')).toBeNull();
  });

  it('clamps an over-reported per-file percentage to 100', () => {
    const operations = deferredUploads();
    select(file('one.pdf', 'application/pdf', '12345'));
    act(() => button('Upload all').click());
    act(() => {
      operations[0].options.onPhase('uploading');
      operations[0].options.onProgress(50);
    });

    expect(queueItem('one.pdf').querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('100');
  });

  it('shows verification independently from a neighboring upload', () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'));
    act(() => button('Upload all').click());
    act(() => operations[1].options.onPhase('verifying'));

    expect(queueItem('two.pdf').textContent).toContain('Verifying upload');
    expect(queueItem('two.pdf').textContent).toContain('final checks continue');
    expect(queueItem('one.pdf').textContent).toContain('Preparing upload');
  });

  it('continues after an independent failure and preserves successful results', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'), file('three.pdf'));
    act(() => button('Upload all').click());
    await act(async () => operations[0].reject(new UploadError(UPLOAD_ERROR_KINDS.STORAGE_NETWORK)));
    await act(async () => operations[1].resolve({ id: 'two' }));
    await act(async () => operations[2].resolve({ id: 'three' }));

    expect(queueItem('one.pdf').textContent).toContain('Upload failed');
    expect(queueItem('two.pdf').textContent).toContain('Complete');
    expect(queueItem('three.pdf').textContent).toContain('Complete');
    expect(onUploaded.mock.calls.map(([uploaded]) => uploaded.id)).toEqual(['two', 'three']);
  });

  it('does not create duplicate work from repeated Upload all activation', () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'), file('three.pdf'));
    const uploadAll = button('Upload all');
    act(() => {
      uploadAll.click();
      uploadAll.click();
    });

    expect(operations).toHaveLength(2);
  });

  it('removes a waiting entry without disturbing its neighbor', () => {
    select(file('one.pdf'), file('two.pdf'));
    act(() => button('Remove', queueItem('one.pdf')).click());

    expect(queueItem('one.pdf')).toBeUndefined();
    expect(queueItem('two.pdf').textContent).toContain('Waiting');
  });

  it('does not offer removal while an entry is active', () => {
    deferredUploads();
    select(file('one.pdf'));
    act(() => button('Upload all').click());

    expect(button('Remove', queueItem('one.pdf'))).toBeUndefined();
    expect(button('Cancel', queueItem('one.pdf'))).toBeTruthy();
  });

  it('reports each successful backend file immediately and exactly once', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'));
    act(() => button('Upload all').click());
    await act(async () => operations[1].resolve({ id: 'two' }));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenLastCalledWith({ id: 'two' });

    await act(async () => operations[0].resolve({ id: 'one' }));
    expect(onUploaded.mock.calls.map(([uploaded]) => uploaded.id)).toEqual(['two', 'one']);
  });
});

describe('UploadPanel independent recovery and cleanup', () => {
  it('retries a failed entry with a fresh operation and AbortController', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'));
    act(() => button('Upload all').click());
    const firstSignal = operations[0].options.signal;
    await act(async () => operations[0].reject(new UploadError(UPLOAD_ERROR_KINDS.FINALIZATION)));

    act(() => button('Retry', queueItem('one.pdf')).click());

    expect(operations).toHaveLength(2);
    expect(operations[1].options.signal).not.toBe(firstSignal);
    expect(queueItem('one.pdf').textContent).toContain('Preparing upload');
  });

  it('cancels one active entry without aborting another', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'));
    act(() => button('Upload all').click());
    act(() => button('Cancel', queueItem('one.pdf')).click());
    await flush();

    expect(operations[0].options.signal.aborted).toBe(true);
    expect(operations[1].options.signal.aborted).toBe(false);
    expect(queueItem('one.pdf').textContent).toContain('Cancelled');
    expect(queueItem('two.pdf').textContent).toContain('Preparing upload');
  });

  it('retries a cancelled entry from zero with a fresh operation', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'));
    act(() => button('Upload all').click());
    act(() => button('Cancel', queueItem('one.pdf')).click());
    await flush();
    act(() => button('Retry', queueItem('one.pdf')).click());

    expect(operations).toHaveLength(2);
    expect(operations[1].options.signal).not.toBe(operations[0].options.signal);
    expect(queueItem('one.pdf').textContent).toContain('Preparing upload');
  });

  it.each([
    [UPLOAD_ERROR_KINDS.API_INITIATION, 'Vaulta could not prepare this upload.', 'request-init'],
    [UPLOAD_ERROR_KINDS.STORAGE_NETWORK, 'The upload could not reach file storage.', undefined],
    [UPLOAD_ERROR_KINDS.MISSING_ETAG, 'File storage returned an incomplete response.', undefined],
    [UPLOAD_ERROR_KINDS.FINALIZATION, 'Vaulta could not verify and finalize this upload.', 'request-final'],
  ])('shows a safe per-item diagnostic for %s', async (kind, expected, requestId) => {
    uploadFile.mockRejectedValue(new UploadError(kind, { requestId }));
    select(file('one.pdf'));
    act(() => button('Upload all').click());
    await flush();

    const alert = queueItem('one.pdf').querySelector('[role="alert"]');
    expect(alert.textContent).toContain(expected);
    if (requestId) expect(alert.textContent).toContain(`Reference: ${requestId}`);
    expect(button('Retry', queueItem('one.pdf'))).toBeTruthy();
  });

  it('aborts every active request on unmount and suppresses late callbacks', async () => {
    const operations = deferredUploads();
    select(file('one.pdf'), file('two.pdf'));
    act(() => button('Upload all').click());

    act(() => root.unmount());
    root = null;
    await flush();

    expect(operations.every((operation) => operation.options.signal.aborted)).toBe(true);
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
