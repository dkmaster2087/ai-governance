/**
 * Animated architecture diagrams. Moving dots are log lines or requests; they are decoration on top of a
 * diagram that reads fine without them, and they are hidden for people who ask for reduced motion.
 * Colours follow the site: ink for normal flow, grey for ignored lines, red only for "stopped".
 */
import { ReactNode } from 'react';

const INK = '#14213D';
const GREY = '#B9C3D6';
const RED = '#C8322A';
const MUTED = '#5A6478';
const LINE = '#D5DAE2';

function Dot({ path, dur, begin, fill, r = 4.5, fade = false, hollow = false, becomesFilledAt }: {
  path: string; dur: number; begin: number; fill: string; r?: number; fade?: boolean; hollow?: boolean; becomesFilledAt?: number;
}) {
  return (
    <circle className="flow-dot" r={r} fill={hollow ? '#fff' : fill} stroke={hollow ? fill : 'none'} strokeWidth={hollow ? 2 : 0} opacity="0">
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" rotate="0">
        <mpath href={`#${path}`} />
      </animateMotion>
      <animate attributeName="opacity" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite"
        values={fade ? '0;1;1;0' : '0;1;1;1;0'} keyTimes={fade ? '0;0.08;0.8;1' : '0;0.06;0.5;0.94;1'} />
      {becomesFilledAt !== undefined && (
        <animate attributeName="fill" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite"
          values={`#fff;#fff;${fill};${fill}`} keyTimes={`0;${becomesFilledAt};${becomesFilledAt + 0.02};1`} />
      )}
    </circle>
  );
}

function Label({ x, y, children, size = 15, weight = 600, fill = INK, anchor = 'start' }: { x: number; y: number; children: ReactNode; size?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end' }) {
  return <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} fontFamily="Archivo, system-ui, sans-serif">{children}</text>;
}

function SourceBox({ y, title, sub }: { y: number; title: string; sub: string }) {
  return (
    <g>
      <rect x="28" y={y} width="236" height="58" rx="10" fill="#fff" stroke={LINE} />
      <Label x={44} y={y + 25}>{title}</Label>
      <Label x={44} y={y + 44} size={12} weight={400} fill={MUTED}>{sub}</Label>
    </g>
  );
}

const SOURCES = [
  { y: 66, title: 'Route 53 DNS query logs', sub: 'which servers look up AI' },
  { y: 134, title: 'Network Firewall logs', sub: 'outgoing connections by name' },
  { y: 202, title: 'CloudTrail', sub: 'Bedrock and SageMaker calls' },
  { y: 318, title: 'Firewalls and proxies', sub: 'Palo Alto, Fortinet, Check Point…' },
  { y: 386, title: 'DNS servers', sub: 'BIND, Windows DNS' },
];
const COLLECTOR_Y = 250;

/** Logs flow into the collector; only AI matches go on to results that stay in the customer's environment. */
export function CollectorFlow() {
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1000 560" className="w-full min-w-[760px] h-auto" role="img"
          aria-label="Log lines from AWS (DNS, firewall, CloudTrail) and from the data centre (firewalls, proxies, DNS servers) flow into the Aegis collector inside your environment. It drops everything that isn't an AI service and passes AI matches on as daily counts to results in your own storage, which build the assessment report. Nothing goes to Aegis unless you share it.">
          <defs>
            {SOURCES.map((s, i) => {
              const sy = s.y + 29;
              return (
                <g key={i}>
                  <path id={`in-${i}`} d={`M264 ${sy} C 360 ${sy}, 360 ${COLLECTOR_Y}, 440 ${COLLECTOR_Y}`} />
                  <path id={`through-${i}`} d={`M264 ${sy} C 360 ${sy}, 360 ${COLLECTOR_Y}, 440 ${COLLECTOR_Y} L 640 ${COLLECTOR_Y} C 700 ${COLLECTOR_Y}, 700 196, 752 196`} />
                </g>
              );
            })}
            <path id="to-report" d="M866 226 L866 290" />
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={GREY} />
            </marker>
          </defs>

          {/* The customer's environment */}
          <rect x="8" y="8" width="984" height="452" rx="16" fill="#F6F7F9" stroke={INK} strokeWidth="2" />
          <Label x={28} y={34} size={12} weight={700} fill={MUTED}>YOUR ENVIRONMENT</Label>
          <Label x={28} y={58} size={11} weight={600} fill={MUTED}>AWS ACCOUNT</Label>
          <Label x={28} y={310} size={11} weight={600} fill={MUTED}>DATA CENTRE AND OFFICES</Label>

          {SOURCES.map((s) => <SourceBox key={s.title} {...s} />)}

          {/* Pipes */}
          {SOURCES.map((s, i) => (
            <use key={i} href={`#in-${i}`} fill="none" stroke={LINE} strokeWidth="2" />
          ))}
          <path d={`M640 ${COLLECTOR_Y} C 700 ${COLLECTOR_Y}, 700 196, 752 196`} fill="none" stroke={LINE} strokeWidth="2" markerEnd="url(#arrow)" />
          <path d="M866 226 L866 290" fill="none" stroke={LINE} strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Collector */}
          <rect x="440" y={COLLECTOR_Y - 66} width="200" height="132" rx="14" fill={INK} />
          <Label x={540} y={COLLECTOR_Y - 32} anchor="middle" fill="#fff" size={16} weight={700}>Aegis collector</Label>
          <Label x={540} y={COLLECTOR_Y - 10} anchor="middle" fill="#D5DCE8" size={12} weight={400}>read-only</Label>
          <Label x={540} y={COLLECTOR_Y + 14} anchor="middle" fill="#D5DCE8" size={12} weight={400}>keeps AI matches only</Label>
          <Label x={540} y={COLLECTOR_Y + 32} anchor="middle" fill="#D5DCE8" size={12} weight={400}>people become codes</Label>
          <Label x={540} y={COLLECTOR_Y + 98} anchor="middle" fill={MUTED} size={12} weight={400}>everything else is dropped here</Label>

          {/* Results and report */}
          <rect x="752" y="166" width="228" height="60" rx="10" fill="#fff" stroke={LINE} />
          <Label x={768} y={192}>Results in your storage</Label>
          <Label x={768} y={211} size={12} weight={400} fill={MUTED}>daily counts, no content</Label>
          <rect x="752" y="290" width="228" height="60" rx="10" fill="#fff" stroke={INK} strokeWidth="2" />
          <Label x={768} y={316}>Assessment report</Label>
          <Label x={768} y={335} size={12} weight={400} fill={MUTED}>your team reads it first</Label>

          {/* Outside: Aegis, only on the customer's say-so */}
          <path d="M866 350 L866 486" fill="none" stroke={GREY} strokeWidth="2" strokeDasharray="5 6" />
          <Label x={878} y={412} size={12} weight={400} fill={MUTED}>only if you</Label>
          <Label x={878} y={428} size={12} weight={400} fill={MUTED}>choose to share</Label>
          <rect x="752" y="486" width="228" height="52" rx="10" fill="#fff" stroke={GREY} strokeDasharray="5 5" />
          <Label x={866} y={517} anchor="middle" fill={MUTED}>Aegis</Label>

          {/* Moving log lines: grey ones stop at the collector; ink ones are AI matches and go through. */}
          {SOURCES.map((_, i) => (
            <g key={i}>
              <Dot path={`in-${i}`} dur={2.6} begin={i * 0.45} fill={GREY} fade />
              <Dot path={`in-${i}`} dur={2.6} begin={i * 0.45 + 1.3} fill={GREY} fade />
              <Dot path={`through-${i}`} dur={4.2} begin={i * 0.8 + 0.6} fill={INK} r={5.5} />
            </g>
          ))}
          <Dot path="to-report" dur={2.4} begin={1.5} fill={INK} r={5} />
        </svg>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-ink inline-block" />A match with a known AI service, kept as a daily count</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-ink-on-dark-muted inline-block" />Any other log line, dropped inside the collector</span>
      </figcaption>
    </figure>
  );
}

const APPS = [
  { y: 46, name: 'support-bot', kind: 'app' },
  { y: 112, name: 'billing-api', kind: 'app' },
  { y: 178, name: 'Cursor (IDE)', kind: 'via proxy' },
  { y: 244, name: 'hr-assistant', kind: 'app' },
];
const LANE_Y = 160;

/** Requests pass the gateway's checks: most are delivered, some stopped, some cleaned of personal data. */
export function GatewayFlow() {
  const checks = [
    { x: 400, name: 'Policy rules', sub: 'stop' },
    { x: 540, name: 'Secrets', sub: 'coming', soon: true },
    { x: 680, name: 'Personal data', sub: 'clean' },
  ];
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1040 400" className="w-full min-w-[760px] h-auto" role="img"
          aria-label="Requests from apps and IDEs enter the Aegis gateway and pass three checks in order. Requests that break a policy rule are stopped and never reach a provider. Requests with personal data have it removed and are then delivered. Everything else is delivered to AI providers such as Amazon Bedrock, OpenAI and Anthropic.">
          <defs>
            {APPS.map((a, i) => {
              const ay = a.y + 26;
              const enter = `M206 ${ay} C 290 ${ay}, 290 ${LANE_Y}, 370 ${LANE_Y}`;
              return (
                <g key={i}>
                  <path id={`g-in-${i}`} d={enter} />
                  <path id={`g-ok-${i}`} d={`${enter} L 830 ${LANE_Y} C 870 ${LANE_Y}, 870 ${100 + i * 40}, 900 ${100 + i * 40}`} />
                  <path id={`g-stop-${i}`} d={`${enter} L 455 ${LANE_Y} L 455 330`} />
                </g>
              );
            })}
          </defs>

          <Label x={28} y={30} size={11} weight={700} fill={MUTED}>COMING IN</Label>
          {APPS.map((a) => (
            <g key={a.name}>
              <rect x="28" y={a.y} width="178" height="52" rx="10" fill="#fff" stroke={LINE} />
              <Label x={44} y={a.y + 23}>{a.name}</Label>
              <Label x={44} y={a.y + 41} size={12} weight={400} fill={MUTED}>{a.kind}</Label>
            </g>
          ))}
          {APPS.map((_, i) => <use key={i} href={`#g-in-${i}`} fill="none" stroke={LINE} strokeWidth="2" />)}

          {/* The gateway */}
          <rect x="370" y={LANE_Y - 92} width="460" height="184" rx="16" fill="#F6F7F9" stroke={INK} strokeWidth="2" />
          <Label x={386} y={LANE_Y - 70} size={12} weight={700} fill={MUTED}>AEGIS GATEWAY</Label>
          <line x1="370" y1={LANE_Y} x2="830" y2={LANE_Y} stroke={LINE} strokeWidth="2" />
          {checks.map((c) => (
            <g key={c.name}>
              <rect x={c.x} y={LANE_Y - 46} width="110" height="92" rx="12" fill={c.soon ? '#fff' : INK} stroke={c.soon ? GREY : 'none'} strokeDasharray={c.soon ? '5 5' : undefined} />
              <Label x={c.x + 55} y={LANE_Y - 4} anchor="middle" fill={c.soon ? MUTED : '#fff'} size={14} weight={700}>{c.name}</Label>
              <Label x={c.x + 55} y={LANE_Y + 18} anchor="middle" fill={c.soon ? MUTED : '#D5DCE8'} size={12} weight={400}>{c.sub}</Label>
            </g>
          ))}
          <Label x={796} y={LANE_Y + 80} anchor="end" size={12} weight={400} fill={MUTED}>every decision recorded as evidence</Label>

          {/* Stopped */}
          <line x1="455" y1={LANE_Y + 46} x2="455" y2="330" stroke={RED} strokeWidth="2.5" />
          <Label x={455} y={356} anchor="middle" fill={RED} size={15} weight={700}>Stopped</Label>
          <Label x={455} y={374} anchor="middle" fill={MUTED} size={12} weight={400}>never reaches a provider</Label>

          {/* Providers */}
          <Label x={900} y={78} size={11} weight={700} fill={MUTED}>DELIVERED TO</Label>
          {['Amazon Bedrock', 'OpenAI', 'Anthropic', 'Azure OpenAI'].map((p, i) => (
            <g key={p}>
              <path d={`M830 ${LANE_Y} C 870 ${LANE_Y}, 870 ${100 + i * 40}, 900 ${100 + i * 40}`} fill="none" stroke={LINE} strokeWidth="2" />
              <Label x={906} y={104 + i * 40} size={13}>{p}</Label>
            </g>
          ))}

          {/* Requests: ink delivered, red stopped at the rules, hollow ones carry personal data and are cleaned. */}
          {APPS.map((_, i) => (
            <g key={i}>
              <Dot path={`g-ok-${i}`} dur={4} begin={i * 0.9} fill={INK} r={5.5} />
              {i % 2 === 0 && <Dot path={`g-stop-${i}`} dur={3} begin={i * 0.9 + 1.6} fill={RED} r={5.5} fade />}
              {i % 2 === 1 && <Dot path={`g-ok-${i}`} dur={4} begin={i * 0.9 + 2} fill={INK} r={6} hollow becomesFilledAt={0.8} />}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-ink inline-block" />Delivered</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-stop inline-block" />Stopped by a rule</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-ink inline-block" />Carries personal data; cleaned, then delivered</span>
      </figcaption>
    </figure>
  );
}
