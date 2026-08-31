import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AppFooter } from '../components/AppFooter.jsx';
import { Icon } from '../components/Icons.jsx';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/useAuth.js';

export function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const navigate = useNavigate();
  const { user, loading, authenticate } = useAuth();

  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));

    setError('');
  }

  async function submit(event) {
    event.preventDefault();

    if (isRegister && form.password !== form.confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await authenticate(mode, {
        email: form.email,
        password: form.password,
      });

      navigate('/dashboard', { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page-shell">
      <main className="auth-layout">
      <section className="auth-story">
        <Logo />

        <div className="story-content">
          <p className="eyebrow light">Simple, private, yours</p>

          <h1>Your files deserve a quieter place.</h1>

          <p>
            Store large files securely, keep complete control, and share only
            when you choose.
          </p>

          <ul>
            <li>
              <span><Icon name="check" /></span>
              Private by default
            </li>

            <li>
              <span><Icon name="check" /></span>
              Short-lived download access
            </li>

            <li>
              <span><Icon name="check" /></span>
              Uploads up to 250 MB
            </li>
          </ul>
        </div>

        <small>Built with security at every layer.</small>
      </section>

      <section className="auth-form-panel">
        <div className="mobile-brand">
          <Logo />
        </div>

        <form className="auth-form" onSubmit={submit}>
          <p className="eyebrow">
            {isRegister ? 'Create your vault' : 'Welcome back'}
          </p>

          <h2>
            {isRegister ? 'Start storing securely' : 'Sign in to Vaulta'}
          </h2>

          <p className="form-intro">
            {isRegister
              ? 'One account. Your files, under your control.'
              : 'Enter your details to access your files.'}
          </p>

          <label>
            Email address

            <input
              type="email"
              autoComplete="email"
              required
              maxLength="254"
              placeholder="you@example.com"
              value={form.email}
              onChange={(event) =>
                updateField('email', event.target.value)
              }
            />
          </label>

          <label>
            Password

            <input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              minLength="12"
              maxLength="128"
              placeholder="At least 12 characters"
              value={form.password}
              onChange={(event) =>
                updateField('password', event.target.value)
              }
            />
          </label>

          {isRegister && (
            <label>
              Repeat password

              <input
                type="password"
                autoComplete="new-password"
                required
                minLength="12"
                maxLength="128"
                placeholder="Enter the same password again"
                value={form.confirmPassword}
                onChange={(event) =>
                  updateField('confirmPassword', event.target.value)
                }
              />
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="button button-primary button-wide"
            disabled={submitting}
            type="submit"
          >
            {submitting
              ? 'Please wait…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </button>

          <p className="auth-switch">
            {isRegister
              ? 'Already have an account?'
              : 'New to Vaulta?'}{' '}

            <Link to={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </form>
      </section>
      </main>
      <AppFooter />
    </div>
  );
}
