import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { HomePage } from '../pages/HomePage';
import { PricingPage } from '../pages/PricingPage';
import { DeploymentPage } from '../pages/DeploymentPage';
import { DOCS } from '../docs/content';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('website', () => {
  it('leads with the result on the home page', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The risky ones stop there.');
    expect(screen.getAllByText('Book a demo').length).toBeGreaterThan(0);
  });

  it('has a logo that links home and a sticky navigation bar', () => {
    at('/pricing');
    const logo = screen.getAllByRole('link', { name: 'Aegis home' })[0];
    expect(logo).toHaveAttribute('href', '/');
    expect(logo.closest('header')).toHaveClass('sticky');
  });

  it('only advertises the three compliance packs that exist', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    expect(screen.getByText('SOC 2, HIPAA and EU AI Act controls')).toBeInTheDocument();
    expect(screen.queryByText(/6 compliance frameworks/i)).toBeNull();
    expect(screen.queryByText(/content scanner/i)).toBeNull();
  });

  it('marks on-premises as planned', () => {
    render(<MemoryRouter><DeploymentPage /></MemoryRouter>);
    expect(screen.getByText('On-premises and Kubernetes').closest('div')).toHaveTextContent('Planned');
  });

  it('renders every docs page with a title', () => {
    for (const d of DOCS) {
      const { unmount } = at(d.slug ? `/docs/${d.slug}` : '/docs');
      expect(screen.getByRole('heading', { level: 1, name: d.title })).toBeInTheDocument();
      unmount();
    }
  });

  it('documents that streaming is not supported yet', () => {
    at('/docs/quick-start');
    expect(screen.getByText(/streaming responses/)).toBeInTheDocument();
  });
});
