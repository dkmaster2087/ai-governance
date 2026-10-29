import { useSearchParams } from 'react-router-dom';

/** Where the browser extension sends people when it blocks an AI tool. Public: no sign-in needed. */
export function BlockedPage() {
  const [params] = useSearchParams();
  const domain = params.get('domain');
  return (
    <div className="min-h-full bg-canvas text-ink font-sans flex items-center justify-center p-6">
      <main className="max-w-[560px] w-full bg-white border border-line rounded-[14px] p-8 flex flex-col gap-4">
        <span className="flex items-center gap-2.5 font-extrabold text-[15px] tracking-[0.06em] uppercase">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
          </svg>
          Aegis
        </span>
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
          {domain ? <><span className="font-mono text-[26px]">{domain}</span> isn’t approved</> : 'This AI tool isn’t approved'} by your company.
        </h1>
        <p className="m-0 text-ink-muted text-[15px]">
          Your organization routes AI use through approved tools so that confidential information and personal data stay
          protected. Use one of your company’s approved AI tools instead, or ask your security team if you need access to this one.
        </p>
      </main>
    </div>
  );
}
