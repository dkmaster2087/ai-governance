import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Shield, Eye, EyeOff, AlertCircle, Sun, Moon, ArrowRight } from 'lucide-react';
import { useAuth, getRegisteredAccounts } from '../lib/auth';
import { useTheme } from '../lib/theme';

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

  const inputClass = clsx(
    'w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all duration-200 border',
    isDark
      ? 'bg-white/[0.05] border-white/[0.08] text-white placeholder-slate-500 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30'
      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20'
  );

  return (
    <div className={clsx('min-h-screen flex items-center justify-center p-4 relative overflow-hidden', isDark ? 'bg-[#0a0e1a]' : 'bg-[#f5f7fb]')}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className={clsx(
          'absolute top-5 right-5 p-2.5 rounded-xl transition-all duration-200 z-10',
          isDark ? 'text-slate-400 hover:text-yellow-400 hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'
        )}
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Background effects */}
      {isDark && (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff04_1px,transparent_1px),linear-gradient(to_bottom,#ffffff04_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-600/8 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-accent-500/5 rounded-full blur-[100px]" />
        </>
      )}

      <div className="relative w-full max-w-[420px] animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-5 shadow-glow-brand">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className={clsx('text-2xl font-bold tracking-tight', isDark ? 'text-white' : 'text-gray-900')}>Aegis AI</h1>
          <p className={clsx('text-sm mt-1.5', isDark ? 'text-slate-500' : 'text-gray-400')}>AI Governance Platform</p>
        </div>

        {/* Login card */}
        <div className={clsx(
          'border rounded-2xl p-8',
          isDark ? 'bg-[#111827]/80 backdrop-blur-sm border-white/[0.06]' : 'bg-white/80 backdrop-blur-sm border-gray-200/60 shadow-card'
        )}>
          <h2 className={clsx('text-lg font-semibold mb-6', isDark ? 'text-white' : 'text-gray-900')}>Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 animate-slide-up">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-60 text-white font-semibold transition-all duration-200 mt-2 shadow-glow-brand"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Demo accounts */}
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
                  <span className="text-[11px] font-medium text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-lg border border-brand-500/20">
                    {acc.badge}
                  </span>
                  <ArrowRight className={clsx('w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5', isDark ? 'text-slate-600' : 'text-gray-300')} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
