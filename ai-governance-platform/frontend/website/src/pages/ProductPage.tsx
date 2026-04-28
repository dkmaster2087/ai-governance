import { Link } from 'react-router-dom';
import { Shield, Lock, Eye, Zap, BarChart3, GitBranch, AlertTriangle, Globe, Cpu, Key, Users, DollarSign, ArrowRight, ScanLine, Chrome, Network } from 'lucide-react';

const capabilities = [
  { icon: Shield, title: 'Policy Engine', description: 'Keyword blocking, model restrictions, PII detection, content classification. 6 compliance frameworks built in — NIST AI RMF, SOC 2, GDPR, HIPAA, ISO 42001, PIPEDA.' },
  { icon: Lock, title: 'PII & Data Protection', description: 'Regex + Amazon Comprehend for deep PII detection. Mask, block, or tokenize sensitive data before it reaches any AI model. Response scanning on the way back.' },
  { icon: Eye, title: 'Full Audit Trail', description: 'Every prompt, response, and policy decision logged. Time-period filtering, CSV/PDF export, per-user and per-tenant breakdowns.' },
  { icon: Network, title: 'Transparent Proxy Mode', description: 'Route IDE traffic (Kiro, Copilot, Cursor) through Aegis without any code changes. Supports OpenAI, Anthropic, Cohere, Mistral as passthrough targets.' },
  { icon: Zap, title: 'Multi-Model Routing', description: 'Managed mode with API key storage, or proxy mode with client credentials. Route by cost, policy, or capability across Bedrock, OpenAI, Anthropic.' },
  { icon: BarChart3, title: 'Cost & Usage Analytics', description: 'Per-tenant and per-user cost tracking, model distribution charts, daily cost trends, budget alerts, and top-user breakdowns.' },
  { icon: AlertTriangle, title: 'Shadow AI Detection', description: 'Chrome extension monitors and blocks unauthorized AI tool usage. Per-tenant config, real-time blocking, risk scoring dashboard.' },
  { icon: ScanLine, title: 'Content Scanner', description: 'Upload documents up to 500MB for PII and sensitive content scanning. Text extraction, progress tracking, detailed findings report.' },
  { icon: GitBranch, title: 'Multi-Tenant Architecture', description: 'Full tenant isolation at every layer. SaaS and on-prem deployment modes. License key management with user counts and validity periods.' },
  { icon: Users, title: 'Role-Based Access', description: 'Four roles: Platform Admin, Tenant Admin, Auditor, Chat-Only User. Route guards, dynamic sidebar, per-role dashboards.' },
  { icon: Cpu, title: 'Model Configuration', description: 'Configure models per tenant with max tokens, context windows, provider API keys. Validation against model limits. Status badges and connection testing.' },
  { icon: Globe, title: 'Drop-In Compatible', description: 'OpenAI-compatible API. Point existing apps at Aegis with a URL change. Enterprise proxy mode requires zero client-side changes.' },
];

const integrationModes = [
  {
    title: 'Managed Mode',
    description: 'Aegis holds the API keys and routes to providers. Clients use Aegis as their AI endpoint.',
    flow: 'Client App → Aegis Gateway → Policy Check → PII Mask → AI Provider → Response Scan → Client',
    useCases: ['Internal apps', 'Governed AI chat', 'Backend services'],
  },
  {
    title: 'Proxy Mode',
    description: 'Aegis is transparent. Client credentials pass through. Corporate proxy redirects AI traffic to Aegis.',
    flow: 'IDE / Browser → Corporate Proxy → Aegis Gateway → Policy Check → Audit Log → AI Provider → Client',
    useCases: ['IDE governance (Kiro, Copilot)', 'Browser AI tools', 'Zero client-side changes'],
  },
];

export function ProductPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">The AI Control Plane</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Aegis AI sits between your enterprise and every AI provider. Every request is inspected, governed, and logged — in managed or transparent proxy mode.
          </p>
        </div>

        {/* Integration modes */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {integrationModes.map((mode) => (
            <div key={mode.title} className="glass rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-2">{mode.title}</h3>
              <p className="text-slate-400 text-sm mb-4">{mode.description}</p>
              <div className="font-mono text-xs text-slate-500 bg-white/5 rounded-xl px-4 py-3 mb-4 leading-relaxed">
                {mode.flow}
              </div>
              <div className="flex flex-wrap gap-2">
                {mode.useCases.map((uc) => (
                  <span key={uc} className="text-xs px-2.5 py-1 rounded-full bg-brand-600/20 text-brand-300">{uc}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Capabilities */}
        <h2 className="text-2xl font-bold text-white mb-8 text-center">Platform Capabilities</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {capabilities.map((cap) => (
            <div key={cap.title} className="glass rounded-2xl p-6 hover:bg-white/10 transition-colors group">
              <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center mb-4 group-hover:bg-brand-600/30 transition-colors">
                <cap.icon className="w-5 h-5 text-brand-400" />
              </div>
              <h3 className="text-white font-semibold mb-2">{cap.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>

        {/* Compliance frameworks */}
        <div className="glass rounded-2xl p-8 mb-16">
          <h2 className="text-lg font-semibold text-white mb-6 text-center">Built-In Compliance Frameworks</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {['NIST AI RMF', 'SOC 2', 'GDPR', 'HIPAA', 'ISO 42001', 'PIPEDA'].map((fw) => (
              <div key={fw} className="text-center py-4 px-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <Shield className="w-5 h-5 text-brand-400 mx-auto mb-2" />
                <span className="text-white text-sm font-medium">{fw}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-500 text-xs text-center mt-4">Enable a framework to auto-create linked policies with required controls. Disable to deactivate.</p>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link to="/contact" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all hover:scale-105">
            Book a Demo <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
