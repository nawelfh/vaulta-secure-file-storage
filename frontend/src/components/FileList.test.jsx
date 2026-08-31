/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileIcon, FileList } from './FileList.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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

describe('FileList dashboard totals and pagination', () => {
  const file = {
    id: 'file-1',
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'READY',
    visibility: 'PRIVATE',
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('labels the count from authoritative stats and exposes Load more', () => {
    const onLoadMore = vi.fn();
    act(() => root.render(
      <FileList
        files={[file]}
        totalFiles={300}
        nextCursor="cursor-50"
        onLoadMore={onLoadMore}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain('300 total');
    const loadMore = [...container.querySelectorAll('button')]
      .find((element) => element.textContent === 'Load more');
    act(() => loadMore.click());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('calls a non-authoritative count loaded when stats are unavailable', () => {
    act(() => root.render(
      <FileList files={[file]} onChange={vi.fn()} onDelete={vi.fn()} />,
    ));
    expect(container.textContent).toContain('1 loaded');
    expect(container.textContent).not.toContain('1 total');
  });

  it('uses a professional SVG empty state with a real upload destination', () => {
    act(() => root.render(
      <FileList files={[]} totalFiles={0} onChange={vi.fn()} onDelete={vi.fn()} />,
    ));

    expect(container.textContent).toContain('No files yet');
    expect(container.textContent).toContain('Upload your first file');
    expect(container.textContent).not.toContain('◇');
    expect(container.querySelector('.empty-icon svg')).not.toBeNull();
    expect(container.querySelector('.empty-state-action').getAttribute('href')).toBe('#upload');
  });

  it('keeps every file action textually named for assistive technology', () => {
    act(() => root.render(
      <FileList
        files={[{ ...file, visibility: 'PUBLIC', shareUrl: 'https://vaulta.example/share/token' }]}
        totalFiles={1}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    ));

    for (const action of container.querySelectorAll('.file-actions button')) {
      expect(action.textContent.trim()).not.toBe('');
    }
  });
});
