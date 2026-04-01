import { useState } from 'react';
import { Mail, MapPin, Calendar, CheckCircle } from 'lucide-react';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function ContactPage() {
  const [formState, setFormState] = useState<FormState>('idle');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    role: '',
    deploymentInterest: 'saas',
    message: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('submitting');
    try {
      await fetch('http://localhost:3000/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => {
        if (!r.ok) throw new Error('Request failed');
      });
      setFormState('success');
    } catch {
      setFormState('error');
    }
  };

  return (
    <div className="pt-24 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Left */}
          <div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">Let's talk</h1>
            <p className="text-slate-400 text-lg mb-10 leading-relaxed">
              Whether you're evaluating AI governance for the first time or replacing an existing solution, we'd love to show you what Aegis AI can do.
            </p>

            <div className="space-y-6 mb-10">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Book a Demo</h3>
                  <p className="text-slate-400 text-sm">30-minute live walkthrough tailored to your use case.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Email Us</h3>
                  <a href="mailto:hello@aegis-ai.com" className="text-brand-400 hover:text-brand-300 text-sm">
                    hello@aegis-ai.com
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Headquarters</h3>
                  <p className="text-slate-400 text-sm">Calgary, Alberta, Canada</p>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="glass rounded-2xl p-8">
            {formState === 'success' ? (
              <div className="text-center py-12">
                <CheckCircle className="w-12 h-12 text-accent-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Message received</h3>
                <p className="text-slate-400">We'll be in touch within one business day.</p>
              </div>
            ) : formState === 'error' ? (
              <div className="text-center py-12">
                <p className="text-red-400 font-medium mb-2">Something went wrong</p>
                <p className="text-slate-400 text-sm mb-4">Please try again or email us directly.</p>
                <button onClick={() => setFormState('idle')} className="text-brand-400 hover:text-brand-300 text-sm">
                  Try again
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5" htmlFor="firstName">First name</label>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      required
                      value={form.firstName}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5" htmlFor="lastName">Last name</label>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      required
                      value={form.lastName}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5" htmlFor="email">Work email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={handleChange}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="[email]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5" htmlFor="company">Company</label>
                    <input
                      id="company"
                      name="company"
                      type="text"
                      required
                      value={form.company}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                      placeholder="Acme Corp"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5" htmlFor="role">Your role</label>
                    <input
                      id="role"
                      name="role"
                      type="text"
                      value={form.role}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                      placeholder="CTO, CISO, etc."
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5" htmlFor="deploymentInterest">Deployment interest</label>
                  <select
                    id="deploymentInterest"
                    name="deploymentInterest"
                    value={form.deploymentInterest}
                    onChange={handleChange}
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500 transition-colors"
                  >
                    <option value="saas">SaaS</option>
                    <option value="onprem">On-Premises</option>
                    <option value="both">Both — evaluating options</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5" htmlFor="message">Message</label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    value={form.message}
                    onChange={handleChange}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors resize-none"
                    placeholder="Tell us about your use case..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={formState === 'submitting'}
                  className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-semibold transition-all"
                >
                  {formState === 'submitting' ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
