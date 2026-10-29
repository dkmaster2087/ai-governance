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
}));

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CompliancePage /></MemoryRouter></QueryClientProvider>);
};

const pack = (framework: string, name: string, status: 'enabled' | 'partial' | 'disabled') => ({
  framework, name, version: '1.0', description: `${name} controls`, status, passedControls: status === 'disabled' ? 0 : 3, totalControls: 5,
  controls: [
    { controlId: `${framework}-1`, title: 'Access control', severity: 'critical', automatable: true },
    { controlId: `${framework}-2`, title: 'Risk assessment', severity: 'medium', automatable: false },
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

  it('lists controls and which need a manual review', async () => {
    vi.mocked(api.fetchComplianceStatus).mockResolvedValue([pack('soc2', 'SOC 2', 'enabled')]);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /Show 2 controls/ }));
    expect(screen.getByText('Access control')).toBeInTheDocument();
    expect(screen.getByText('Manual review')).toBeInTheDocument();
  });
});
