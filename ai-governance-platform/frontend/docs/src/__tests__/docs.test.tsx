import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { DOCS } from '../docs/content';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('docs site', () => {
  it('opens on the overview', () => {
    at('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('renders every page with a title', () => {
    for (const d of DOCS) {
      const { unmount } = at(d.slug ? `/docs/${d.slug}` : '/docs');
      expect(screen.getByRole('heading', { level: 1, name: d.title })).toBeInTheDocument();
      unmount();
    }
  });

  it('documents the collectors', () => {
    at('/docs/collectors');
    expect(screen.getByText(/Nothing is sent to Aegis/)).toBeInTheDocument();
  });
});
