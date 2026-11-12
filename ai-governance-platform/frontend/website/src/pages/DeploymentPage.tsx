import { Link } from 'react-router-dom';
import { ClosingCta, Container, Eyebrow, PageHeader, Panel, Status } from '../components/ui';
import { DeploymentPicture } from '../components/visuals';

export const MODELS: Array<{ name: string; status: 'Available' | 'Coming'; line: string; ours: string[]; theirs: string[]; note?: string }> = [
  { name: 'Cloud', status: 'Available', line: 'We run everything.', ours: ['Gateway', 'Dashboard', 'Evidence'], theirs: [] },
  { name: 'Your infrastructure', status: 'Available', line: 'Everything on your servers. Nothing is sent to us.', ours: [], theirs: ['Gateway', 'Dashboard', 'Evidence'], note: 'One container image with your PostgreSQL: docker compose, Kubernetes (Helm) or AWS (CloudFormation). It checks its license file itself.' },
];

export function DeploymentPage() {
  return (
    <>
      <Container>
        <PageHeader eyebrow="Deployment" title="Run it where your data is allowed to be.">
          The same image in both. Choose who runs it.
        </PageHeader>
        <div className="grid gap-5 pb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {MODELS.map((m) => (
            <Panel key={m.name} className="p-6 flex flex-col gap-4">
              <Status value={m.status} />
              <div>
                <h2 className="m-0 text-2xl font-bold">{m.name}</h2>
                <p className="m-0 mt-1 text-ink-muted">{m.line}</p>
              </div>
              <DeploymentPicture ours={m.ours} theirs={m.theirs} />
              {m.note && <p className="m-0 text-sm text-ink-muted">{m.note}</p>}
            </Panel>
          ))}
        </div>
        <section className="py-14 border-t border-line flex flex-wrap items-center justify-between gap-6">
          <div>
            <Eyebrow className="mb-2">Collectors</Eyebrow>
            <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">The assessment needs none of this installed.</h2>
          </div>
          <Link to="/assessment" className="font-semibold text-ink hover:text-stop no-underline">How the assessment works →</Link>
        </section>
      </Container>
      <ClosingCta title="Not sure which fits? Start with the assessment." />
    </>
  );
}
