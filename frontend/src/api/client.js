const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const CSRF_COOKIE_NAME = import.meta.env.VITE_CSRF_COOKIE_NAME || 'secure_store_csrf';

function readCookie(name) {
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export class ApiClientError extends Error {
  constructor(message, status, code, details, requestId) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function apiFetch(path, options = {}) {
  const { timeoutMs, signal: callerSignal, ...requestOptions } = options;
  const method = requestOptions.method || 'GET';
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  let timeoutId;
  let timeoutTriggered = false;
  let forwardAbort;
  const timeoutController = timeoutMs ? new AbortController() : null;
  if (timeoutController && callerSignal) {
    forwardAbort = () => timeoutController.abort(callerSignal.reason);
    if (callerSignal.aborted) forwardAbort();
    else callerSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  if (timeoutController) {
    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      timeoutController.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      signal: timeoutController?.signal || callerSignal,
      headers,
      credentials: 'include',
    });
    if (response.status === 204) return null;

    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (timeoutTriggered) throw error;
      data = null;
    }
    if (!response.ok) {
      throw new ApiClientError(
        data?.error?.message || 'The request could not be completed.',
        response.status,
        data?.error?.code || 'REQUEST_FAILED',
        data?.error?.details,
        data?.error?.requestId || response.headers.get('x-request-id') || undefined,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (timeoutTriggered) {
      throw new ApiClientError('The secure service took too long to respond. Please try again.', 0, 'REQUEST_TIMEOUT');
    }
    if (error.name === 'AbortError') throw error;
    throw new ApiClientError('Vaulta could not reach the secure service. Please try again.', 0, 'NETWORK_ERROR');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (forwardAbort) callerSignal.removeEventListener('abort', forwardAbort);
  }
}
