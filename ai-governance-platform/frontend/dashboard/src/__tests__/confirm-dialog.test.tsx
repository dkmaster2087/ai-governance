import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ThemeProvider } from '../lib/theme';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    title: 'Delete Policy',
    message: 'Are you sure you want to delete this policy?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and message when open', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('Delete Policy')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this policy?')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    wrap(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText('Delete Policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Are you sure you want to delete this policy?')).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop clicked', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    // The backdrop is the div with bg-black/60 class — it's the first absolute inset-0 inside the dialog
    const backdrop = screen.getByText('Delete Policy').closest('.fixed')!.querySelector('.absolute.inset-0')!;
    fireEvent.click(backdrop);
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows danger styling when confirmVariant="danger"', () => {
    wrap(<ConfirmDialog {...baseProps} confirmVariant="danger" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  it('shows custom confirmLabel', () => {
    wrap(<ConfirmDialog {...baseProps} confirmLabel="Yes, delete it" />);
    expect(screen.getByText('Yes, delete it')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('shows default Confirm label when confirmLabel not provided', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
