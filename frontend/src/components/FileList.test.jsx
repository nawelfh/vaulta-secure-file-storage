/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileIcon } from './FileList.jsx';

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
  ])('renders %s with the correct badge', (mimeType, badge, className) => {
    act(() => root.render(<FileIcon mimeType={mimeType} />));
    const icon = container.querySelector('.file-icon');
    expect(icon.textContent).toBe(badge);
    expect(icon.classList.contains(className)).toBe(true);
    expect(icon.textContent).not.toBe('TXT');
  });

  it('never presents an unknown video type as text', () => {
    act(() => root.render(<FileIcon mimeType="video/example" />));
    expect(container.querySelector('.file-icon').textContent).toBe('VID');
  });
});
