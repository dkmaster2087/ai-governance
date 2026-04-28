import { Link } from 'react-router-dom';
import { Cloud, Server, ArrowRight, CheckCircle } from 'lucide-react';

const saasFeatures = [
  'Fully managed — no infrastructure to operate',
  'Multi-tenant with strict tenant isolation',
  'Automatic updates and security patches',
  'Global availability via AWS regions',
  'Pay-as-you-go pricing',
  'Up and running in minutes',
];

const onPremFeatures = [
  'Deploy in your own AWS account or data center',
  'Complete data sovereignty — nothing leaves your environment',
  'Air-gapped deployment option',
  'License key management with user counts and validity periods',
  'Configurable reporting — choose what syncs to SaaS platform',
  'Integrate with existing VPN, proxy, MDM, Active Directory',
  'Annual licensing with volume discounts',
];

const phases = [
  {
    phase: 'Phase 1',
    title: 'Managed API Gateway',
    description: 'Route internal app and developer AI calls through the managed gateway. Aegis holds API keys, enforces policies, and logs everything.',
    coverage: 'Internal apps, backend services, governed AI chat',
    effort: 'Low',
  },
  {
    phase: 'Phase 2',
    title: 'Transparent Proxy Mode',
    description: 'Deploy Aegis as a transparent proxy. Corporate proxy redirects IDE traffic (Kiro, Copilot, Cursor) through Aegis. Zero client-side changes.',
    coverage: '+ IDE traffic, developer tools, browser AI usage',
    effort: 'Medium',
  },
  {
    phase: 'Phase 3',
    title: 'Full Endpoint Control',
    description: 'Deploy Shadow AI Guard browser extension. DNS filtering. Network-level enforcement. Complete visibility across all devices and AI tools.',
    coverage: '+ Personal devices, BYOD, shadow AI detection and blocking',
    effort: 'Medium',
  },
];

export function DeploymentPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Deployment Models</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Choose the deployment model that fits your organization's security posture and compliance requirements.
          </p>
        </div>

        {/* Two models */}
        <div className="grid md:grid-cols-2 gap-8 mb-20">
          {/* SaaS */}
          <div className="glass rounded-2xl p-8">
            <div className="w-12 h-12 rounded-xl bg-brand-600/20 flex items-center justify-center mb-6">
              <Cloud className="w-6 h-6 text-brand-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">SaaS</h2>
            <p className="text-slate-400 mb-6">Managed cloud service. Ideal for teams that want to move fast without managing infrastructure.</p>
            <ul className="space-y-3 mb-8">
              {saasFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Link to="/pricing" className="inline-flex items-center gap-2 text-brand-400 hover:text-brand-300 text-sm font-medium">
              View SaaS pricing <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* On-Prem */}
          <div className="glass rounded-2xl p-8 border border-accent-500/30">
            <div className="w-12 h-12 rounded-xl bg-accent-500/20 flex items-center justify-center mb-6">
              <Server className="w-6 h-6 text-accent-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">On-Premises</h2>
            <p className="text-slate-400 mb-6">Deploy entirely within your own infrastructure. Full data sovereignty, no external dependencies.</p>
            <ul className="space-y-3 mb-8">
              {onPremFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Link to="/contact" className="inline-flex items-center gap-2 text-accent-400 hover:text-accent-300 text-sm font-medium">
              Talk to our team <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Rollout phases */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Phased Rollout Strategy</h2>
          <p className="text-slate-400 text-center mb-10">Start with API control and expand coverage incrementally.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {phases.map((p, i) => (
              <div key={p.phase} className="glass rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold">
                    {i + 1}
                  </div>
                  <span className="text-brand-400 text-sm font-medium">{p.phase}</span>
                </div>
                <h3 className="text-white font-semibold mb-2">{p.title}</h3>
                <p className="text-slate-400 text-sm mb-4">{p.description}</p>
                <div className="text-xs text-slate-500">
                  <span className="text-slate-400 font-medium">Coverage:</span> {p.coverage}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  <span className="text-slate-400 font-medium">Implementation effort:</span>{' '}
                  <span className={p.effort === 'Low' ? 'text-accent-400' : p.effort === 'Medium' ? 'text-yellow-400' : 'text-orange-400'}>
                    {p.effort}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
