import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ThemeProvider } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Toggle } from '../components/ui/Toggle';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';
import { Activity, AlertTriangle } from 'lucide-react';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThemeProvider>{ui}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// ── themeClasses ──────────────────────────────────────────────────────────────

describe('themeClasses', () => {
  it('returns dark classes when isDark is true', () => {
    const t = themeClasses(true);
    expect(t.card).toContain('bg-slate-900');
    expect(t.heading).toBe('text-white');
    expect(t.body).toContain('slate-300');
    expect(t.input).toContain('bg-slate-800');
  });

  it('returns light classes when isDark is false', () => {
    const t = themeClasses(false);
    expect(t.card).toContain('bg-white');
    expect(t.heading).toBe('text-gray-900');
    expect(t.body).toContain('gray-700');
    expect(t.input).toContain('bg-white');
  });

  it('returns all expected keys', () => {
    const t = themeClasses(true);
    const keys = ['card', 'cardInner', 'cardInnerHover', 'overlay', 'input', 'deep',
      'heading', 'body', 'sub', 'muted', 'faint', 'border', 'borderLight',
      'divider', 'hoverRow', 'hoverText', 'btnSecondary', 'track', 'chip', 'chipMuted'];
    keys.forEach((k) => expect(t).toHaveProperty(k));
  });
});

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    title: 'Delete policy?',
    message: 'This action cannot be undone.',
    confirmLabel: 'Delete',
    confirmVariant: 'danger' as const,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders title and message when open', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText('Delete policy?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = wrap(<ConfirmDialog {...baseProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('calls onConfirm when confirm button clicked', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows danger styling for danger variant', () => {
    wrap(<ConfirmDialog {...baseProps} />);
    const btn = screen.getByText('Delete');
    expect(btn.className).toContain('bg-red-600');
  });

  it('shows primary styling for primary variant', () => {
    wrap(<ConfirmDialog {...baseProps} confirmVariant="primary" confirmLabel="Enable" />);
    const btn = screen.getByText('Enable');
    expect(btn.className).toContain('bg-brand-600');
  });
});

// ── Toggle ────────────────────────────────────────────────────────────────────

describe('Toggle', () => {
  it('renders as switch role', () => {
    wrap(<Toggle checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('reflects checked state in aria-checked', () => {
    wrap(<Toggle checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    wrap(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    wrap(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies aria-label', () => {
    wrap(<Toggle checked={false} onChange={vi.fn()} label="Enable PII" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'Enable PII');
  });
});

// ── Badge ─────────────────────────────────────────────────────────────────────

describe('Badge', () => {
  it('renders label text', () => {
    wrap(<Badge label="Active" variant="allow" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies allow variant classes', () => {
    wrap(<Badge label="allow" variant="allow" />);
    expect(screen.getByText('allow').className).toContain('text-accent-400');
  });

  it('applies block variant classes', () => {
    wrap(<Badge label="block" variant="block" />);
    expect(screen.getByText('block').className).toContain('text-red-400');
  });

  it('applies neutral variant with theme-aware classes', () => {
    wrap(<Badge label="neutral" variant="neutral" />);
    const el = screen.getByText('neutral');
    // Should have either slate (dark) or gray (light) classes
    expect(el.className).toMatch(/slate|gray/);
  });
});

// ── EmptyState ────────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders title', () => {
    wrap(<EmptyState icon={AlertTriangle} title="No data" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    wrap(<EmptyState icon={AlertTriangle} title="No data" description="Try again later" />);
    expect(screen.getByText('Try again later')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    wrap(<EmptyState icon={AlertTriangle} title="No data" />);
    expect(screen.queryByText('Try again later')).not.toBeInTheDocument();
  });
});

// ── StatCard ──────────────────────────────────────────────────────────────────

describe('StatCard', () => {
  it('renders label and value', () => {
    wrap(<StatCard label="Total Requests" value="12,847" icon={Activity} />);
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
    expect(screen.getByText('12,847')).toBeInTheDocument();
  });

  it('renders trend badge when provided', () => {
    wrap(<StatCard label="Cost" value="$48.32" icon={Activity} trendValue="+12%" trend="up" />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('renders sub text when provided', () => {
    wrap(<StatCard label="Cost" value="$48.32" icon={Activity} sub="This period" />);
    expect(screen.getByText('This period')).toBeInTheDocument();
  });

  it('does not render trend when not provided', () => {
    wrap(<StatCard label="Test" value="0" icon={Activity} />);
    expect(screen.queryByText('+12%')).not.toBeInTheDocument();
  });
});
