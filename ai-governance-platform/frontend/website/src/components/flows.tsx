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
  { y: 66, title: 'AWS', sub: 'DNS, firewall, Bedrock calls' },
  { y: 134, title: 'Microsoft Azure', sub: 'Firewall, DNS, Azure OpenAI calls' },
  { y: 202, title: 'Google Cloud', sub: 'DNS, web proxy, Vertex AI calls' },
  { y: 318, title: 'Firewalls and proxies', sub: 'Palo Alto, Fortinet, Check Point…' },
  { y: 386, title: 'DNS servers', sub: 'BIND, Windows DNS' },
  { y: 454, title: 'Zscaler, Netskope', sub: 'laptops, in the office or not' },
];
const COLLECTOR_Y = 250;

/** Logs flow into the collector; only AI matches go on to results that stay in the customer's environment. */
export function CollectorFlow() {
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1000 628" className="w-full min-w-[760px] h-auto" role="img"
          aria-label="Log lines from cloud accounts (AWS, Microsoft Azure and Google Cloud: DNS, firewalls and AI model calls), from the data centre (firewalls, proxies, DNS servers) and from Zscaler or Netskope (laptops wherever they are) flow into the Probaline collector inside your environment. It drops everything that isn't an AI service and passes AI matches on as daily counts to results in your own storage, which build the assessment report. Nothing goes to Probaline unless you share it.">
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
          <rect x="8" y="8" width="984" height="520" rx="16" fill="#F6F7F9" stroke={INK} strokeWidth="2" />
          <Label x={28} y={34} size={12} weight={700} fill={MUTED}>YOUR ENVIRONMENT</Label>
          <Label x={28} y={58} size={11} weight={600} fill={MUTED}>CLOUD ACCOUNTS</Label>
          <Label x={28} y={310} size={11} weight={600} fill={MUTED}>NETWORK AND SECURITY TOOLS</Label>

          {SOURCES.map((s) => <SourceBox key={s.title} {...s} />)}

          {/* Pipes */}
          {SOURCES.map((s, i) => (
            <use key={i} href={`#in-${i}`} fill="none" stroke={LINE} strokeWidth="2" />
          ))}
          <path d={`M640 ${COLLECTOR_Y} C 700 ${COLLECTOR_Y}, 700 196, 752 196`} fill="none" stroke={LINE} strokeWidth="2" markerEnd="url(#arrow)" />
          <path d="M866 226 L866 290" fill="none" stroke={LINE} strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Collector */}
          <rect x="440" y={COLLECTOR_Y - 66} width="200" height="132" rx="14" fill={INK} />
          <Label x={540} y={COLLECTOR_Y - 32} anchor="middle" fill="#fff" size={16} weight={700}>Probaline collector</Label>
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

          {/* Outside: Probaline, only on the customer's say-so */}
          <path d="M866 350 L866 554" fill="none" stroke={GREY} strokeWidth="2" strokeDasharray="5 6" />
          <Label x={878} y={446} size={12} weight={400} fill={MUTED}>only if you</Label>
          <Label x={878} y={462} size={12} weight={400} fill={MUTED}>choose to share</Label>
          <rect x="752" y="554" width="228" height="52" rx="10" fill="#fff" stroke={GREY} strokeDasharray="5 5" />
          <Label x={866} y={585} anchor="middle" fill={MUTED}>Probaline</Label>

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
    { x: 400, name: 'Policy rules', sub: 'stop', soon: false },
    { x: 540, name: 'Secrets', sub: 'stop', soon: false },
    { x: 680, name: 'Personal data', sub: 'clean', soon: false },
  ];
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1040 400" className="w-full min-w-[760px] h-auto" role="img"
          aria-label="Requests from apps and IDEs enter the Probaline gateway and pass three checks in order. Requests that break a policy rule, or contain a secret such as an API key or private key, are stopped and never reach a provider. Requests with personal data have it removed and are then delivered. Everything else is delivered to AI providers such as Amazon Bedrock, OpenAI and Anthropic.">
          <defs>
            {APPS.map((a, i) => {
              const ay = a.y + 26;
              const enter = `M206 ${ay} C 290 ${ay}, 290 ${LANE_Y}, 370 ${LANE_Y}`;
              return (
                <g key={i}>
                  <path id={`g-in-${i}`} d={enter} />
                  <path id={`g-ok-${i}`} d={`${enter} L 830 ${LANE_Y} C 870 ${LANE_Y}, 870 ${100 + i * 40}, 900 ${100 + i * 40}`} />
                  <path id={`g-stop-${i}`} d={`${enter} L 455 ${LANE_Y} L 455 330`} />
                  <path id={`g-secret-${i}`} d={`${enter} L 595 ${LANE_Y} L 595 330`} />
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
          <Label x={386} y={LANE_Y - 70} size={12} weight={700} fill={MUTED}>PROBALINE GATEWAY</Label>
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
          <line x1="595" y1={LANE_Y + 46} x2="595" y2="330" stroke={RED} strokeWidth="2.5" />
          <line x1="455" y1="330" x2="595" y2="330" stroke={RED} strokeWidth="2.5" />
          <Label x={525} y={356} anchor="middle" fill={RED} size={15} weight={700}>Stopped</Label>
          <Label x={525} y={374} anchor="middle" fill={MUTED} size={12} weight={400}>never reaches a provider</Label>

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
              {i % 2 === 1 && <Dot path={`g-secret-${i}`} dur={3.4} begin={i * 0.9 + 0.4} fill={RED} r={5.5} fade />}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-ink inline-block" />Delivered</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-stop inline-block" />Stopped by a rule, or for a secret such as an API key</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-ink inline-block" />Carries personal data; cleaned, then delivered</span>
      </figcaption>
    </figure>
  );
}

// ── Incoming: AI agents reaching company systems through MCP ─────────────────────────────────────────

const AGENTS = [
  { y: 46, name: 'Claude', kind: 'person, signed in' },
  { y: 112, name: 'Cursor, Copilot', kind: 'person, signed in' },
  { y: 178, name: 'ChatGPT', kind: 'person, signed in' },
  { y: 244, name: 'Your own agent', kind: 'API key' },
];
const APIS = [
  { y: 124, name: 'HR API' },
  { y: 160, name: 'Finance API' },
  { y: 196, name: 'Ticketing' },
  { y: 232, name: 'On-prem API', sub: 'through a connector' },
];
const REQ_Y = 140;
const RET_Y = 262;

/**
 * Tool calls from agents pass sign-in, the argument checks and, for writes, an approval before Probaline calls
 * the company's API with its own credential; the answer comes back through the result check.
 */
export function McpFlow() {
  const checks = [
    { x: 390, name: 'Sign-in', sub: 'who, which tools' },
    { x: 530, name: 'Arguments', sub: 'schema, secrets, rules' },
    { x: 670, name: 'Approval', sub: 'writes wait' },
  ];
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1090 440" className="w-full min-w-[760px] h-auto" role="img"
          aria-label="AI agents such as Claude, Cursor and ChatGPT, or your own agent with an API key, call tools on a Probaline MCP server. Each call passes sign-in (only people and keys allowed on that server, and only the tools their groups may use), then the argument checks (the tool's schema, secrets and your company rules), then, for tools that change data, a person's approval. Calls that fail sign-in or the argument checks, or whose approval is refused, are stopped and never reach your API. Allowed calls go to your API with Probaline's own credential and a signed statement of who asked, directly or through a connector inside your network. The answer comes back through the result check, where personal data is removed, text that tries to instruct the agent is flagged, and the size is capped. Every call is recorded as a case file.">
          <defs>
            {AGENTS.map((a, i) => {
              const ay = a.y + 20;
              const enter = `M206 ${ay} C 290 ${ay}, 290 ${REQ_Y}, 370 ${REQ_Y}`;
              const api = APIS[i];
              return (
                <g key={i}>
                  <path id={`m-in-${i}`} d={enter} />
                  <path id={`m-ok-${i}`} d={`${enter} L 830 ${REQ_Y} C 865 ${REQ_Y}, 865 ${api.y}, 900 ${api.y}`} />
                  <path id={`m-who-${i}`} d={`${enter} L 450 ${REQ_Y} L 450 380`} />
                  <path id={`m-args-${i}`} d={`${enter} L 590 ${REQ_Y} L 590 380`} />
                  <path id={`m-back-${i}`} d={`M900 ${api.y + 8} C 865 ${api.y + 8}, 865 ${RET_Y}, 830 ${RET_Y} L 370 ${RET_Y} C 290 ${RET_Y}, 290 ${a.y + 36}, 206 ${a.y + 36}`} />
                </g>
              );
            })}
          </defs>

          <Label x={28} y={30} size={11} weight={700} fill={MUTED}>AI AGENTS</Label>
          {AGENTS.map((a) => (
            <g key={a.name}>
              <rect x="28" y={a.y} width="178" height="52" rx="10" fill="#fff" stroke={LINE} />
              <Label x={44} y={a.y + 23}>{a.name}</Label>
              <Label x={44} y={a.y + 41} size={12} weight={400} fill={MUTED}>{a.kind}</Label>
            </g>
          ))}
          {AGENTS.map((_, i) => <use key={`i${i}`} href={`#m-in-${i}`} fill="none" stroke={LINE} strokeWidth="2" />)}
          {AGENTS.map((a, i) => (
            <path key={`b${i}`} d={`M370 ${RET_Y} C 290 ${RET_Y}, 290 ${a.y + 36}, 206 ${a.y + 36}`} fill="none" stroke={LINE} strokeWidth="2" strokeDasharray="4 4" />
          ))}

          {/* The gateway */}
          <rect x="370" y="60" width="460" height="270" rx="16" fill="#F6F7F9" stroke={INK} strokeWidth="2" />
          <Label x={386} y={82} size={12} weight={700} fill={MUTED}>PROBALINE GATEWAY · MCP SERVER</Label>
          <line x1="370" y1={REQ_Y} x2="830" y2={REQ_Y} stroke={LINE} strokeWidth="2" />
          <line x1="370" y1={RET_Y} x2="830" y2={RET_Y} stroke={LINE} strokeWidth="2" strokeDasharray="4 4" />
          {checks.map((c) => (
            <g key={c.name}>
              <rect x={c.x} y={REQ_Y - 40} width="120" height="80" rx="12" fill={INK} />
              <Label x={c.x + 60} y={REQ_Y - 2} anchor="middle" fill="#fff" size={14} weight={700}>{c.name}</Label>
              <Label x={c.x + 60} y={REQ_Y + 18} anchor="middle" fill="#D5DCE8" size={12} weight={400}>{c.sub}</Label>
            </g>
          ))}
          {/* The answer's way back */}
          <rect x="640" y={RET_Y - 30} width="160" height="60" rx="12" fill="#fff" stroke={INK} strokeWidth="2" />
          <Label x={720} y={RET_Y - 6} anchor="middle" size={14} weight={700}>Result</Label>
          <Label x={720} y={RET_Y + 13} anchor="middle" size={11} weight={400} fill={MUTED}>personal data, instructions, size</Label>
          <Label x={386} y={RET_Y - 12} size={12} weight={400} fill={MUTED}>answer back to the agent</Label>
          <Label x={814} y={318} anchor="end" size={12} weight={400} fill={MUTED}>every call recorded as a case file</Label>

          {/* Stopped */}
          <line x1="450" y1={REQ_Y + 40} x2="450" y2="380" stroke={RED} strokeWidth="2.5" />
          <line x1="590" y1={REQ_Y + 40} x2="590" y2="380" stroke={RED} strokeWidth="2.5" />
          <line x1="730" y1={REQ_Y + 40} x2="730" y2={RET_Y - 30} stroke={RED} strokeWidth="2.5" strokeDasharray="3 4" />
          <line x1="450" y1="380" x2="590" y2="380" stroke={RED} strokeWidth="2.5" />
          <Label x={520} y={406} anchor="middle" fill={RED} size={15} weight={700}>Stopped</Label>
          <Label x={520} y={424} anchor="middle" fill={MUTED} size={12} weight={400}>never reaches your API</Label>
          <Label x={738} y={REQ_Y + 66} size={11} weight={400} fill={RED}>refused</Label>

          {/* Your APIs */}
          <Label x={900} y={78} size={11} weight={700} fill={MUTED}>YOUR APIS</Label>
          <Label x={900} y={93} size={11} weight={400} fill={MUTED}>called with Probaline’s</Label>
          <Label x={900} y={106} size={11} weight={400} fill={MUTED}>credential + who asked</Label>
          {APIS.map((p) => (
            <g key={p.name}>
              <path d={`M830 ${REQ_Y} C 865 ${REQ_Y}, 865 ${p.y}, 900 ${p.y}`} fill="none" stroke={LINE} strokeWidth="2" />
              <path d={`M900 ${p.y + 8} C 865 ${p.y + 8}, 865 ${RET_Y}, 830 ${RET_Y}`} fill="none" stroke={LINE} strokeWidth="2" strokeDasharray="4 4" />
              <Label x={906} y={p.y + 5} size={13}>{p.name}</Label>
              {p.sub && <Label x={906} y={p.y + 21} size={11} weight={400} fill={MUTED}>{p.sub}</Label>}
            </g>
          ))}

          {/* A write waiting for a person */}
          <circle className="flow-dot" cx="730" cy={REQ_Y - 54} r="7" fill="#fff" stroke={INK} strokeWidth="2">
            <animate attributeName="opacity" dur="2s" repeatCount="indefinite" values="0.25;1;0.25" />
          </circle>
          <Label x={744} y={REQ_Y - 50} size={11} weight={400} fill={MUTED}>waiting for a person</Label>

          {/* Calls: ink go through, red are stopped; answers come back hollow (personal data) and leave the result check cleaned. */}
          {AGENTS.map((_, i) => (
            <g key={i}>
              <Dot path={`m-ok-${i}`} dur={4} begin={i * 1.1} fill={INK} r={5.5} />
              <Dot path={`m-back-${i}`} dur={4.4} begin={i * 1.1 + 2.2} fill={INK} r={6} hollow becomesFilledAt={0.32} />
              {i % 2 === 0 && <Dot path={`m-args-${i}`} dur={3.2} begin={i * 1.1 + 1.4} fill={RED} r={5.5} fade />}
              {i === 1 && <Dot path={`m-who-${i}`} dur={3} begin={2.6} fill={RED} r={5.5} fade />}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-ink inline-block" />Tool call allowed through to your API</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-stop inline-block" />Stopped: not allowed on this server, a secret or rule in the arguments, or approval refused</span>
        <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-ink inline-block" />Answer with personal data; removed on the way back</span>
      </figcaption>
    </figure>
  );
}
