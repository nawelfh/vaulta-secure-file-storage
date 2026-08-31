import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { AuthContext } from './auth-context.js';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const restoreControllerRef = useRef(null);
  const authSequenceRef = useRef(0);

  useEffect(() => {
    const sequence = authSequenceRef.current + 1;
    authSequenceRef.current = sequence;
    const controller = new AbortController();
    restoreControllerRef.current = controller;
    apiFetch('/api/auth/me', { signal: controller.signal, timeoutMs: 45_000 })
      .then((result) => {
        if (sequence === authSequenceRef.current) setUser(result.user);
      })
      .catch(() => {
        if (sequence === authSequenceRef.current) setUser(null);
      })
      .finally(() => {
        if (sequence === authSequenceRef.current) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const authenticate = useCallback(async (mode, credentials) => {
    const sequence = authSequenceRef.current + 1;
    authSequenceRef.current = sequence;
    restoreControllerRef.current?.abort();
    try {
      const result = await apiFetch(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(credentials),
        ...(mode === 'login' ? { timeoutMs: 45_000 } : {}),
      });
      if (sequence === authSequenceRef.current) setUser(result.user);
      return result.user;
    } finally {
      if (sequence === authSequenceRef.current) setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, authenticate, logout }), [user, loading, authenticate, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
