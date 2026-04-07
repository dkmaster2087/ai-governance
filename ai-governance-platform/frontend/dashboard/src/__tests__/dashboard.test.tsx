import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { Toggle } from '../components/ui/Toggle';
import { EmptyState } from '../components/ui/EmptyState';
import { ThemeProvider } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { Activity, Inbox } from 'lucide-react';
import { vi } from 'vitest';

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
});

describe('Badge', () => {
  it('renders allow badge', () => {
    wrap(<Badge label="allow" variant="allow" />);
    expect(screen.getByText('allow')).toBeInTheDocument();
  });

  it('renders block badge', () => {
    wrap(<Badge label="block" variant="block" />);
    expect(screen.getByText('block')).toBeInTheDocument();
  });
});

describe('Toggle', () => {
  it('renders with correct role and aria-checked', () => {
    wrap(<Toggle checked={false} onChange={() => {}} label="Test toggle" />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with toggled value on click', () => {
    const onChange = vi.fn();
    wrap(<Toggle checked={false} onChange={onChange} label="Test toggle" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    wrap(<Toggle checked={false} onChange={onChange} disabled label="Disabled toggle" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reflects checked=true in aria-checked', () => {
    wrap(<Toggle checked={true} onChange={() => {}} label="On toggle" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('is disabled when disabled prop is true', () => {
    wrap(<Toggle checked={false} onChange={() => {}} disabled label="Disabled" />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

describe('EmptyState', () => {
  it('renders title', () => {
    wrap(<EmptyState icon={Inbox} title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    wrap(<EmptyState icon={Inbox} title="Empty" description="Try adding something" />);
    expect(screen.getByText('Try adding something')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    wrap(<EmptyState icon={Inbox} title="Empty" />);
    expect(screen.queryByText('Try adding something')).not.toBeInTheDocument();
  });
});

describe('themeClasses', () => {
  it('returns dark classes when isDark is true', () => {
    const t = themeClasses(true);
    expect(t.card).toContain('bg-[#111827]');
    expect(t.heading).toContain('text-white');
    expect(t.input).toContain('bg-white');
    expect(t.btnSecondary).toContain('bg-white');
  });

  it('returns light classes when isDark is false', () => {
    const t = themeClasses(false);
    expect(t.card).toContain('bg-white');
    expect(t.heading).toContain('text-gray-900');
    expect(t.input).toContain('bg-white');
    expect(t.btnSecondary).toContain('bg-gray-100');
  });

  it('includes all expected keys', () => {
    const t = themeClasses(true);
    const expectedKeys = [
      'card', 'cardInner', 'cardInnerHover', 'overlay', 'input', 'deep',
      'heading', 'body', 'sub', 'muted', 'faint', 'border', 'borderLight',
      'divider', 'hoverRow', 'hoverText', 'btnSecondary', 'track', 'chip', 'chipMuted',
    ];
    expectedKeys.forEach((key) => {
      expect(t).toHaveProperty(key);
    });
  });
});
