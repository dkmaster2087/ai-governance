import clsx from 'clsx';
import type { ApiKeySummary } from './api-keys-api';

/**
 * What an API key is for, from its permissions. A key with several permissions belongs to each matching
 * category. Every category has its own colour, a small shape and a name, so it never relies on colour alone.
 */
export type KeyCategory = 'apps' | 'agents' | 'extension';

export const CATEGORIES: Array<{ id: KeyCategory; label: string; short: string; hint: string; scopes: string[] }> = [
  { id: 'apps', label: 'Apps & IDEs', short: 'Apps & IDEs', hint: 'Send AI requests through the gateway, or list models', scopes: ['chat', 'models'] },
  { id: 'agents', label: 'AI agents (MCP)', short: 'AI agents', hint: 'Use the tools on your MCP servers', scopes: ['mcp'] },
  { id: 'extension', label: 'Browser extension', short: 'Extension', hint: 'Report visits to AI tools and read extension settings', scopes: ['shadow_ai:ingest'] },
];

export const categoriesOf = (k: Pick<ApiKeySummary, 'scopes'>): KeyCategory[] =>
  CATEGORIES.filter((c) => c.scopes.some((s) => k.scopes.includes(s))).map((c) => c.id);

const STYLE: Record<KeyCategory, { badge: string; bar: string; dot: string }> = {
  apps: { badge: 'bg-cat-apps-soft text-cat-apps', bar: 'bg-cat-apps', dot: 'text-cat-apps' },
  agents: { badge: 'bg-cat-agents-soft text-cat-agents', bar: 'bg-cat-agents', dot: 'text-cat-agents' },
  extension: { badge: 'bg-cat-extension-soft text-cat-extension', bar: 'bg-cat-extension', dot: 'text-cat-extension' },
};
export const categoryStyle = (c: KeyCategory) => STYLE[c];

/** A small generic shape per category: brackets for apps, a plug for agents, a browser window for the extension. */
export function CategoryGlyph({ category, className }: { category: KeyCategory; className?: string }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className };
  if (category === 'apps') return <svg {...common}><path d="M8 6l-5 6 5 6M16 6l5 6-5 6" /></svg>;
  if (category === 'agents') return <svg {...common}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" /></svg>;
  return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>;
}

export function CategoryBadge({ category, className }: { category: KeyCategory; className?: string }) {
  const c = CATEGORIES.find((x) => x.id === category)!;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md', STYLE[category].badge, className)}>
      <CategoryGlyph category={category} />{c.label}
    </span>
  );
}
