import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDirectory } from './useDirectory';
import * as api from '../api';

vi.mock('../api', () => ({
  listFiles: vi.fn(),
  getTree: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const listFiles = api.listFiles as unknown as ReturnType<typeof vi.fn>;
const getTree = api.getTree as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  listFiles.mockReset();
  getTree.mockReset();
  getTree.mockResolvedValue({ tree: [] });
});

describe('useDirectory', () => {
  it('discards a stale response from an earlier navigation', async () => {
    const a = deferred<{ folders: string[]; files: [] }>();
    const b = deferred<{ folders: string[]; files: [] }>();
    listFiles.mockImplementation((path: string) => (path === '/a' ? a.promise : b.promise));

    const { result, rerender } = renderHook(
      ({ path }) => useDirectory(path, true),
      { initialProps: { path: '/a' } },
    );
    expect(result.current.status).toBe('loading');

    // Navigate to /b before /a resolves.
    rerender({ path: '/b' });

    // /b (the latest navigation) resolves first.
    await act(async () => { b.resolve({ folders: ['B'], files: [] }); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.folders).toEqual(['B']);

    // The slower /a response arrives later and must be ignored.
    await act(async () => { a.resolve({ folders: ['A'], files: [] }); });
    expect(result.current.folders).toEqual(['B']);
  });

  it('surfaces a 404 as a not-found status', async () => {
    listFiles.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    const { result } = renderHook(() => useDirectory('/gone', true));
    await waitFor(() => expect(result.current.status).toBe('not-found'));
  });

  it('does not load while disabled', () => {
    renderHook(() => useDirectory('/a', false));
    expect(listFiles).not.toHaveBeenCalled();
  });
});
