/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFooter } from './AppFooter.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<AppFooter />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AppFooter', () => {
  it('renders concise Vaulta identity and the current year', () => {
    expect(container.querySelector('footer')).not.toBeNull();
    expect(container.textContent).toContain('Vaulta');
    expect(container.textContent).toContain('Secure storage and intentional sharing');
    expect(container.textContent).toContain(`© ${new Date().getFullYear()} Vaulta`);
    expect(container.textContent).toContain('Private by default');
    expect(container.querySelector('.brand-mark svg')).not.toBeNull();
  });

  it('contains no fake footer navigation or legal links', () => {
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Privacy|Terms|Billing|Settings/);
  });
});
