import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const values = [
  { title: 'Security First', description: 'Every architectural decision starts with security. We eat our own dog food — Aegis AI governs our own AI usage.' },
  { title: 'Transparency', description: 'We believe enterprises deserve to know exactly what their AI is doing. No black boxes.' },
  { title: 'Privacy by Design', description: 'Especially important in Canada. We help organizations monitor AI without violating employee privacy.' },
  { title: 'Enterprise Grade', description: 'Built for the scale, reliability, and compliance requirements of large organizations from day one.' },
];

export function AboutPage() {
  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            We built the platform we wished existed
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed mb-4">
            Enterprises are adopting AI at an unprecedented pace — but the governance tooling hasn't kept up. Security teams are flying blind. Compliance officers are nervous. CISOs are fielding questions they can't answer.
          </p>
          <p className="text-slate-400 text-lg leading-relaxed">
            Aegis AI is the control plane that gives enterprises the visibility and control they need to adopt AI confidently — without slowing down the teams that use it.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {values.map((v) => (
            <div key={v.title} className="glass rounded-2xl p-6">
              <h3 className="text-white font-semibold mb-2">{v.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{v.description}</p>
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-10 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Based in Calgary, Canada</h2>
          <p className="text-slate-400 mb-6 max-w-lg mx-auto">
            We're a team of security engineers, cloud architects, and compliance specialists who've spent years in enterprise software. We understand the problems because we've lived them.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold transition-all"
          >
            Get in touch <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
