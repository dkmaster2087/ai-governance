import { Shield, Lock, Key, FileCheck, Server, Eye } from 'lucide-react';

const pillars = [
  { icon: Lock, title: 'Encryption at Rest & Transit', description: 'All data encrypted with AWS KMS customer-managed keys. TLS 1.3 enforced for all API traffic. S3 object lock for immutable audit logs.' },
  { icon: Key, title: 'Identity & Access Control', description: 'Cognito for SaaS users with MFA. IAM roles for service-to-service. RBAC with admin, auditor, and developer roles.' },
  { icon: Server, title: 'Network Isolation', description: 'All services run in private VPC subnets. VPC endpoints for AWS services — no traffic traverses the public internet. Single NAT gateway with egress control.' },
  { icon: Eye, title: 'Audit & Monitoring', description: 'VPC Flow Logs, CloudTrail, and CloudWatch for full observability. Every API call logged. Alerts on anomalous usage patterns.' },
  { icon: FileCheck, title: 'Compliance Frameworks', description: 'Architecture designed for SOC2 Type II, HIPAA, and PIPEDA (Canada). BAA available for healthcare customers. Data residency controls per tenant.' },
  { icon: Shield, title: 'Vulnerability Management', description: 'Automated dependency scanning in CI/CD. Container image scanning via ECR. Regular penetration testing.' },
];

export function SecurityPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Security & Compliance</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Built for regulated industries. Security isn't a feature — it's the foundation.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {pillars.map((p) => (
            <div key={p.title} className="glass rounded-2xl p-6">
              <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center mb-4">
                <p.icon className="w-5 h-5 text-brand-400" />
              </div>
              <h3 className="text-white font-semibold mb-2">{p.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-3">Privacy-Aware by Design</h2>
          <p className="text-slate-400 max-w-2xl mx-auto text-sm leading-relaxed">
            In compliance with Canadian PIPEDA and provincial privacy laws, Aegis AI is designed to minimize data retention, support prompt anonymization, and give organizations full control over what is logged and for how long. We can help you build a compliant AI monitoring program that respects employee privacy.
          </p>
        </div>
      </div>
    </div>
  );
}
