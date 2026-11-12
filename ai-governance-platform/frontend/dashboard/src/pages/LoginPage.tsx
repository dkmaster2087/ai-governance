import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { PlumbMark } from '../components/kit/PlumbMark';
import { useAuth, getRegisteredAccounts, AUTH_MODE } from '../lib/auth';
import { SignInMethods, signInMethods, SSO_START } from '../lib/install-session';
import { useTheme } from '../lib/theme';

export function LoginPage() {
  const { login, completeChallenge } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const accounts = getRegisteredAccounts();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** Set when Cognito needs one more step to finish signing in. */
  const [challenge, setChallenge] = useState<'new_password' | 'mfa' | null>(null);
  const [challengeValue, setChallengeValue] = useState('');
  /** On an install: whether company sign-in is set up (and its name). */
  const [methods, setMethods] = useState<SignInMethods | null>(null);

  useEffect(() => {
    if (AUTH_MODE !== 'install') return;
    signInMethods().then(setMethods);
    // Company sign-in hands an error back in the address.
    const handed = new URLSearchParams(window.location.hash.slice(1)).get('error');
    if (handed) { setError(handed); window.history.replaceState(null, '', window.location.pathname); }
  }, []);

  const handleResult = (result: { success: boolean; error?: string; challenge?: 'new_password' | 'mfa' }) => {
    if (result.success) {
      navigate('/overview');
    } else if (result.challenge) {
      setChallenge(result.challenge);
      setChallengeValue('');
      if (result.error) setError(result.error);
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = challenge ? await completeChallenge(challenge, challengeValue) : await login(email, password);
    setLoading(false);
    handleResult(result);
  };

  const fillDemo = (acc: { email: string; password: string }) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setError('');
  };

  const inputClass = clsx(
    'w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all duration-200 border',
    isDark
      ? 'bg-white/[0.05] border-white/[0.08] text-white placeholder-slate-500 focus:border-brass-on-dark focus:ring-1 focus:ring-brass-on-dark/30'
      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-ink focus:ring-1 focus:ring-ink/20'
  );

  return (
    <div className={clsx('min-h-screen flex items-center justify-center p-4 relative overflow-hidden', isDark ? 'bg-[#060810]' : 'bg-[#f0f2f7]')}>
      {/* Background effects */}
      {isDark && (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff04_1px,transparent_1px),linear-gradient(to_bottom,#ffffff04_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-ink-soft/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-brass/5 rounded-full blur-[100px]" />
        </>
      )}

      <div className="relative w-full max-w-[420px] animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-ink flex items-center justify-center mx-auto mb-5">
            <PlumbMark size={32} onDark className="text-white" />
          </div>
          <h1 className={clsx('text-2xl font-bold tracking-tight', isDark ? 'text-white' : 'text-gray-900')}>Probaline</h1>
          <p className={clsx('text-sm mt-1.5', isDark ? 'text-slate-500' : 'text-gray-400')}>AI Governance Platform</p>
        </div>

        {/* Login card */}
        <div className={clsx(
          'border rounded-2xl p-8',
          isDark ? 'bg-[#111827]/80 backdrop-blur-sm border-white/[0.06]' : 'bg-white/80 backdrop-blur-sm border-gray-200/60 shadow-card'
        )}>
          <h2 className={clsx('text-lg font-semibold mb-6', isDark ? 'text-white' : 'text-gray-900')}>Sign in to your account</h2>

          {AUTH_MODE === 'unconfigured' && (
            <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Sign-in isn't configured for this deployment (missing Cognito settings).
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {challenge && (
              <div>
                <label className={clsx('block text-xs font-medium mb-1.5', isDark ? 'text-slate-400' : 'text-gray-500')} htmlFor="challenge">
                  {challenge === 'new_password' ? 'Choose a new password' : 'Code from your authenticator app'}
                </label>
                <input
                  id="challenge"
                  type={challenge === 'new_password' ? 'password' : 'text'}
                  inputMode={challenge === 'mfa' ? 'numeric' : undefined}
                  autoComplete={challenge === 'new_password' ? 'new-password' : 'one-time-code'}
                  value={challengeValue}
                  onChange={(e) => setChallengeValue(e.target.value)}
                  required
                  autoFocus
                  className={inputClass}
                />
                {challenge === 'new_password' && (
                  <p className={clsx('text-[11px] mt-1.5', isDark ? 'text-slate-500' : 'text-gray-400')}>
                    At least 12 characters, with upper and lower case letters, a number and a symbol.
                  </p>
                )}
              </div>
            )}
            {!challenge && (<>
            <div>
              <label className={clsx('block text-xs font-medium mb-1.5', isDark ? 'text-slate-400' : 'text-gray-500')} htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className={inputClass}
              />
            </div>

            <div>
              <label className={clsx('block text-xs font-medium mb-1.5', isDark ? 'text-slate-400' : 'text-gray-500')} htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className={clsx(inputClass, 'pr-11')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={clsx('absolute right-3 top-1/2 -translate-y-1/2 transition-colors', isDark ? 'text-slate-500 hover:text-white' : 'text-gray-400 hover:text-gray-900')}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            </>)}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 animate-slide-up">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {AUTH_MODE === 'install' && methods?.sso && !challenge && (
              <a href={SSO_START} className="w-full flex items-center justify-center py-3 rounded-xl border border-ink text-ink font-semibold no-underline hover:bg-ink hover:text-white transition-colors duration-200">
                Sign in with {methods.sso.name}
              </a>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-ink hover:bg-ink-soft disabled:opacity-60 text-white font-semibold transition-colors duration-200 mt-2"
            >
              {loading ? 'Signing in...' : challenge === 'new_password' ? 'Set Password' : challenge === 'mfa' ? 'Verify' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Demo accounts (local development only) */}
        {accounts.length > 0 && (
        <div className="mt-8">
          <p className={clsx('text-[11px] text-center mb-3 uppercase tracking-widest font-medium', isDark ? 'text-slate-600' : 'text-gray-400')}>Quick access</p>
          <div className="space-y-2">
            {accounts.map((acc) => (
              <button
                key={acc.email}
                onClick={() => fillDemo(acc)}
                className={clsx(
                  'w-full flex items-center justify-between border rounded-xl px-4 py-3 transition-all duration-200 group',
                  isDark
                    ? 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]'
                    : 'bg-white/60 border-gray-200/60 hover:bg-white hover:border-gray-300 shadow-card'
                )}
              >
                <div className="text-left">
                  <p className={clsx('text-sm font-medium transition-colors', isDark ? 'text-slate-300 group-hover:text-white' : 'text-gray-700 group-hover:text-gray-900')}>{acc.email}</p>
                  <p className={clsx('text-[11px]', isDark ? 'text-slate-600' : 'text-gray-400')}>{acc.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx('text-[11px] font-medium bg-brass/10 px-2 py-0.5 rounded-lg border border-brass/25', isDark ? 'text-brass-on-dark' : 'text-brass-text')}>
                    {acc.badge}
                  </span>
                  <ArrowRight className={clsx('w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5', isDark ? 'text-slate-600' : 'text-gray-300')} />
                </div>
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
