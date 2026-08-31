/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.js';
import { SharePage } from './SharePage.jsx';

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('SharePage file metadata', () => {
  it('uses the shared MB-minimum formatter for the public file size', async () => {
    const token = 'a'.repeat(43);
    apiFetch.mockResolvedValue({
      originalName: 'screenshot.png',
      sizeBytes: 54 * 1024,
      downloadExpiresIn: 300,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/share/${token}`]}>
          <Routes>
            <Route path="/share/:shareToken" element={<SharePage />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiFetch).toHaveBeenCalledWith(`/api/public/${token}`);
    expect(container.querySelector('.share-card').textContent).toContain('0.05 MB');
  });
});
