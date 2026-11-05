import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Pipeline } from '../components/kit/Pipeline';
import type { GatewaySummary } from '../lib/gateway-api';

const summary: GatewaySummary = {
  from: '2026-10-21T00:00:00Z', to: '2026-10-28T00:00:00Z', truncated: false,
  received: 154, stopped: 17, cleaned: 31, delivered: 137,
  sources: [{ name: 'support-bot', count: 100 }, { name: 'billing-api', count: 54 }],
  checks: { policy: { stopped: 17 }, secrets: { active: false, stopped: 0 }, personalData: { cleaned: 31 } },
  providers: [{ name: 'OpenAI', count: 137 }],
  topStopReasons: [{ reason: 'Block confidential keywords', count: 17 }],
  recent: [], shadowAi: { people: 0, visits: 0 },
};

describe('Pipeline', () => {
  it('shows traffic shrinking as checks stop requests', () => {
    render(<MemoryRouter><Pipeline summary={summary} /></MemoryRouter>);
    expect(screen.getByText('154')).toBeInTheDocument();
    expect(screen.getAllByText('137').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('shows the secrets check as turned off when the company switched it off', () => {
    render(<MemoryRouter><Pipeline summary={summary} /></MemoryRouter>);
    expect(screen.getByText('Turned off')).toBeInTheDocument();
  });

  it('shows secrets stopped and removed when the check is on', () => {
    render(<MemoryRouter><Pipeline summary={{ ...summary, checks: { ...summary.checks, secrets: { active: true, stopped: 6, redacted: 2 } } }} /></MemoryRouter>);
    expect(screen.queryByText('Turned off')).toBeNull();
    expect(screen.getByText('credentials in prompts · 2 more removed, then sent')).toBeInTheDocument();
  });

  it('lists sources and providers', () => {
    render(<MemoryRouter><Pipeline summary={summary} /></MemoryRouter>);
    expect(screen.getByText('support-bot')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });
});
