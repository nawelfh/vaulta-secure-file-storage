const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const CSRF_COOKIE_NAME = import.meta.env.VITE_CSRF_COOKIE_NAME || 'secure_store_csrf';

function readCookie(name) {
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export class ApiClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiClientError(
      data?.error?.message || 'The request could not be completed.',
      response.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.details,
    );
  }
  return data;
}

export const publicDownloadUrl = (shareToken) => `${API_BASE_URL}/api/public/${shareToken}`;
