import { Shield, Lock, Eye, Zap, BarChart3, GitBranch, AlertTriangle, Globe } from 'lucide-react';

const capabilities = [
  { icon: Shield, title: 'Policy Engine', description: 'Keyword blocking, model restrictions, data classification rules, region enforcement. Evaluated in real time on every request.' },
  { icon: Lock, title: 'PII & Data Protection', description: 'Regex + Amazon Comprehend for deep PII detection. Mask, block, or tokenize sensitive data before it reaches any AI model.' },
  { icon: Eye, title: 'Audit & Compliance', description: 'Immutable S3 logs encrypted with KMS. Query with Athena. Export for SOC2, HIPAA, and internal compliance reviews.' },
  { icon: Zap, title: 'Multi-Model Routing', description: 'Normalize requests across Bedrock, OpenAI, Anthropic. Route by cost, policy, or capability. Automatic fallback handling.' },
  { icon: BarChart3, title: 'Usage Analytics', description: 'Per-tenant cost tracking, model distribution, violation trends. Real-time CloudWatch dashboards.' },
  { icon: AlertTriangle, title: 'Shadow AI Detection', description: 'Identify employees using AI outside approved channels. Surface risk to CISOs before it becomes a breach.' },
  { icon: GitBranch, title: 'Multi-Tenant', description: 'Full tenant isolation at every layer — DynamoDB, S3, IAM. SaaS-ready from day one.' },
  { icon: Globe, title: 'Drop-In Compatible', description: 'OpenAI-compatible API. Point your existing apps at Aegis AI with a single URL change.' },
];

export function ProductPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">The AI Control Plane</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Aegis AI sits between your enterprise and every AI provider. Every request is inspected, governed, and logged — transparently.
          </p>
        </div>

        {/* Architecture flow */}
        <div className="glass rounded-2xl p-8 mb-16">
          <h2 className="text-lg font-semibold text-white mb-6 text-center">Request Flow</h2>
          <div className="font-mono text-sm text-slate-400 text-center leading-loose">
            <span className="text-white">Client App</span>
            {' → '}
            <span className="text-brand-400">API Gateway</span>
            {' → '}
            <span className="text-brand-400">Policy Engine</span>
            {' → '}
            <span className="text-accent-400">PII Masking</span>
            {' → '}
            <span className="text-white">AI Provider</span>
            {' → '}
            <span className="text-accent-400">Response Filter</span>
            {' → '}
            <span className="text-white">Client</span>
            <br />
            <span className="text-slate-600 text-xs">Every step logged to S3 · Encrypted with KMS · Queryable via Athena</span>
          </div>
        </div>

        {/* Capabilities */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
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
      </div>
    </div>
  );
}
