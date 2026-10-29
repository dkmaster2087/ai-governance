import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Pipeline } from '../components/aegis/Pipeline';
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

  it('shows secrets detection honestly as not active', () => {
    render(<MemoryRouter><Pipeline summary={summary} /></MemoryRouter>);
    expect(screen.getByText('Not active yet')).toBeInTheDocument();
  });

  it('lists sources and providers', () => {
    render(<MemoryRouter><Pipeline summary={summary} /></MemoryRouter>);
    expect(screen.getByText('support-bot')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });
});
