import { Link, NavLink, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Container } from '../components/ui';
import { DOCS } from '../docs/content';

export function DocsPage() {
  const { slug = '' } = useParams();
  const index = DOCS.findIndex((d) => d.slug === slug);
  const page = DOCS[index];
  const next = DOCS[index + 1];

  return (
    <Container className="py-12 flex flex-wrap gap-12 items-start">
      <nav aria-label="Docs" className="flex-[1_1_200px] max-w-full md:max-w-[240px] md:sticky md:top-24 flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted mb-2">Docs</span>
        {DOCS.map((d) => (
          <NavLink key={d.slug} to={d.slug ? `/docs/${d.slug}` : '/docs'} end
            className={({ isActive }) => clsx('min-h-[36px] flex items-center px-3 rounded-lg no-underline', isActive ? 'bg-ink-tint font-semibold text-ink' : 'text-ink-muted hover:text-ink')}>
            {d.title}
          </NavLink>
        ))}
      </nav>
      <article className="flex-[999_1_560px] min-w-0 max-w-[760px]">
        {page ? (
          <>
            <h1 className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.025em]">{page.title}</h1>
            <p className="m-0 mt-3 text-lg text-ink-muted">{page.summary}</p>
            <div className="mt-6">{page.body}</div>
            {next && (
              <Link to={`/docs/${next.slug}`} className="mt-14 flex flex-col gap-1 p-5 border border-line rounded-[14px] no-underline text-ink hover:border-ink-faint">
                <span className="text-xs text-ink-muted">Next</span>
                <span className="font-semibold text-lg">{next.title} →</span>
              </Link>
            )}
          </>
        ) : (
          <>
            <h1 className="m-0 text-[36px] font-bold">Page not found</h1>
            <p className="mt-3 text-ink-muted"><Link to="/docs" className="font-semibold text-ink">Back to the docs</Link></p>
          </>
        )}
      </article>
    </Container>
  );
}
