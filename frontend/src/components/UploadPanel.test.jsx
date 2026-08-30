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

function button(label) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent === label);
}

function choose(file) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  return input;
}

function validFile(name = 'report.pdf', type = 'application/pdf', contents = 'file contents') {
  return new File([contents], name, { type });
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<UploadPanel onUploaded={vi.fn()} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('UploadPanel file selection', () => {
  it('activates the native input exactly once from the chooser button', () => {
    const input = container.querySelector('input[type="file"]');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    act(() => button('Browse files').click());

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('disables upload and explains why when no valid file is selected', () => {
    expect(button('Upload securely').disabled).toBe(true);
    expect(container.textContent).toContain('Choose a supported file before uploading.');
  });

  it('shows a valid selected file and makes it ready to upload', () => {
    choose(validFile());

    expect(container.textContent).toContain('report.pdf');
    expect(container.textContent).toContain('PDF document');
    expect(container.textContent).toContain('Ready to upload');
    expect(button('Upload securely').disabled).toBe(false);
  });

  it('shows validation feedback and resets after repeated selection of the same invalid file', () => {
    const invalid = validFile('clip.mp4', 'video/mp4');
    const input = choose(invalid);

    expect(container.querySelector('[role="alert"]').textContent).toContain('Use a PDF, PNG, JPEG, TXT, or ZIP file.');
    expect(input.value).toBe('');

    choose(invalid);
    expect(container.querySelector('[role="alert"]').textContent).toContain('Use a PDF, PNG, JPEG, TXT, or ZIP file.');
    expect(button('Upload securely').disabled).toBe(true);
  });

  it.each([
    ['document.pdf', 'application/pdf'],
    ['picture.png', 'image/png'],
    ['picture.jpg', 'image/jpeg'],
    ['picture.jpeg', 'image/jpeg'],
    ['notes.txt', 'text/plain'],
    ['bundle.zip', 'application/zip'],
  ])('keeps %s accepted', (name, type) => {
    choose(validFile(name, type));
    expect(button('Upload securely').disabled).toBe(false);
  });

  it.each([
    ['animation.gif', 'image/gif'],
    ['picture.webp', 'image/webp'],
    ['clip.mp4', 'video/mp4'],
    ['page.html', 'text/html'],
  ])('keeps %s rejected', (name, type) => {
    choose(validFile(name, type));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Upload securely').disabled).toBe(true);
  });
});

describe('UploadPanel lifecycle and errors', () => {
  it('shows preparing, real progress, verification, and completion in order', async () => {
    let controls;
    let finish;
    const uploaded = { id: 'file-1', originalName: 'report.pdf' };
    uploadFile.mockImplementation((_file, options) => {
      controls = options;
      return new Promise((resolve) => { finish = resolve; });
    });
    choose(validFile('report.pdf', 'application/pdf', '1234567890'));

    act(() => button('Upload securely').click());
    expect(container.textContent).toContain('Preparing upload');

    act(() => {
      controls.onPhase('uploading');
      controls.onProgress(5);
    });
    expect(container.textContent).toContain('Uploading securely — 50%');
    expect(container.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('50');

    act(() => {
      controls.onPhase('verifying');
      controls.onProgress(10);
    });
    expect(container.textContent).toContain('Vaulta is finalizing and verifying the file.');
    expect(container.textContent).toContain('verification continues');

    await act(async () => finish(uploaded));
    expect(container.textContent).toContain('Upload complete');
    expect(button('Upload securely').disabled).toBe(true);
  });

  it('clamps reported progress to 100 percent', () => {
    let controls;
    uploadFile.mockImplementation((_file, options) => {
      controls = options;
      return new Promise(() => {});
    });
    choose(validFile('report.pdf', 'application/pdf', '12345'));
    act(() => button('Upload securely').click());
    act(() => {
      controls.onPhase('uploading');
      controls.onProgress(50);
    });
    expect(container.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('100');
  });

  it('does not start duplicate uploads from repeated button activation', () => {
    uploadFile.mockImplementation(() => new Promise(() => {}));
    choose(validFile());

    const uploadButton = button('Upload securely');
    act(() => {
      uploadButton.click();
      uploadButton.click();
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    [UPLOAD_ERROR_KINDS.API_INITIATION, 'Vaulta could not prepare this upload.', 'request-init'],
    [UPLOAD_ERROR_KINDS.STORAGE_NETWORK, 'The upload could not reach file storage.', undefined],
    [UPLOAD_ERROR_KINDS.MISSING_ETAG, 'File storage returned an incomplete response.', undefined],
    [UPLOAD_ERROR_KINDS.FINALIZATION, 'Vaulta could not verify and finalize this upload.', 'request-final'],
  ])('shows a safe diagnostic for %s failures', async (kind, expected, requestId) => {
    uploadFile.mockRejectedValue(new UploadError(kind, { requestId }));
    choose(validFile());
    act(() => button('Upload securely').click());
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toContain(expected);
    if (requestId) expect(alert.textContent).toContain(`Reference: ${requestId}`);
    expect(button('Upload securely').disabled).toBe(false);
  });

  it('handles cancellation as a retryable state rather than a failure', async () => {
    uploadFile.mockImplementation((_file, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    choose(validFile());
    act(() => button('Upload securely').click());
    act(() => button('Cancel upload').click());
    await flush();

    expect(container.textContent).toContain('Upload cancelled');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button('Upload securely').disabled).toBe(false);
  });

  it('reports a successful file through the existing dashboard callback', async () => {
    const onUploaded = vi.fn();
    act(() => root.render(<UploadPanel onUploaded={onUploaded} />));
    const uploaded = { id: 'file-1', originalName: 'report.pdf' };
    uploadFile.mockResolvedValue(uploaded);
    choose(validFile());
    act(() => button('Upload securely').click());
    await flush();

    expect(onUploaded).toHaveBeenCalledWith(uploaded);
  });
});
