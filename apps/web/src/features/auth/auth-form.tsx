'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Brand, Icon } from '../../components/brand';
import { ApiError } from '../../lib/api/client';
import { useApplication } from '../application/provider';
import { RouteGate } from './route-gate';
import { validateAuth } from './validation';
export function AuthForm({ register = false }: { register?: boolean }) {
  const { client, state } = useApplication();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      email: String(data.get('email') ?? '')
        .trim()
        .toLowerCase(),
      password: String(data.get('password') ?? ''),
      ...(register
        ? {
            name: String(data.get('name') ?? '').trim(),
            organizationName: String(data.get('organizationName') ?? '').trim(),
          }
        : {}),
    };
    const invalid = validateAuth(input, register);
    setErrors(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      requestAnimationFrame(() =>
        form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setPending(true);
    try {
      if (register) await client.register(input as Required<typeof input>);
      else await client.login(input);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.status === 401
            ? 'That email and password could not be verified.'
            : failure.status === 409
              ? 'An account with these details already exists. Try signing in.'
              : failure.message
          : 'We could not complete your request. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }
  function field(
    name: string,
    label: string,
    type = 'text',
    autoComplete?: string,
    placeholder?: string,
  ) {
    return (
      <div className="field">
        <label htmlFor={name}>{label}</label>
        <input
          id={name}
          name={name}
          type={type}
          autoComplete={autoComplete}
          required
          minLength={name === 'password' ? 10 : 1}
          maxLength={name === 'password' ? 128 : name === 'email' ? 254 : 100}
          aria-invalid={!!errors[name]}
          aria-describedby={
            errors[name]
              ? `${name}-error`
              : name === 'password' && register
                ? 'password-help'
                : undefined
          }
          placeholder={placeholder}
        />
        {errors[name] && (
          <p id={`${name}-error`} className="field-error">
            {errors[name]}
          </p>
        )}
      </div>
    );
  }
  return (
    <RouteGate area="public">
      <main className="auth-layout">
        <section className="auth-story" aria-label="PulseDesk">
          <Link href="/login" className="brand-link">
            <Brand />
          </Link>
          <div className="story-content">
            <span className="eyebrow">THE SUPPORT OPERATIONS WORKSPACE</span>
            <h1>
              Every signal.
              <br />A clearer response.
            </h1>
            <p>
              A focused home for the people keeping customers and operations
              moving.
            </p>
            <div className="signal-art" aria-hidden="true">
              <div className="signal-grid" />
              <svg viewBox="0 0 480 160">
                <path className="signal-baseline" d="M0 88H480" />
                <path d="M0 88h100l18-24 24 48 34-90 34 118 30-68 22 16h218" />
              </svg>
              <span className="signal-node" />
              <span className="art-caption">
                Clarity at the center of your response.
              </span>
            </div>
          </div>
          <div className="story-footer">
            <span className="small-mark" /> One workspace. A coordinated team.
          </div>
        </section>
        <section className="auth-main">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <div className="auth-card">
            <span className="overline">
              {register
                ? 'START WITH A CLEAR SIGNAL'
                : 'YOUR WORKSPACE, IN FOCUS'}
            </span>
            <h2>
              {register ? 'Make room for better support.' : 'Welcome back.'}
            </h2>
            <p className="auth-description">
              {register
                ? 'Create your account and your team’s workspace.'
                : 'Sign in to your PulseDesk workspace.'}
            </p>
            <form onSubmit={submit} noValidate aria-busy={pending}>
              {register &&
                field('name', 'Full name', 'text', 'name', 'Alex Morgan')}
              {field(
                'email',
                'Work email',
                'email',
                'username',
                'you@company.com',
              )}
              {field(
                'password',
                'Password',
                'password',
                register ? 'new-password' : 'current-password',
                register ? 'At least 10 characters' : 'Enter your password',
              )}
              {register && (
                <p id="password-help" className="field-help">
                  10–128 characters. A memorable passphrase works well.
                </p>
              )}
              {register &&
                field(
                  'organizationName',
                  'Organization name',
                  'text',
                  'organization',
                  'Your team or company',
                )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button primary auth-submit"
                disabled={pending}
                type="submit"
              >
                {pending ? (
                  <>
                    <span className="spinner small" />
                    {register ? 'Creating your workspace' : 'Signing you in'}
                  </>
                ) : (
                  <>
                    {register ? 'Create workspace' : 'Sign in'}
                    <Icon name="arrow" size={18} />
                  </>
                )}
              </button>
            </form>
            <p className="auth-alternative">
              {register ? 'Already have an account?' : 'New to PulseDesk?'}{' '}
              <Link href={register ? '/login' : '/register'}>
                {register ? 'Sign in' : 'Create a workspace'}
              </Link>
            </p>
            {!state.session.persistent && (
              <p className="storage-notice">
                This browser cannot save your session. Keep this tab open while
                you work.
              </p>
            )}
            <div className="auth-security">
              <Icon name="shield" size={15} />
              <span>A dedicated space for your team’s response.</span>
            </div>
          </div>
          <footer className="auth-footer">
            PulseDesk <span>Support, with a steady pulse.</span>
          </footer>
        </section>
      </main>
    </RouteGate>
  );
}
