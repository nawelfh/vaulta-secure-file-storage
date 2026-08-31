/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.js';
import { AuthProvider } from './AuthContext.jsx';
import { useAuth } from './useAuth.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function AuthProbe() {
  const { user, loading, authenticate } = useAuth();
  return (
    <div>
      <span data-testid="auth-state">{loading ? 'loading' : user?.email || 'anonymous'}</span>
      <button type="button" onClick={() => authenticate('login', { email: 'ada@example.com', password: 'a sufficiently long password' })}>Log in</button>
    </div>
  );
}

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

describe('AuthProvider request sequencing', () => {
  it('restores an existing session with /auth/me on a full-page mount', async () => {
    apiFetch.mockResolvedValueOnce({ user: { id: 'user-1', email: 'restored@example.com' } });
    await act(async () => root.render(<AuthProvider><AuthProbe /></AuthProvider>));
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/me', { signal: expect.any(AbortSignal), timeoutMs: 45_000 });
    expect(container.querySelector('[data-testid="auth-state"]').textContent).toBe('restored@example.com');
  });

  it('uses the login response immediately, aborts stale restoration, and does not request /auth/me again', async () => {
    const restoration = deferred();
    const loginUser = { id: 'user-2', email: 'ada@example.com' };
    apiFetch.mockReturnValueOnce(restoration.promise).mockResolvedValueOnce({ user: loginUser });
    act(() => root.render(<AuthProvider><AuthProbe /></AuthProvider>));
    const restoreSignal = apiFetch.mock.calls[0][1].signal;

    await act(async () => container.querySelector('button').click());
    expect(restoreSignal.aborted).toBe(true);
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ada@example.com', password: 'a sufficiently long password' }),
      timeoutMs: 45_000,
    });
    expect(container.querySelector('[data-testid="auth-state"]').textContent).toBe('ada@example.com');
    expect(apiFetch.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(1);

    await act(async () => restoration.resolve({ user: { id: 'stale', email: 'stale@example.com' } }));
    expect(container.querySelector('[data-testid="auth-state"]').textContent).toBe('ada@example.com');
  });
});
