import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CompliancePage } from '../pages/CompliancePage';
import * as api from '../lib/compliance-api';

vi.mock('../lib/compliance-api', () => ({
  fetchComplianceStatus: vi.fn(),
  enableFramework: vi.fn(),
  disableFramework: vi.fn(),
  assessFramework: vi.fn(),
  syncFramework: vi.fn(async () => ({})),
}));

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CompliancePage /></MemoryRouter></QueryClientProvider>);
};

const pack = (framework: string, name: string, status: 'enabled' | 'partial' | 'disabled') => ({
  framework, name, version: '1.0', description: `${name} controls`, status, passedControls: status === 'disabled' ? 0 : 3, totalControls: 5,
  controls: [
    { controlId: `${framework}-1`, title: 'Access control', description: 'd1', severity: 'critical', automatable: true, ...(status !== 'disabled' ? { state: 'platform', met: true, note: 'Every request needs a key.' } : {}) },
    { controlId: `${framework}-2`, title: 'Approved providers', description: 'd2', severity: 'high', automatable: true, ...(status !== 'disabled' ? { state: 'needs_action', met: false, note: 'Add the models covered by your BAA.' } : {}) },
    { controlId: `${framework}-3`, title: 'Content marking', description: 'd3', severity: 'medium', automatable: false, ...(status !== 'disabled' ? { state: 'gap', met: false, note: 'Not built yet.' } : {}) },
  ],
});

describe('CompliancePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leads with which frameworks are on', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('soc2', 'SOC 2', 'enabled'), pack('hipaa', 'HIPAA', 'disabled'), pack('eu-ai-act', 'EU AI Act', 'partial')]);
    wrap();
    expect(await screen.findByText('SOC 2 and EU AI Act are on.')).toBeInTheDocument();
    expect(screen.getAllByText(/3 of 5/)).toHaveLength(2);
  });

  it('says so when nothing is on', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('hipaa', 'HIPAA', 'disabled')]);
    wrap();
    expect(await screen.findByText('No compliance frameworks are on.')).toBeInTheDocument();
  });

  it('turns a framework on', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('hipaa', 'HIPAA', 'disabled')]);
    vi.mocked(api.enableFramework).mockResolvedValue({ framework: 'hipaa', status: 'enabled' });
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: 'HIPAA off' }));
    await waitFor(() => expect(api.enableFramework).toHaveBeenCalledWith('hipaa'));
  });

  it('asks before turning a framework off', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('soc2', 'SOC 2', 'enabled')]);
    vi.mocked(api.disableFramework).mockResolvedValue({});
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: 'SOC 2 on' }));
    expect(api.disableFramework).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.disableFramework).toHaveBeenCalledWith('soc2'));
  });

  it('shows the error instead of pretending it worked', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('hipaa', 'HIPAA', 'disabled')]);
    vi.mocked(api.enableFramework).mockRejectedValue({ response: { data: { message: 'Policy engine unavailable' } } });
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: 'HIPAA off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Policy engine unavailable');
  });

  it('says for each control how it is covered, and what to do about the rest', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('hipaa', 'HIPAA', 'partial')]);
    wrap();
    expect(await screen.findByText(/need your action/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show 3 controls/ }));
    expect(screen.getByText('Built into Probaline')).toBeInTheDocument();
    expect(screen.getByText('Needs your action')).toBeInTheDocument();
    expect(screen.getByText('Add the models covered by your BAA.')).toBeInTheDocument();
    expect(screen.getByText('Not covered yet')).toBeInTheDocument();
  });

  it('offers to update rules made by an earlier version', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([{ ...pack('hipaa', 'HIPAA', 'partial'), rulesOutdated: true }]);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Update rules' }));
    await waitFor(() => expect(api.syncFramework).toHaveBeenCalledWith('hipaa'));
  });
});
