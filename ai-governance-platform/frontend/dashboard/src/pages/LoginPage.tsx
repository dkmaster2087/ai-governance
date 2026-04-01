import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Shield, Eye, EyeOff, AlertCircle, Sun, Moon } from 'lucide-react';
import { useAuth, getRegisteredAccounts } from '../lib/auth';
import { useTheme } from '../lib/theme';

const PLACEHOLDER_ACCOUNTS: never[] = []; // Replaced by dynamic accounts

export function LoginPage() {
  const { login } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const accounts = getRegisteredAccounts();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) {
      navigate('/overview');
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const fillDemo = (acc: { email: string; password: string }) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setError('');
  };

  return (
    <div className={clsx('min-h-screen flex items-center justify-center p-4', isDark ? 'bg-slate-950' : 'bg-gray-50')}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className={clsx(
          'absolute top-4 right-4 p-2 rounded-lg transition-colors',
          isDark ? 'text-slate-400 hover:text-yellow-400 hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
        )}
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Background grid (dark only) */}
      {isDark && <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-[size:64px_64px]" />}
      {isDark && <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-600/10 rounded-full blur-[100px]" />}

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className={clsx('text-2xl font-bold', isDark ? 'text-white' : 'text-gray-900')}>Aegis AI</h1>
          <p className={clsx('text-sm mt-1', isDark ? 'text-slate-500' : 'text-gray-500')}>AI Governance Platform</p>
        </div>

        {/* Login card */}
        <div className={clsx('border rounded-2xl p-8', isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-gray-200 shadow-lg')}>
          <h2 className={clsx('text-lg font-semibold mb-6', isDark ? 'text-white' : 'text-gray-900')}>Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={clsx('block text-xs mb-1.5', isDark ? 'text-slate-400' : 'text-gray-500')} htmlFor="email">
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
                className="w-full surface-input rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            <div>
              <label className={clsx('block text-xs mb-1.5', isDark ? 'text-slate-400' : 'text-gray-500')} htmlFor="password">
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
                  className="w-full surface-input rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:border-brand-500 transition-colors"
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

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-60
                text-white font-semibold transition-colors mt-2"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Demo accounts */}
        <div className="mt-6">
          <p className={clsx('text-xs text-center mb-3 uppercase tracking-wider', isDark ? 'text-slate-600' : 'text-gray-400')}>Accounts</p>
          <div className="space-y-2">
            {accounts.map((acc) => (
              <button
                key={acc.email}
                onClick={() => fillDemo(acc)}
                className={clsx(
                  'w-full flex items-center justify-between border rounded-xl px-4 py-3 transition-colors group',
                  isDark
                    ? 'bg-slate-900/60 border-white/10 hover:border-white/20'
                    : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm'
                )}
              >
                <div className="text-left">
                  <p className={clsx('text-sm transition-colors', isDark ? 'text-slate-300 group-hover:text-white' : 'text-gray-700 group-hover:text-gray-900')}>{acc.email}</p>
                  <p className={clsx('text-xs', isDark ? 'text-slate-600' : 'text-gray-400')}>{acc.role}</p>
                </div>
                <span className="text-xs text-brand-400 bg-brand-600/20 px-2 py-0.5 rounded-full">
                  {acc.badge}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
