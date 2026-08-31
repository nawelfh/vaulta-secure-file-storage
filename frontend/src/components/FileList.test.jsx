/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.js';
import { FileIcon, FileList } from './FileList.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, apiFetch: vi.fn() };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('FileIcon media presentation', () => {
  it.each([
    ['image/jpeg', 'JPG', 'file-img'],
    ['image/png', 'PNG', 'file-img'],
    ['image/gif', 'GIF', 'file-img'],
    ['image/webp', 'WEBP', 'file-img'],
    ['video/mp4', 'MP4', 'file-video'],
    ['video/webm', 'WEBM', 'file-video'],
    ['video/quicktime', 'MOV', 'file-video'],
    ['application/pdf', 'PDF', 'file-pdf'],
    ['text/plain', 'TXT', 'file-txt'],
    ['application/zip', 'ZIP', 'file-zip'],
    ['application/octet-stream', 'FILE', 'file-generic'],
  ])('renders %s with the correct badge', (mimeType, badge, className) => {
    act(() => root.render(<FileIcon mimeType={mimeType} />));
    const icon = container.querySelector('.file-icon');
    expect(icon.textContent).toBe(badge);
    expect(icon.classList.contains(className)).toBe(true);
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.getAttribute('aria-label')).toBe(`${badge} file type`);
    if (mimeType !== 'text/plain') expect(icon.textContent).not.toBe('TXT');
  });

  it('never presents an unknown video type as text', () => {
    act(() => root.render(<FileIcon mimeType="video/example" />));
    expect(container.querySelector('.file-icon').textContent).toBe('VID');
    expect(container.querySelector('.file-icon').classList.contains('file-video')).toBe(true);
  });
});

describe('FileList professional table and pagination', () => {
  const file = {
    id: 'file-1',
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'READY',
    visibility: 'PRIVATE',
    createdAt: '2026-01-01T00:00:00Z',
  };

  const pagination = { page: 1, limit: 5, total: 27, totalPages: 6, hasPrevious: false, hasNext: true };
  const common = { search: '', sort: 'newest', visibility: '', onSearchChange: vi.fn(), onSortChange: vi.fn(), onVisibilityChange: vi.fn() };

  function actionsButton(name = file.originalName) {
    return container.querySelector(`[aria-label="Open actions for ${name}"]`);
  }

  function menuItem(name) {
    return [...container.querySelectorAll('[role="menuitem"]')]
      .find((button) => button.textContent.trim() === name);
  }

  function openActions(name) {
    act(() => actionsButton(name).click());
    return container.querySelector('[role="menu"]');
  }

  it.each([
    ['image/jpeg', 'JPG'],
    ['image/png', 'PNG'],
    ['image/gif', 'GIF'],
    ['image/webp', 'WEBP'],
    ['video/mp4', 'MP4'],
    ['video/webm', 'WEBM'],
    ['video/quicktime', 'MOV'],
    ['application/pdf', 'PDF'],
    ['text/plain', 'TXT'],
    ['application/zip', 'ZIP'],
    ['application/octet-stream', 'FILE'],
  ])('renders a visible %s Type-column badge as %s', (mimeType, expectedType) => {
    act(() => root.render(
      <FileList
        files={[{ ...file, mimeType }]}
        pagination={{ page: 1, limit: 5, total: 1, totalPages: 1, hasPrevious: false, hasNext: false }}
        onPageChange={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        {...common}
      />,
    ));
    const typeCell = container.querySelector('.file-type-cell');
    expect(typeCell.textContent.trim()).toBe(expectedType);
    expect(typeCell.querySelector('.file-type-badge')).not.toBeNull();
  });

  it('keeps an unknown video visible and never presents it as TXT in the Type column', () => {
    act(() => root.render(
      <FileList
        files={[{ ...file, mimeType: 'video/example' }]}
        pagination={{ page: 1, limit: 5, total: 1, totalPages: 1, hasPrevious: false, hasNext: false }}
        onPageChange={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        {...common}
      />,
    ));
    const type = container.querySelector('.file-type-cell').textContent.trim();
    expect(type).toBe('VID');
    expect(type).not.toBe('TXT');
  });

  it('renders exact columns, authoritative range, current page, next, and direct page controls', () => {
    const onPageChange = vi.fn();
    act(() => root.render(
      <FileList
        files={[file]}
        pagination={pagination}
        onPageChange={onPageChange}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        {...common}
      />,
    ));

    expect([...container.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Size', 'Visibility', 'Uploaded', 'Actions']);
    expect([...container.querySelectorAll('[role="cell"]')][2].textContent).toBe('<0.01 MB');
    expect(container.textContent).toContain('27 total');
    expect(container.textContent).toContain('Showing 1 to 5 of 27');
    expect(container.querySelector('[aria-label="Page 1"]').getAttribute('aria-current')).toBe('page');
    act(() => container.querySelector('[aria-label="Next page"]').click());
    act(() => container.querySelector('[aria-label="Page 2"]').click());
    expect(onPageChange.mock.calls).toEqual([[2], [2]]);
    expect(container.querySelector('[aria-label="Previous page"]').disabled).toBe(true);
  });

  it('renders a final partial page range and enabled previous control', () => {
    act(() => root.render(
      <FileList files={[file]} pagination={{ ...pagination, page: 6, hasPrevious: true, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} {...common} />,
    ));
    expect(container.textContent).toContain('Showing 26 to 27 of 27');
    expect(container.querySelector('[aria-label="Previous page"]').disabled).toBe(false);
    expect(container.querySelector('[aria-label="Next page"]').disabled).toBe(true);
  });

  it('uses search-aware and shared truthful empty states', () => {
    act(() => root.render(
      <FileList files={[]} pagination={{ ...pagination, total: 0, totalPages: 0, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} {...common} search="budget" />,
    ));
    expect(container.textContent).toContain('No matching files');
    expect(container.textContent).toContain('No files match “budget”');
    expect(container.querySelector('.empty-state-action')).toBeNull();

    act(() => root.render(
      <FileList files={[]} pagination={{ ...pagination, total: 0, totalPages: 0, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} {...common} sharedOnly />,
    ));
    expect(container.textContent).toContain('Nothing shared yet');
    expect(container.textContent).toContain('You have no public files');
  });

  it('keeps compact controls accessible and renders functional filter controls', () => {
    act(() => root.render(
      <FileList
        files={[{ ...file, visibility: 'PUBLIC', shareUrl: 'https://vaulta.example/share/token' }]}
        pagination={{ ...pagination, total: 1, totalPages: 1, hasNext: false }}
        onPageChange={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        {...common}
      />,
    ));

    for (const action of container.querySelectorAll('.file-actions>button')) {
      expect(action.textContent.trim() || action.getAttribute('aria-label')).toBeTruthy();
    }
    expect(container.querySelectorAll('.file-actions>button')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Add to favorites"].is-favorite')).toBeNull();
    expect(actionsButton().getAttribute('aria-haspopup')).toBe('menu');
    expect(actionsButton().getAttribute('aria-expanded')).toBe('false');
    openActions();
    expect(actionsButton().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('Actions for report.pdf');
    expect([...container.querySelectorAll('[role="menuitem"]')].map((button) => button.textContent.trim())).toEqual(['Download', 'Copy public link', 'Make private', 'Move to Trash']);
    expect([...container.querySelectorAll('.file-toolbar option')].map((option) => option.value)).toEqual(['newest', 'oldest', 'name-asc', 'name-desc', 'size-asc', 'size-desc', '', 'PUBLIC', 'PRIVATE']);
  });

  it('performs favorite, visibility, and Move-to-Trash actions before refreshing the parent', async () => {
    const onChange = vi.fn();
    const onFavorite = vi.fn();
    const onTrash = vi.fn();
    apiFetch
      .mockResolvedValueOnce({ file: { ...file, favorite: true } })
      .mockResolvedValueOnce({ file: { ...file, visibility: 'PUBLIC' } })
      .mockResolvedValueOnce({ file: { ...file, trashedAt: '2026-02-01T00:00:00Z' } });
    await act(async () => root.render(
      <FileList files={[file]} pagination={{ ...pagination, total: 1, totalPages: 1, hasNext: false }} onPageChange={vi.fn()} onChange={onChange} onFavorite={onFavorite} onTrash={onTrash} onDelete={vi.fn()} {...common} />,
    ));
    const favorite = container.querySelector('[aria-label="Add to favorites"]');
    expect(favorite.classList.contains('is-favorite')).toBe(false);
    await act(async () => favorite.click());
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/files/file-1/favorite', { method: 'PATCH', body: JSON.stringify({ favorite: true }) });
    expect(onFavorite).toHaveBeenCalledWith(expect.objectContaining({ favorite: true }));
    openActions();
    expect(menuItem('Make public')).not.toBeNull();
    await act(async () => menuItem('Make public').click());
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/files/file-1', { method: 'PATCH', body: JSON.stringify({ visibility: 'PUBLIC' }) });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'PUBLIC' }));
    expect(container.querySelector('[role="menu"]')).toBeNull();

    openActions();
    act(() => menuItem('Move to Trash').click());
    expect(container.querySelector('.delete-dialog').hasAttribute('open')).toBe(true);
    expect(container.textContent).toContain('can be restored later');
    await act(async () => [...container.querySelectorAll('.delete-dialog button')].find((button) => button.textContent.trim() === 'Move to Trash').click());
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/api/files/file-1/trash', { method: 'POST' });
    expect(onTrash).toHaveBeenCalledWith('file-1');
  });

  it('renders persisted favorite state with an explicit remove label', () => {
    act(() => root.render(
      <FileList files={[{ ...file, favorite: true }]} pagination={{ ...pagination, total: 1, totalPages: 1, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onFavorite={vi.fn()} onTrash={vi.fn()} onDelete={vi.fn()} {...common} />,
    ));
    const favorite = container.querySelector('[aria-label="Remove from favorites"]');
    expect(favorite).not.toBeNull();
    expect(favorite.classList.contains('is-favorite')).toBe(true);
  });

  it('allows only one menu and closes it on trigger toggle, outside click, and Escape', () => {
    const secondFile = { ...file, id: 'file-2', originalName: 'photo.png', mimeType: 'image/png' };
    act(() => root.render(
      <FileList files={[file, secondFile]} pagination={{ ...pagination, total: 2, totalPages: 1, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onFavorite={vi.fn()} onTrash={vi.fn()} onDelete={vi.fn()} {...common} />,
    ));

    openActions('report.pdf');
    expect(container.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('Actions for report.pdf');
    openActions('photo.png');
    expect(container.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(container.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('Actions for photo.png');

    act(() => actionsButton('photo.png').click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    openActions('photo.png');
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();

    openActions('report.pdf');
    expect(document.activeElement.textContent.trim()).toBe('Download');
    act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement.textContent.trim()).toBe('Make public');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(actionsButton('report.pdf'));
  });

  it('downloads from the menu and closes it after selection', async () => {
    apiFetch.mockResolvedValueOnce({ url: '#download-report' });
    await act(async () => root.render(
      <FileList files={[file]} pagination={{ ...pagination, total: 1, totalPages: 1, hasNext: false }} onPageChange={vi.fn()} onChange={vi.fn()} onFavorite={vi.fn()} onTrash={vi.fn()} onDelete={vi.fn()} {...common} />,
    ));
    openActions();
    await act(async () => menuItem('Download').click());
    expect(apiFetch).toHaveBeenCalledWith('/api/files/file-1/download');
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('shows only Restore and confirmed permanent deletion in Trash', async () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    apiFetch.mockResolvedValueOnce({ file: { ...file, trashedAt: null } }).mockResolvedValueOnce(null);
    const trashed = { ...file, favorite: true, visibility: 'PUBLIC', shareUrl: null, trashedAt: '2026-02-01T00:00:00Z' };
    await act(async () => root.render(
      <FileList files={[trashed]} view="trash" sort="deleted-newest" pagination={{ ...pagination, total: 1, totalPages: 1, hasNext: false }} onPageChange={vi.fn()} onRestore={onRestore} onDelete={onDelete} {...common} />,
    ));
    expect(container.querySelector('[aria-label="Add to favorites"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove from favorites"]')).toBeNull();
    expect(container.querySelectorAll('.file-actions>button')).toHaveLength(1);
    openActions();
    const labels = [...container.querySelectorAll('[role="menuitem"]')].map((button) => button.textContent.trim());
    expect(labels).toEqual(['Restore', 'Delete permanently']);
    expect(container.textContent).not.toContain('Copy link');
    expect(container.textContent).not.toContain('Make public');
    expect(container.textContent).not.toContain('Make private');
    await act(async () => menuItem('Restore').click());
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/files/file-1/restore', { method: 'POST' });
    expect(onRestore).toHaveBeenCalledWith('file-1');

    openActions();
    act(() => menuItem('Delete permanently').click());
    expect(container.textContent).toContain('This action cannot be undone');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await act(async () => [...container.querySelectorAll('.delete-dialog button')].find((button) => button.textContent.trim() === 'Delete permanently').click());
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/files/file-1', { method: 'DELETE' });
    expect(onDelete).toHaveBeenCalledWith('file-1');
  });
});
