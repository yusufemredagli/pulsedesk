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
            ? 'E-posta adresi veya şifre doğrulanamadı.'
            : failure.status === 409
              ? 'Bu bilgilerle kayıtlı bir hesap var. Giriş yapmayı deneyin.'
              : failure.message
          : 'İşleminiz tamamlanamadı. Lütfen tekrar deneyin.',
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
            <span className="eyebrow">
              DESTEK OPERASYONLARININ ÇALIŞMA ALANI
            </span>
            <h1>
              Her sinyal.
              <br />
              Daha net bir yanıt.
            </h1>
            <p>
              Müşteri ve operasyon akışını yöneten ekipler için odaklı bir
              çalışma alanı.
            </p>
            <div className="signal-art" aria-hidden="true">
              <div className="signal-grid" />
              <svg viewBox="0 0 480 160">
                <path className="signal-baseline" d="M0 88H480" />
                <path d="M0 88h100l18-24 24 48 34-90 34 118 30-68 22 16h218" />
              </svg>
              <span className="signal-node" />
              <span className="art-caption">
                Her yanıtın merkezinde netlik.
              </span>
            </div>
          </div>
          <div className="story-footer">
            <span className="small-mark" /> Tek çalışma alanı. Koordine bir
            ekip.
          </div>
        </section>
        <section className="auth-main">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <div className="auth-card">
            <span className="overline">
              {register
                ? 'NET BİR BAŞLANGIÇ YAPIN'
                : 'ÇALIŞMA ALANINIZ, ODAĞINIZDA'}
            </span>
            <h2>
              {register
                ? 'Daha iyi destek için yer açın.'
                : 'Tekrar hoş geldin.'}
            </h2>
            <p className="auth-description">
              {register
                ? 'Hesabınızı ve ekibinizin çalışma alanını oluşturun.'
                : 'PulseDesk çalışma alanına giriş yap.'}
            </p>
            <form onSubmit={submit} noValidate aria-busy={pending}>
              {register &&
                field('name', 'Ad Soyad', 'text', 'name', 'Deniz Yılmaz')}
              {field(
                'email',
                'İş e-postası',
                'email',
                'username',
                'siz@sirket.com',
              )}
              {field(
                'password',
                'Şifre',
                'password',
                register ? 'new-password' : 'current-password',
                register ? 'En az 10 karakter' : 'Şifrenizi girin',
              )}
              {register && (
                <p id="password-help" className="field-help">
                  10–128 karakter kullanın. Kolay hatırlayabileceğiniz uzun bir
                  şifre seçin.
                </p>
              )}
              {register &&
                field(
                  'organizationName',
                  'Çalışma Alanı Adı',
                  'text',
                  'organization',
                  'Ekibinizin veya şirketinizin adı',
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
                    {register
                      ? 'Çalışma alanı oluşturuluyor'
                      : 'Giriş yapılıyor'}
                  </>
                ) : (
                  <>
                    {register ? 'Çalışma Alanı Oluştur' : 'Giriş Yap'}
                    <Icon name="arrow" size={18} />
                  </>
                )}
              </button>
            </form>
            <p className="auth-alternative">
              {register
                ? 'Zaten bir hesabınız var mı?'
                : 'PulseDesk’e yeni misin?'}{' '}
              <Link href={register ? '/login' : '/register'}>
                {register ? 'Giriş Yap' : 'Çalışma Alanı Oluştur'}
              </Link>
            </p>
            {!state.session.persistent && (
              <p className="storage-notice">
                Bu tarayıcı oturumunuzu kaydedemiyor. Çalışırken bu sekmeyi açık
                tutun.
              </p>
            )}
            <div className="auth-security">
              <Icon name="shield" size={15} />
              <span>Ekibinizin birlikte yanıt verdiği çalışma alanı.</span>
            </div>
          </div>
          <footer className="auth-footer">
            PulseDesk <span>Desteğin ritmini yakalayın.</span>
          </footer>
        </section>
      </main>
    </RouteGate>
  );
}
