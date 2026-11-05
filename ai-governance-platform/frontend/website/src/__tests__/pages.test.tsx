import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { PricingPage } from '../pages/PricingPage';
import { DeploymentPage } from '../pages/DeploymentPage';
import { AssessmentPage } from '../pages/AssessmentPage';
import { HowItWorksPage } from '../pages/HowItWorksPage';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('website', () => {
  it('leads with finding AI use, then controlling it, and asks for an assessment', () => {
    at('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find every AI request your company makes');
    expect(screen.getAllByText(/Book an (AI usage )?assessment/).length).toBeGreaterThan(1);
    for (const phase of ['Inspect', 'Protect', 'Enforce and prove']) expect(screen.getAllByRole('heading', { name: phase }).length).toBeGreaterThan(0);
  });

  it('has a logo that links home and a sticky navigation bar', () => {
    at('/pricing');
    const logo = screen.getAllByRole('link', { name: 'Probaline home' })[0];
    expect(logo).toHaveAttribute('href', '/');
    expect(logo.closest('header')).toHaveClass('sticky');
  });

  it('keeps the technical docs off the sales site', () => {
    at('/docs/quick-start');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find every AI request');
    expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
  });

  it('sends the old product page to the gateway page', () => {
    at('/product');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One gateway, three checks');
  });

  it('shows secrets as a live gateway check', () => {
    at('/gateway');
    expect(screen.getByRole('img', { name: /contain a secret such as an API key/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /A pasted key is stopped/ })).toBeInTheDocument();
  });

  it('marks enforcement as coming, not available', () => {
    render(<MemoryRouter><HowItWorksPage /></MemoryRouter>);
    const lock = screen.getByText('Lock the other paths, report-only first').closest('li')!;
    expect(within(lock).getByText('Coming')).toBeInTheDocument();
  });

  it('shows every assessment source with whether it exists today', () => {
    render(<MemoryRouter><AssessmentPage /></MemoryRouter>);
    const tile = (name: string) => screen.getAllByText(name)[0].closest('li')!;
    expect(within(tile('AWS')).getByText('Available')).toBeInTheDocument();
    expect(within(tile('Palo Alto Networks')).getByText('Available')).toBeInTheDocument();
    for (const coming of ['Microsoft Azure', 'Google Cloud', 'Zscaler', 'Netskope', 'Microsoft 365']) {
      expect(within(tile(coming)).getByText('Coming')).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: /Nothing goes to Probaline unless you share it/ })).toBeInTheDocument();
  });

  it('only advertises the three compliance packs that exist', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    expect(screen.getByText('SOC 2, HIPAA and EU AI Act controls')).toBeInTheDocument();
    expect(screen.queryByText(/6 compliance frameworks/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'AI usage assessment' })).toBeInTheDocument();
  });

  it('marks hybrid as coming and on-premises as planned', () => {
    render(<MemoryRouter><DeploymentPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Hybrid' }).closest('[class*="p-6"]')).toHaveTextContent('Coming');
    expect(screen.getByText('On-premises and Kubernetes: planned')).toBeInTheDocument();
  });
});
