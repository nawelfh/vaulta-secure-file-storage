/** @vitest-environment jsdom */

import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFiles } from '../api/files.js';
import { getStorageStats } from '../api/storage.js';
import { AuthContext } from '../context/auth-context.js';
import { DashboardPage } from './DashboardPage.jsx';

vi.mock('../api/files.js', () => ({ getFiles: vi.fn() }));
vi.mock('../api/storage.js', () => ({ getStorageStats: vi.fn() }));
vi.mock('../components/UploadPanel.jsx', () => ({
  UploadPanel: ({ onUploaded }) => <section data-testid="upload-panel"><button className="file-button" type="button">Browse files</button><button type="button" onClick={() => onUploaded({ id: 'new-file' })}>Complete upload</button></section>,
}));
vi.mock('../components/FileList.jsx', () => ({
  FileList: (props) => (
    <section data-testid="file-list" data-loading={props.loading} data-error={props.error} data-page={props.pagination.page} data-total={props.pagination.total} data-view={props.view}>
      <h2>{props.title}</h2><span>{props.files.map((file) => file.originalName).join(',')}</span><span>{props.description}</span>
      <input aria-label="Table search" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <button type="button" onClick={props.onUpload}>Open uploader</button>
      <button type="button" onClick={() => props.onPageChange(2)}>Page 2</button>
      <button type="button" onClick={() => props.onSortChange('size-desc')}>Sort largest</button>
      <button type="button" onClick={() => props.onVisibilityChange('PRIVATE')}>Private filter</button>
      <button type="button" onClick={() => props.onChange(props.files[0])}>Change file</button>
      <button type="button" onClick={() => props.onFavorite({ ...props.files[0], favorite: true })}>Favorite file</button>
      <button type="button" onClick={() => props.onFavorite({ ...props.files[0], favorite: false })}>Unfavorite file</button>
      <button type="button" onClick={() => props.onTrash(props.files[0]?.id)}>Trash file</button>
      <button type="button" onClick={() => props.onRestore(props.files[0]?.id)}>Restore file</button>
      <button type="button" onClick={() => props.onDelete(props.files[0]?.id)}>Permanently delete file</button>
      <button type="button" onClick={() => props.onPageChange(6)}>Page 6 direct</button>
      <button type="button" onClick={() => props.onBulkComplete({ action: 'trash', successCount: 2, succeededIds: ['one', 'two'], failedIds: [] })}>Complete bulk mutation</button>
    </section>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stats = { totalFiles: 27, publicFiles: 8, privateFiles: 19, usedBytes: 256_901_120, quotaBytes: 1_073_741_824, remainingBytes: 816_840_704, percentageUsed: 23.93 };
const file = { id: 'file-1', originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 100, status: 'READY', visibility: 'PRIVATE', createdAt: '2026-01-01T00:00:00Z' };
const page = { files: [file], pagination: { page: 1, limit: 5, total: 27, totalPages: 6, hasPrevious: false, hasNext: true } };
let container;
let root;
let logout;

function renderDashboard({ user = { name: 'Ada Lovelace', email: 'ada@example.com' }, path = '/dashboard', strict = false } = {}) {
  const tree = <MemoryRouter initialEntries={[path]}><AuthContext.Provider value={{ user, logout }}><DashboardPage /></AuthContext.Provider></MemoryRouter>;
  act(() => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function click(text) {
  const target = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
  await act(async () => {
    target.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  logout = vi.fn();
  getFiles.mockImplementation(async ({ page: requestedPage }) => ({
    ...page,
    pagination: {
      ...page.pagination,
      page: requestedPage,
      hasPrevious: requestedPage > 1,
      hasNext: requestedPage < page.pagination.totalPages,
    },
  }));
  getStorageStats.mockResolvedValue(stats);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('DashboardPage identity and structure', () => {
  it('renders the usable shell while independent stats and file requests remain pending', async () => {
    getFiles.mockReturnValue(new Promise(() => {}));
    getStorageStats.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    await flush();
    expect(container.textContent).toContain('Welcome back, Ada Lovelace');
    expect(container.querySelector('[data-testid="upload-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="file-list"]').dataset.loading).toBe('true');
    expect(getFiles).toHaveBeenCalledTimes(1);
    expect(getStorageStats).toHaveBeenCalledTimes(1);
  });

  it('renders the real user name and name initial', async () => {
    renderDashboard(); await flush();
    expect(container.textContent).toContain('Welcome back, Ada Lovelace');
    expect(container.querySelector('.avatar').textContent).toBe('A');
  });

  it('uses a neutral greeting and email initial for a migrated account with no name', async () => {
    renderDashboard({ user: { name: null, email: 'owner@example.com' } }); await flush();
    expect(container.textContent).toContain('Welcome back');
    expect(container.textContent).not.toContain('Welcome back,');
    expect(container.querySelector('.avatar').textContent).toBe('O');
  });

  it('renders all six functional sidebar destinations with responsive navigation', async () => {
    renderDashboard(); await flush();
    expect([...container.querySelectorAll('.sidebar-nav a')].map((link) => link.textContent.trim())).toEqual(['Dashboard', 'My Files', 'Shared files', 'Recent', 'Favorites', 'Trash']);
    expect(container.querySelector('.sidebar-nav a[aria-current="page"]').textContent).toContain('Dashboard');
    expect(container.querySelector('.mobile-menu-button').getAttribute('aria-controls')).toBe('dashboard-navigation');
  });

  it('keeps the responsive identity header free of duplicate search and upload controls', async () => {
    renderDashboard(); await flush();
    const header = container.querySelector('.dashboard-topbar');
    expect(header.querySelector('input[type="search"]')).toBeNull();
    expect([...header.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Upload')).toBe(false);
    expect(header.querySelector('[aria-label="Open navigation"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="Account: Ada Lovelace"]')).not.toBeNull();
    expect(header.textContent).toContain('Welcome back, Ada Lovelace');
  });

  it('shows truthful public-owner content in Shared view', async () => {
    renderDashboard({ path: '/dashboard?view=shared' }); await flush();
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain('Shared Files');
    expect(container.textContent).toContain('Public files you own');
    expect(getFiles).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'PUBLIC', view: 'active' }));
  });

  it.each([
    ['/dashboard?view=files', 'files', 'My Files', 'active', 'newest'],
    ['/dashboard?view=recent', 'recent', 'Recent Files', 'recent', 'newest'],
    ['/dashboard?view=favorites', 'favorites', 'Favorites', 'favorites', 'newest'],
    ['/dashboard?view=trash', 'trash', 'Trash', 'trash', 'deleted-newest'],
  ])('supports direct refresh-safe view %s', async (path, active, title, apiView, sort) => {
    renderDashboard({ path }); await flush();
    expect(container.querySelector('.sidebar-nav a[aria-current="page"]').textContent.trim().toLowerCase()).toContain(active);
    expect(container.querySelector('[data-testid="file-list"]').textContent).toContain(title);
    expect(getFiles).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 5, view: apiView, sort }));
  });
});

describe('DashboardPage file controls', () => {
  it('loads exactly five server-paginated rows and real stats without duplicate Strict Mode requests', async () => {
    renderDashboard({ strict: true }); await flush();
    expect(getFiles).toHaveBeenCalledTimes(1);
    expect(getFiles).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 5, sort: 'newest', signal: expect.any(AbortSignal) }));
    expect(getStorageStats).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="file-list"]').dataset.total).toBe('27');
    expect(container.textContent).toContain('23.93%');
    expect(container.querySelector('.storage-usage').textContent).toBe('245 MB of 1 GB used');
    expect(container.querySelector('.storage-progress-meta').textContent).toContain('779 MB remaining');
    expect(container.querySelector('.stat-card:last-child strong').textContent).toBe('245 MB');
    expect(container.querySelector('.sidebar-storage-meta').textContent).toBe('245 MB used779 MB left');
  });

  it('debounces synchronized search by 300ms and resets to page one', async () => {
    vi.useFakeTimers();
    renderDashboard(); await flush();
    const input = container.querySelector('[aria-label="Table search"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Budget');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getFiles).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(299); await Promise.resolve(); });
    expect(getFiles).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); await Promise.resolve(); });
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Budget', page: 1 }));
    expect(container.querySelector('[aria-label="Table search"]').value).toBe('Budget');
  });

  it('localizes a search/list failure while retaining stats', async () => {
    getFiles.mockRejectedValue(new Error('Search is temporarily unavailable.'));
    renderDashboard(); await flush();
    expect(container.querySelector('[data-testid="file-list"]').dataset.error).toBe('Search is temporarily unavailable.');
    expect(container.textContent).toContain('23.93%');
  });

  it('requests direct pages, sorting, and visibility filtering on the server', async () => {
    renderDashboard(); await flush();
    await click('Page 2'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    await click('Sort largest'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sort: 'size-desc' }));
    await click('Private filter'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, visibility: 'PRIVATE' }));
  });

  it('removes an unfavorited row from Favorites without refreshing statistics', async () => {
    renderDashboard({ path: '/dashboard?view=favorites' }); await flush();
    await click('Unfavorite file'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'favorites', page: 1 }));
    expect(getStorageStats).toHaveBeenCalledTimes(1);
  });

  it('keeps Trash search and pagination server-side', async () => {
    vi.useFakeTimers();
    renderDashboard({ path: '/dashboard?view=trash' }); await flush();
    const input = container.querySelector('[aria-label="Table search"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'archive');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); await Promise.resolve(); });
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'trash', sort: 'deleted-newest', search: 'archive', page: 1 }));
    await click('Page 2'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'trash', page: 2 }));
  });

  it('focuses the real uploader and applies mutation-specific stats refresh semantics', async () => {
    renderDashboard(); await flush();
    expect(container.querySelector('[data-testid="upload-panel"]')).not.toBeNull();
    expect([...container.querySelectorAll('[data-testid="upload-panel"] button')].some((button) => button.textContent === 'Browse files')).toBe(true);
    await click('Open uploader');
    expect(document.activeElement.textContent).toBe('Browse files');
    await click('Complete upload'); await flush();
    expect(getStorageStats).toHaveBeenCalledTimes(2);
    await click('Favorite file'); await flush();
    expect(getStorageStats).toHaveBeenCalledTimes(2);
    await click('Change file'); await flush();
    await click('Trash file'); await flush();
    await click('Restore file'); await flush();
    await click('Permanently delete file'); await flush();
    expect(getStorageStats).toHaveBeenCalledTimes(6);
    expect(getFiles.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('refreshes authoritative stats and recovers to the nearest valid page after bulk mutation', async () => {
    renderDashboard(); await flush();
    await click('Page 6 direct'); await flush();
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 6 }));
    getFiles.mockResolvedValueOnce({
      ...page,
      pagination: { ...page.pagination, page: 5, total: 25, totalPages: 5, hasPrevious: true, hasNext: false },
    });
    await click('Complete bulk mutation'); await flush();
    expect(getStorageStats).toHaveBeenCalledTimes(2);
    expect(getFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 5 }));
  });
});
