import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { PricingPage } from '../pages/PricingPage';
import { ContactPage } from '../pages/ContactPage';
import { DeploymentPage } from '../pages/DeploymentPage';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('HomePage', () => {
  it('renders hero headline', () => {
    wrap(<HomePage />);
    expect(screen.getByText(/AI Governance for the/i)).toBeInTheDocument();
  });

  it('renders Book a Demo CTA', () => {
    wrap(<HomePage />);
    expect(screen.getAllByText(/Book a Demo/i).length).toBeGreaterThan(0);
  });

  it('renders stats section', () => {
    wrap(<HomePage />);
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });
});

describe('PricingPage', () => {
  it('renders all three SaaS plans', () => {
    wrap(<PricingPage />);
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Enterprise SaaS')).toBeInTheDocument();
  });

  it('renders on-premises section', () => {
    wrap(<PricingPage />);
    expect(screen.getByText(/On-Premises \/ Private Cloud/i)).toBeInTheDocument();
  });
});

describe('ContactPage', () => {
  it('renders contact form', () => {
    wrap(<ContactPage />);
    expect(screen.getByLabelText(/Work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Company/i)).toBeInTheDocument();
  });

  it('renders send button', () => {
    wrap(<ContactPage />);
    expect(screen.getByRole('button', { name: /Send Message/i })).toBeInTheDocument();
  });
});

describe('DeploymentPage', () => {
  it('renders SaaS and On-Premises options', () => {
    wrap(<DeploymentPage />);
    expect(screen.getByText('SaaS')).toBeInTheDocument();
    expect(screen.getByText('On-Premises')).toBeInTheDocument();
  });

  it('renders 3 rollout phases', () => {
    wrap(<DeploymentPage />);
    expect(screen.getByText('Phase 1')).toBeInTheDocument();
    expect(screen.getByText('Phase 2')).toBeInTheDocument();
    expect(screen.getByText('Phase 3')).toBeInTheDocument();
  });
});
