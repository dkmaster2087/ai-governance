import { Link } from 'react-router-dom';
import { Shield, Lock, Eye, Zap, ArrowRight, CheckCircle, ChevronRight } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Policy Enforcement',
    description: 'Keyword blocking, model restrictions, PII detection, compliance frameworks — 6 standards built in. Evaluated in real time on every request.',
  },
  {
    icon: Lock,
    title: 'PII Protection',
    description: 'Automatic detection and masking of sensitive data using Amazon Comprehend and regex rules. Scans both requests and responses.',
  },
  {
    icon: Eye,
    title: 'Full Audit Trail',
    description: 'Every prompt, response, and policy decision logged with per-user cost tracking. CSV/PDF export. Time-period filtering.',
  },
  {
    icon: Zap,
    title: 'Managed + Proxy Mode',
    description: 'Managed mode with API key storage, or transparent proxy mode for IDE traffic (Kiro, Copilot). Supports OpenAI, Anthropic, Bedrock, Cohere, Mistral.',
  },
];

const stats = [
  { value: '< 50ms', label: 'Added latency' },
  { value: '99.9%', label: 'Uptime SLA' },
  { value: '6', label: 'Compliance frameworks' },
  { value: '4', label: 'AI providers supported' },
];

const trustedBy = ['Fortune 500 Healthcare', 'Global Financial Services', 'Government Agencies', 'Legal & Compliance Teams'];

export function HomePage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Center glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-600/15 rounded-full blur-[120px] animate-glow-pulse" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-sm text-brand-300 mb-8">
            <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulse-slow" />
            Now available: On-premises deployment for enterprise
            <ChevronRight className="w-3 h-3" />
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6">
            AI Governance for the{' '}
            <span className="gradient-text">Enterprise</span>
          </h1>

          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            A centralized AI control plane that enforces policy, masks sensitive data, and audits every interaction — without slowing your teams down.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/contact"
              className="px-8 py-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-lg transition-all hover:scale-105 flex items-center gap-2"
            >
              Book a Demo <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              to="/product"
              className="px-8 py-4 rounded-xl glass text-white font-semibold text-lg hover:bg-white/10 transition-all"
            >
              See How It Works
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((stat) => (
              <div key={stat.label} className="glass rounded-xl p-4">
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-sm text-slate-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Every AI request, under control</h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Aegis AI sits between your apps and AI providers. Transparent to developers, powerful for compliance teams.
            </p>
          </div>

          {/* Flow diagram */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 mb-6">
            {['Client / IDE', 'Aegis Gateway', 'Policy Engine', 'AI Provider', 'Response Scan', 'Client'].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-4">
                <div className={`px-4 py-3 rounded-xl text-sm font-medium text-center min-w-[120px] ${
                  step === 'Aegis Gateway' || step === 'Policy Engine'
                    ? 'bg-brand-600 text-white'
                    : step === 'Response Scan'
                      ? 'bg-accent-600/30 text-accent-300'
                      : 'glass text-slate-300'
                }`}>
                  {step}
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0 hidden md:block" />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-slate-500 text-xs mb-16">Works in managed mode (Aegis holds keys) or transparent proxy mode (client credentials pass through)</p>

          {/* Features grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature) => (
              <div key={feature.title} className="glass rounded-2xl p-6 hover:bg-white/10 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center mb-4 group-hover:bg-brand-600/30 transition-colors">
                  <feature.icon className="w-5 h-5 text-brand-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{feature.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="py-16 border-y border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-slate-500 text-sm uppercase tracking-widest mb-8">Built for regulated industries</p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {trustedBy.map((name) => (
              <span key={name} className="text-slate-400 font-medium">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="glass rounded-3xl p-12 glow">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Ready to govern your AI?
            </h2>
            <p className="text-slate-400 text-lg mb-8">
              Start with our SaaS offering or deploy on-premises in your own infrastructure.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/contact"
                className="px-8 py-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all hover:scale-105"
              >
                Book a Demo
              </Link>
              <Link
                to="/pricing"
                className="px-8 py-4 rounded-xl glass text-white font-semibold hover:bg-white/10 transition-all"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
