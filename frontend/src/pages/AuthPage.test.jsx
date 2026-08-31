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

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  authenticate = vi.fn().mockResolvedValue({ id: 'user-1' });
  useAuth.mockReturnValue({ user: null, loading: false, authenticate });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('registration name', () => {
  it('collects name and sends it only for registration', async () => {
    act(() => root.render(<MemoryRouter><AuthPage mode="register" /></MemoryRouter>));
    const values = { Name: 'Ada Lovelace', 'Email address': 'ada@example.com', Password: 'a sufficiently long password', 'Repeat password': 'a sufficiently long password' };
    for (const [label, value] of Object.entries(values)) {
      const input = [...container.querySelectorAll('label')].find((element) => element.textContent.includes(label)).querySelector('input');
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
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
