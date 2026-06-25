import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as api from './api';

vi.mock('./api', () => ({
  checkAuth: vi.fn(),
  listFiles: vi.fn(),
  getTree: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const checkAuth = api.checkAuth as unknown as ReturnType<typeof vi.fn>;
const listFiles = api.listFiles as unknown as ReturnType<typeof vi.fn>;
const getTree = api.getTree as unknown as ReturnType<typeof vi.fn>;

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

beforeEach(() => {
  checkAuth.mockResolvedValue({ authenticated: true, authMode: 'password' });
  listFiles.mockResolvedValue({ folders: ['docs'], files: [] });
  getTree.mockResolvedValue({ tree: [] });
});

describe('App navigation', () => {
  it('reflects folder navigation in the URL', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );

    const row = await screen.findByRole('button', { name: 'Folder docs' });
    expect(screen.getByTestId('loc').textContent).toBe('/');

    await user.dblClick(row);
    expect(screen.getByTestId('loc').textContent).toBe('/folder/docs');
  });

  it('opens a deep-linked folder URL directly', async () => {
    render(
      <MemoryRouter initialEntries={['/folder/docs']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Folder docs' });
    expect(listFiles).toHaveBeenCalledWith('/docs', expect.anything());
  });
});
