import { useState } from 'react';
import { Container, PageHeader, Panel } from '../components/ui';
import { API_URL } from '../lib/config';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const field = 'min-h-[44px] px-3.5 border border-line-strong rounded-lg bg-white text-ink w-full';

export function ContactPage() {
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', company: '', role: '', deploymentInterest: 'saas', message: '', website: '' });
  const set = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('submitting');
    try {
      const res = await fetch(`${API_URL}/public/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong.');
      }
      setState('success');
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.');
      setState('error');
    }
  };

  return (
    <Container>
      <PageHeader eyebrow="Contact" title="Let’s look at your AI traffic together.">
        Tell us a little about your company and which environments you run: AWS, Azure, Google Cloud, data centres, web gateways. We’ll reply within one business day to scope an AI usage assessment.
      </PageHeader>
      <div className="pb-20 max-w-[720px]">
        {state === 'success' ? (
          <Panel className="p-8">
            <h2 className="m-0 text-2xl font-bold">Thanks, we’ve got it.</h2>
            <p className="m-0 mt-2 text-ink-muted">We’ll be in touch within one business day.</p>
          </Panel>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {/* Left empty by people; bots that fill every field are ignored. */}
            <input name="website" value={form.website} onChange={set} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">First name</span><input name="firstName" required value={form.firstName} onChange={set} className={field} autoComplete="given-name" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Last name</span><input name="lastName" required value={form.lastName} onChange={set} className={field} autoComplete="family-name" /></label>
            </div>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Work email</span><input name="email" type="email" required value={form.email} onChange={set} className={field} autoComplete="email" /></label>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Company</span><input name="company" required value={form.company} onChange={set} className={field} autoComplete="organization" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Your role <span className="font-normal text-ink-muted">(optional)</span></span><input name="role" value={form.role} onChange={set} className={field} autoComplete="organization-title" /></label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Where would you run it?</span>
              <select name="deploymentInterest" value={form.deploymentInterest} onChange={set} className={field}>
                <option value="saas">Probaline Cloud (hosted by you)</option>
                <option value="onprem">On-premises (our servers or cloud account)</option>
                <option value="both">Not sure yet</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Anything we should know? <span className="font-normal text-ink-muted">(optional)</span></span><textarea name="message" rows={4} value={form.message} onChange={set} className={`${field} py-2.5`} /></label>
            {state === 'error' && <p role="alert" className="m-0 text-stop-text font-semibold">{error}</p>}
            <button type="submit" disabled={state === 'submitting'} className="self-start min-h-[48px] px-6 rounded-lg bg-ink text-white font-semibold disabled:opacity-60">
              {state === 'submitting' ? 'Sending…' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </Container>
  );
}
