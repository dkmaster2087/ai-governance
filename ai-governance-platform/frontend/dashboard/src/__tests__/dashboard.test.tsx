import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { Activity } from 'lucide-react';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
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
