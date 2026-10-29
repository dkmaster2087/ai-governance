import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { RulesResponse } from '../lib/rules-api';

const data: RulesResponse = {
  from: '', to: '', failMode: 'closed', cleaned: 31, piiTypes: ['EMAIL', 'SSN'],
  rules: [
    { ruleId: 'r_kw', policyId: 'p1', policyName: 'Default', type: 'keyword_block', action: 'block', description: 'Block confidential keywords',
      config: { keywords: ['confidential', 'top secret'] }, enabled: true, policyEnabled: true, effect: 'stops', stopped: 25, flagged: 0 },
    { ruleId: 'r_flag', policyId: 'p2', policyName: 'SOC 2', framework: 'soc2', type: 'pii_detection', action: 'mask', description: 'Detect PII',
      config: {}, enabled: true, policyEnabled: true, effect: 'flags', stopped: 0, flagged: 12 },
    { ruleId: 'r_audit', policyId: 'p2', policyName: 'SOC 2', framework: 'soc2', type: 'audit_logging', action: 'allow', description: 'Log every request',
      config: {}, enabled: true, policyEnabled: true, effect: 'not_enforced', stopped: 0, flagged: 0 },
  ],
};
const changeRule = vi.fn(async (..._args: unknown[]) => ({}));
const addRule = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('../lib/rules-api', async (orig) => ({
  ...(await orig<typeof import('../lib/rules-api')>()),
  fetchRules: vi.fn(async () => data),
  changeRule: (...a: unknown[]) => changeRule(...a),
  addRule: (...a: unknown[]) => addRule(...a),
  deleteRule: vi.fn(async () => ({})),
  setFailMode: vi.fn(async () => ({})),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' }, isAdmin: true }) }));

import { RulesPage } from '../pages/RulesPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><RulesPage /></MemoryRouter>
  </QueryClientProvider>
);

describe('Rules page', () => {
  beforeEach(() => { changeRule.mockClear(); addRule.mockClear(); });

  it('counts only rules that can stop a request in the headline', async () => {
    renderPage();
    expect(await screen.findByText('Every request is checked against 1 rule that can stop it.')).toBeInTheDocument();
  });

  it('writes rules as sentences with what they did', async () => {
    renderPage();
    expect(await screen.findByText('confidential, top secret')).toBeInTheDocument();
    expect(screen.getByText('25 stopped this week')).toBeInTheDocument();
    expect(screen.getByText('Flagged 12 times this week · doesn’t stop requests')).toBeInTheDocument();
  });

  it('separates compliance controls the gateway doesn’t check', async () => {
    renderPage();
    expect(await screen.findByText('1 compliance control isn’t checked by the gateway')).toBeInTheDocument();
  });

  it('turns a rule off', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Block confidential keywords: on' }));
    await waitFor(() => expect(changeRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'r_kw' }), { enabled: false }));
  });

  it('adds a keyword rule', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a rule' }));
    const form = screen.getByRole('region', { name: 'New rule' });
    fireEvent.change(within(form).getByLabelText('Stop prompts that mention'), { target: { value: 'phoenix, atlas' } });
    fireEvent.change(within(form).getByLabelText('Name shown when it stops a request'), { target: { value: 'Stop codenames' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(addRule).toHaveBeenCalled());
    expect(addRule.mock.calls[0][0]).toEqual({ type: 'keyword_block', description: 'Stop codenames', values: ['phoenix', 'atlas'] });
  });

  it('doesn’t offer delete for compliance-framework rules', async () => {
    renderPage();
    const card = (await screen.findByText('Detect PII')).closest('article')!;
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
