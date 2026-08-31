/** @vitest-environment jsdom */

import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.js';
import { getStorageStats } from '../api/storage.js';
import { AuthContext } from '../context/auth-context.js';
import { DashboardPage } from './DashboardPage.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock('../api/storage.js', () => ({ getStorageStats: vi.fn() }));

vi.mock('../components/UploadPanel.jsx', () => ({
  UploadPanel: ({ onUploaded }) => (
    <section data-testid="upload-panel">
      <button type="button" onClick={() => onUploaded({
        id: 'uploaded-file', originalName: 'uploaded.pdf', sizeBytes: 20, visibility: 'PRIVATE',
      })}
      >Complete test upload</button>
    </section>
  ),
}));

vi.mock('../components/FileList.jsx', () => ({
  FileList: ({
    files, loading, error, totalFiles, nextCursor, loadingMore, onChange, onDelete, onLoadMore,
  }) => (
    <section data-testid="file-list" data-loading={loading} data-error={error} data-total={totalFiles ?? ''}>
      <span>{files.map((file) => file.originalName).join(', ')}</span>
      <span>{loadingMore ? 'Loading more files' : ''}</span>
      {files[0] && <button type="button" onClick={() => onChange({ ...files[0], visibility: 'PUBLIC' })}>Change test visibility</button>}
      {files[0] && <button type="button" onClick={() => onDelete(files[0].id)}>Delete test file</button>}
      {nextCursor && <button type="button" onClick={onLoadMore}>Load more test files</button>}
    </section>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const defaultStats = {
  totalFiles: 27,
  publicFiles: 8,
  privateFiles: 19,
  usedBytes: 256_901_120,
  quotaBytes: 1_073_741_824,
  remainingBytes: 816_840_704,
  percentageUsed: 23.93,
};

const firstFile = {
  id: 'file-1',
  originalName: 'first.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100,
  status: 'READY',
  visibility: 'PRIVATE',
  createdAt: '2026-01-01T00:00:00Z',
};

let container;
let root;
let logout;

function renderDashboard({ strict = false } = {}) {
  const page = (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { email: 'owner@example.com' }, logout }}>
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );
  act(() => root.render(strict ? <StrictMode>{page}</StrictMode> : page));
}

function button(label) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent === label);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  logout = vi.fn();
  apiFetch.mockImplementation(async (path) => {
    if (path === '/api/files?limit=50') return { items: [firstFile], nextCursor: null };
    throw new Error(`Unexpected API path: ${path}`);
  });
  getStorageStats.mockResolvedValue(defaultStats);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('DashboardPage storage overview', () => {
  it('loads files and authenticated storage statistics independently', async () => {
    renderDashboard();
    await flush();

    expect(apiFetch).toHaveBeenCalledWith('/api/files?limit=50', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getStorageStats).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('first.pdf');
  });

  it('avoids duplicate initial GETs during React development Strict Mode', async () => {
    renderDashboard({ strict: true });
    await flush();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(getStorageStats).toHaveBeenCalledTimes(1);
  });

  it('renders server counts, formatted bytes, and the server percentage', async () => {
    renderDashboard();
    await flush();

    expect(container.textContent).toContain('27');
    expect(container.textContent).toContain('8');
    expect(container.textContent).toContain('19');
    expect(container.textContent).toContain('245 MB');
    expect(container.textContent).toContain('1.0 GB');
    expect(container.textContent).toContain('779 MB remaining');
    expect(container.textContent).toContain('23.93% used');
    expect(container.querySelector('.storage-progress').getAttribute('aria-valuenow')).toBe('23.93');
  });

  it('renders genuine zero values for an empty account', async () => {
    getStorageStats.mockResolvedValue({
      totalFiles: 0,
      publicFiles: 0,
      privateFiles: 0,
      usedBytes: 0,
      quotaBytes: 1_073_741_824,
      remainingBytes: 1_073_741_824,
      percentageUsed: 0,
    });
    apiFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderDashboard();
    await flush();

    expect(container.querySelector('.storage-progress').getAttribute('aria-valuenow')).toBe('0');
    expect(container.textContent).toContain('0 B');
    expect(container.textContent).toContain('1.0 GB remaining');
  });

  it('shows a stable announced loading structure without fake values', () => {
    getStorageStats.mockImplementation(() => new Promise(() => {}));
    renderDashboard();

    expect(container.querySelector('.storage-card-loading')).toBeTruthy();
    expect(container.textContent).toContain('Loading storage overview');
    expect(container.querySelector('.storage-progress')).toBeNull();
  });

  it('localizes a stats failure while keeping loaded files usable', async () => {
    getStorageStats.mockRejectedValue(new Error('Statistics are temporarily unavailable.'));
    renderDashboard();
    await flush();

    expect(container.textContent).toContain('Storage insights are unavailable');
    expect(container.textContent).toContain('Statistics are temporarily unavailable.');
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('first.pdf');
    expect(container.querySelector('.stat-card')).toBeNull();
  });

  it('keeps real storage insights visible when the file page fails', async () => {
    apiFetch.mockRejectedValue(new Error('Files are temporarily unavailable.'));
    renderDashboard();
    await flush();

    expect(container.textContent).toContain('23.93% used');
    expect(container.querySelector('[data-testid="file-list"]').dataset.error)
      .toBe('Files are temporarily unavailable.');
  });

  it('retries a failed statistics request and replaces the error with real values', async () => {
    getStorageStats.mockRejectedValueOnce(new Error('Try again.')).mockResolvedValueOnce(defaultStats);
    renderDashboard();
    await flush();
    await act(async () => button('Retry').click());

    expect(getStorageStats).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('23.93% used');
    expect(container.textContent).not.toContain('Storage insights are unavailable');
  });

  it('uses the authoritative total rather than the visible page length', async () => {
    renderDashboard();
    await flush();

    expect(container.querySelector('[data-testid="file-list"]').dataset.total).toBe('27');
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('first.pdf');
  });

  it('exposes responsive dashboard structure without fake navigation', async () => {
    renderDashboard();
    await flush();

    expect(container.querySelector('.dashboard-insights')).toBeTruthy();
    expect(container.querySelector('.stats-grid')).toBeTruthy();
    expect(container.querySelector('.dashboard-content-grid')).toBeTruthy();
    expect([...container.querySelectorAll('.dashboard-nav a')].map((link) => link.textContent))
      .toEqual(['Overview', 'My files']);
  });
});

describe('DashboardPage authoritative refresh and pagination', () => {
  it('refreshes stats once when an upload completes and inserts that file', async () => {
    renderDashboard();
    await flush();
    act(() => button('Complete test upload').click());
    await flush();

    expect(getStorageStats).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('uploaded.pdf');
  });

  it('refreshes stats after a successful file deletion callback', async () => {
    renderDashboard();
    await flush();
    act(() => button('Delete test file').click());
    await flush();

    expect(getStorageStats).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="file-list"]').textContent).not.toContain('first.pdf');
  });

  it('refreshes stats after a successful visibility-change callback', async () => {
    renderDashboard();
    await flush();
    act(() => button('Change test visibility').click());
    await flush();

    expect(getStorageStats).toHaveBeenCalledTimes(2);
  });

  it('loads the next cursor page and merges it without losing the first page', async () => {
    apiFetch.mockImplementation(async (path) => {
      if (path === '/api/files?limit=50') return { items: [firstFile], nextCursor: 'cursor-50' };
      if (path === '/api/files?limit=50&cursor=cursor-50') {
        return { items: [{ ...firstFile, id: 'file-51', originalName: 'later.pdf' }], nextCursor: null };
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderDashboard();
    await flush();
    const loadMore = button('Load more test files');
    await act(async () => {
      loadMore.click();
      loadMore.click();
    });

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/files?limit=50&cursor=cursor-50',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(apiFetch.mock.calls.filter(([path]) => path.includes('cursor=cursor-50'))).toHaveLength(1);
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('first.pdf, later.pdf');
  });
});
