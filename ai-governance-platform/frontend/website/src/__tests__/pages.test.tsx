import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { PricingPage } from '../pages/PricingPage';
import { DeploymentPage } from '../pages/DeploymentPage';
import { AssessmentPage } from '../pages/AssessmentPage';
import { HowItWorksPage } from '../pages/HowItWorksPage';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('website', () => {
  it('leads with compliance and audit, then the phases, and asks for an assessment', () => {
    at('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Prove how your company uses AI');
    expect(screen.getByRole('heading', { name: 'Every AI decision, on the record.' })).toBeInTheDocument();
    for (const gw of ['LiteLLM', 'Portkey', 'Kong AI Gateway']) expect(screen.getByRole('heading', { name: gw })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Prove how your company uses AI');
    expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
  });

  it('has a compliance and audit page with honest control status', () => {
    at('/compliance');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The evidence for how your company uses AI');
    for (const state of ['Enforced by a rule', 'Built into Probaline', 'Needs your action', 'Not covered yet']) expect(screen.getByText(state)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Compliance' }).length).toBeGreaterThan(0);
  });

  it('sends the old product page to the gateway page', () => {
    at('/product');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One gateway, three checks');
  });

  it('offers MCP servers as a fourth way in, available like IDEs; browsers stay beta', () => {
    at('/gateway');
    const card = screen.getByRole('heading', { name: 'AI agents (MCP)' }).closest('[class*="p-6"]')!;
    expect(within(card as HTMLElement).getByText('Available')).toBeInTheDocument();
    const ide = screen.getByRole('heading', { name: 'Developers’ IDEs' }).closest('[class*="p-6"]')!;
    expect(within(ide as HTMLElement).getByText('Available')).toBeInTheDocument();
    const browsers = screen.getByRole('heading', { name: 'Employees’ browsers' }).closest('[class*="p-6"]')!;
    expect(within(browsers as HTMLElement).getByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Give agents your APIs/ })).toBeInTheDocument();
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('People sign in with their company account')).toBeInTheDocument();
  });

  it('shows secrets as a live gateway check', () => {
    at('/gateway');
    expect(screen.getByRole('img', { name: /contain a secret such as an API key/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /A pasted key is stopped/ })).toBeInTheDocument();
  });

  it('marks enforcement as beta, not available', () => {
    render(<MemoryRouter><HowItWorksPage /></MemoryRouter>);
    const lock = screen.getByText('Lock the other paths, report-only first').closest('li')!;
    expect(within(lock).getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Coming')).toBeNull();
  });

  it('shows every assessment source with whether it exists today', () => {
    render(<MemoryRouter><AssessmentPage /></MemoryRouter>);
    // The name can also appear in the diagram; the tile is the one in the gallery list.
    const tile = (name: string) => screen.getAllByText(name).map((e) => e.closest('li')).find(Boolean)!;
    expect(within(tile('AWS')).getByText('Available')).toBeInTheDocument();
    expect(within(tile('Palo Alto Networks')).getByText('Available')).toBeInTheDocument();
    for (const beta of ['Zscaler', 'Netskope', 'Microsoft Azure', 'Google Cloud', 'Microsoft 365', 'Google Workspace', 'Okta', 'Microsoft Entra']) {
      expect(within(tile(beta)).getByText('Beta')).toBeInTheDocument();
    }
    expect(screen.getByRole('img', { name: /Nothing goes to Probaline unless you share it/ })).toBeInTheDocument();
  });

  it('has one plan at $2,000 a month, with the three compliance packs that exist', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    expect(screen.getByText('$2,000')).toBeInTheDocument();
    expect(screen.queryByText('Starter')).toBeNull();
    expect(screen.queryByText('Custom')).toBeNull();
    expect(screen.getByText('SOC 2, HIPAA and EU AI Act controls')).toBeInTheDocument();
    expect(screen.queryByText(/6 compliance frameworks/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'AI usage assessment' })).toBeInTheDocument();
  });

  it('offers cloud and on-premises only, both available', () => {
    render(<MemoryRouter><DeploymentPage /></MemoryRouter>);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(expect.arrayContaining(['Cloud', 'On-premises']));
    expect(screen.queryByRole('heading', { name: 'Self-hosted' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'On-premises' }).closest('[class*="p-6"]')).toHaveTextContent('Available');
    expect(screen.getByText(/docker compose, Kubernetes \(Helm\) or AWS/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hybrid' })).toBeNull();
  });
});
