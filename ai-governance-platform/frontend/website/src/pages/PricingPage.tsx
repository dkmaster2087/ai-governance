import { Link } from 'react-router-dom';
import { CheckCircle, X, ArrowRight } from 'lucide-react';

const saasPlans = [
  {
    name: 'Starter',
    price: '$499',
    period: '/month',
    description: 'For small teams exploring AI governance.',
    highlight: false,
    features: [
      'Up to 100K requests/month',
      '3 policy rules',
      'Basic PII masking (regex)',
      'S3 audit logs (30 days)',
      'Amazon Bedrock support',
      'Email support',
    ],
    missing: ['Custom policies', 'Comprehend PII detection', 'Multi-tenant', 'SLA guarantee'],
    cta: 'Start Free Trial',
  },
  {
    name: 'Professional',
    price: '$1,499',
    period: '/month',
    description: 'For growing teams with compliance requirements.',
    highlight: true,
    features: [
      'Up to 1M requests/month',
      'Unlimited policy rules',
      'Comprehend PII detection',
      'S3 audit logs (1 year)',
      'All AI providers',
      'Transparent proxy mode',
      'Cost analytics dashboard',
      'Shadow AI detection',
      'Content scanner',
      'Priority support + SLA',
    ],
    missing: ['On-premises deployment', 'Custom SLA'],
    cta: 'Start Free Trial',
  },
  {
    name: 'Enterprise SaaS',
    price: 'Custom',
    period: '',
    description: 'For large organizations with advanced needs.',
    highlight: false,
    features: [
      'Unlimited requests',
      'Custom policy engine',
      'Full PII + DLP suite',
      'Immutable audit logs (7 years)',
      'Multi-tenant management',
      'All 6 compliance frameworks',
      'Transparent proxy mode',
      'Platform admin dashboard',
      'License key management',
      'Custom integrations',
      'Dedicated CSM',
      '99.9% uptime SLA',
    ],
    missing: [],
    cta: 'Contact Sales',
  },
];

const onPremFeatures = [
  'Deploy in your own AWS account or data center',
  'Full data sovereignty — nothing leaves your environment',
  'Air-gapped deployment option',
  'License key with configurable user count and validity',
  'Choose what to report to SaaS platform (usage, cost, compliance, audit)',
  'Integration with existing IAM, LDAP, Active Directory',
  'Shadow AI Guard browser extension included',
  'Dedicated support and implementation team',
  'Annual licensing with volume discounts',
];

export function PricingPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            SaaS for teams moving fast. On-premises for enterprises that need full control.
          </p>
        </div>

        {/* SaaS Plans */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-300 mb-8 text-center">SaaS Plans</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {saasPlans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 flex flex-col ${
                  plan.highlight
                    ? 'bg-brand-600/20 border-2 border-brand-500 glow'
                    : 'glass'
                }`}
              >
                {plan.highlight && (
                  <div className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-4">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-slate-400 text-sm mb-6">{plan.description}</p>
                <div className="mb-8">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-slate-400">{plan.period}</span>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  {plan.missing.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  to="/contact"
                  className={`w-full py-3 rounded-xl font-semibold text-center transition-all ${
                    plan.highlight
                      ? 'bg-brand-600 hover:bg-brand-500 text-white'
                      : 'glass hover:bg-white/10 text-white'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* On-Premises */}
        <div className="mt-16 glass rounded-3xl p-10">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="text-xs font-semibold text-accent-400 uppercase tracking-widest mb-3">
                On-Premises / Private Cloud
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">
                Full control. Your infrastructure.
              </h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                For enterprises that require complete data sovereignty, air-gapped environments, or have strict regulatory requirements. Deploy Aegis AI entirely within your own AWS account or on-premises data center.
              </p>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all"
              >
                Talk to Sales <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <ul className="space-y-3">
              {onPremFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-slate-300 text-sm">
                  <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* FAQ note */}
        <p className="text-center text-slate-500 text-sm mt-12">
          All plans include a 14-day free trial. No credit card required.{' '}
          <Link to="/contact" className="text-brand-400 hover:text-brand-300">
            Questions? Talk to us.
          </Link>
        </p>
      </div>
    </div>
  );
}
