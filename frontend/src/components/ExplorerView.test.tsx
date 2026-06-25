import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ExplorerView } from './ExplorerView';

function makeProps(overrides: Partial<Parameters<typeof ExplorerView>[0]> = {}) {
  return {
    currentPath: '/',
    folders: ['docs'],
    files: [],
    tree: [],
    status: 'ready' as const,
    onNavigate: vi.fn(),
    onOpenFile: vi.fn(),
    onAction: vi.fn(),
    onMove: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
}

describe('ExplorerView folder interaction', () => {
  it('opens a folder on double-click, not single-click', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ExplorerView {...props} />);

    const row = screen.getByRole('button', { name: 'Folder docs' });

    await user.click(row);
    expect(props.onNavigate).not.toHaveBeenCalled(); // single click only selects

    await user.dblClick(row);
    expect(props.onNavigate).toHaveBeenCalledWith('/docs');
  });

  it('shows a recoverable not-found state', async () => {
    const user = userEvent.setup();
    const props = makeProps({ status: 'not-found', folders: [], currentPath: '/gone' });
    render(<ExplorerView {...props} />);

    expect(screen.getByText('Folder not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/');
  });

  it('renders skeleton rows while loading', () => {
    const props = makeProps({ status: 'loading', folders: [] });
    const { container } = render(<ExplorerView {...props} />);
    expect(container.querySelectorAll('.explorer__row--skeleton').length).toBeGreaterThan(0);
  });
});
