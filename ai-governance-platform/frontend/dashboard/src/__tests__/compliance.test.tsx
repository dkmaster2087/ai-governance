import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ControlDetailDrawer } from '../components/compliance/ControlDetailDrawer';
import { CustomPolicyBuilder } from '../components/compliance/CustomPolicyBuilder';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

describe('ControlDetailDrawer', () => {
  const baseProps = {
    controlId: 'SOC2-P3.1',
    controlTitle: 'Sensitive Data in AI Prompts',
    severity: 'critical',
    framework: 'SOC 2 Type II',
    onClose: vi.fn(),
    onCopyToPolicy: vi.fn(),
  };

  it('renders control title and ID', () => {
    wrap(<ControlDetailDrawer {...baseProps} />);
    expect(screen.getByText('Sensitive Data in AI Prompts')).toBeInTheDocument();
    expect(screen.getByText('SOC2-P3.1')).toBeInTheDocument();
  });

  it('shows blocked examples for SOC2-P3.1', () => {
    wrap(<ControlDetailDrawer {...baseProps} />);
    expect(screen.getByText(/Prompts that would be blocked/i)).toBeInTheDocument();
  });

  it('shows allowed examples', () => {
    wrap(<ControlDetailDrawer {...baseProps} />);
    expect(screen.getByText(/Prompts that would pass/i)).toBeInTheDocument();
  });

  it('calls onCopyToPolicy when button clicked', () => {
    wrap(<ControlDetailDrawer {...baseProps} />);
    fireEvent.click(screen.getByText(/Copy to Custom Policy/i));
    expect(baseProps.onCopyToPolicy).toHaveBeenCalledWith('SOC2-P3.1');
  });

  it('calls onClose when backdrop clicked', () => {
    wrap(<ControlDetailDrawer {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('shows fallback message for unknown control', () => {
    wrap(<ControlDetailDrawer {...baseProps} controlId="UNKNOWN-999" />);
    expect(screen.getByText(/not yet available/i)).toBeInTheDocument();
  });
});

describe('CustomPolicyBuilder', () => {
  const baseProps = {
    preloadedControlIds: [],
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  it('renders policy name input', () => {
    wrap(<CustomPolicyBuilder {...baseProps} />);
    expect(screen.getByLabelText(/Policy name/i)).toBeInTheDocument();
  });

  it('shows preloaded control count when controls provided', () => {
    wrap(<CustomPolicyBuilder {...baseProps} preloadedControlIds={['SOC2-P3.1', 'GDPR-ART25']} />);
    expect(screen.getByText(/2 controls? pre-loaded/i)).toBeInTheDocument();
  });

  it('save button is disabled when name is empty', () => {
    wrap(<CustomPolicyBuilder {...baseProps} />);
    const saveBtn = screen.getByRole('button', { name: /Save Policy/i });
    expect(saveBtn).toBeDisabled();
  });

  it('shows add rule button', () => {
    wrap(<CustomPolicyBuilder {...baseProps} />);
    expect(screen.getByText(/Add new rule/i)).toBeInTheDocument();
  });

  it('opens rule type selector when Add new rule clicked', () => {
    wrap(<CustomPolicyBuilder {...baseProps} />);
    fireEvent.click(screen.getByText(/Add new rule/i));
    expect(screen.getByText('Keyword Block')).toBeInTheDocument();
    expect(screen.getByText('PII Detection')).toBeInTheDocument();
    expect(screen.getByText('Model Restriction')).toBeInTheDocument();
  });
});
