/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/useAuth.js';
import { AuthPage } from './AuthPage.jsx';

vi.mock('../context/useAuth.js', () => ({ useAuth: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let authenticate;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setField(label, value) {
  const input = [...container.querySelectorAll('label')]
    .find((element) => element.textContent.includes(label)).querySelector('input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

function submitForm() {
  container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  authenticate = vi.fn().mockResolvedValue({ id: 'user-1' });
  useAuth.mockReturnValue({ user: null, loading: false, authenticate });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('registration name', () => {
  it('collects name and sends it only for registration', async () => {
    act(() => root.render(<MemoryRouter><AuthPage mode="register" /></MemoryRouter>));
    const values = { Name: 'Ada Lovelace', 'Email address': 'ada@example.com', Password: 'a sufficiently long password', 'Repeat password': 'a sufficiently long password' };
    for (const [label, value] of Object.entries(values)) {
      setField(label, value);
    }
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(authenticate).toHaveBeenCalledWith('register', {
      name: 'Ada Lovelace', email: 'ada@example.com', password: 'a sufficiently long password',
    });
  });

  it('does not show or send a name field during login', async () => {
    act(() => root.render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>));
    expect(container.querySelector('input[autocomplete="name"]')).toBeNull();
  });
});

describe('sign-in responsiveness', () => {
  function renderLogin() {
    act(() => root.render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>));
    setField('Email address', 'ada@example.com');
    setField('Password', 'a sufficiently long password');
  }

  it('immediately shows Signing in and blocks duplicate submissions', async () => {
    const login = deferred();
    authenticate.mockReturnValue(login.promise);
    renderLogin();
    act(() => {
      submitForm();
      submitForm();
    });
    const submit = container.querySelector('button[type="submit"]');
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('Signing in…');
    expect(submit.querySelector('.auth-button-spinner')).not.toBeNull();
    expect(authenticate).toHaveBeenCalledTimes(1);
    await act(async () => login.resolve({ id: 'user-1' }));
  });

  it('shows slow-service guidance only after three seconds and clears it on success', async () => {
    vi.useFakeTimers();
    const login = deferred();
    authenticate.mockReturnValue(login.promise);
    renderLogin();
    act(() => submitForm());
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(container.querySelector('.auth-slow-message')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.querySelector('.auth-slow-message').textContent).toContain('may be waking from an idle state');
    await act(async () => login.resolve({ id: 'user-1' }));
    expect(container.querySelector('.auth-slow-message')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never shows slow-service guidance for a fast login', async () => {
    vi.useFakeTimers();
    renderLogin();
    act(() => submitForm());
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(container.querySelector('.auth-slow-message')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the slow-login timer when unmounted', () => {
    vi.useFakeTimers();
    authenticate.mockReturnValue(new Promise(() => {}));
    renderLogin();
    act(() => submitForm());
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [{ code: 'INVALID_CREDENTIALS', message: 'server wording' }, 'Invalid email or password.'],
    [{ code: 'NETWORK_ERROR', message: 'low-level network details' }, 'Vaulta could not reach the secure service. Please try again.'],
    [{ code: 'REQUEST_TIMEOUT', message: 'abort details' }, 'The secure service took too long to respond. Please try again.'],
    [{ status: 503, message: 'database details' }, 'Vaulta could not reach the secure service. Please try again.'],
  ])('presents a safe categorized login error for %o', async (failure, expected) => {
    authenticate.mockRejectedValue(failure);
    renderLogin();
    act(() => submitForm());
    await flush();
    expect(container.querySelector('[role="alert"]').textContent).toBe(expected);
    expect(container.textContent).not.toContain(failure.message);
  });

  it('retains the email and allows a clean retry after a transport failure', async () => {
    authenticate
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'network details' })
      .mockResolvedValueOnce({ id: 'user-1' });
    renderLogin();
    act(() => submitForm());
    await flush();
    expect(container.querySelector('input[type="email"]').value).toBe('ada@example.com');
    expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
    act(() => submitForm());
    await flush();
    expect(authenticate).toHaveBeenCalledTimes(2);
  });
});
