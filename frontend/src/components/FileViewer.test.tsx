import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from './FileViewer';
import { ToastProvider } from './ui';
import { request } from '../api';
import type { CommentThread } from '../types';
vi.mock('../api', () => ({ request: vi.fn() }));
vi.mock('./Notifications', () => ({ Notifications: () => null }));
const anchor = { selector: '#overview', text: 'Overview', tag: 'section', elementId: 'overview', stableId: '' };
const detail = { id: 'artifact', path: 'review.html', revisionId: 'r1', userId: 'me', ownerId: 'me' };
const thread = (id: string): CommentThread => ({ id, revisionId: 'r1', anchor, resolved: false, authorId: 'me', comments: [{ id: 'c' + id, author: 'Reviewer', authorId: 'me', body: 'Existing feedback', createdAt: 1700000000 }] });
let rows: CommentThread[];
let frame: HTMLIFrameElement;
let send: ReturnType<typeof vi.spyOn>;
async function setup(initial: CommentThread[] = []) {
  rows = initial;
  vi.mocked(request).mockImplementation(async (url, method) => {
    if (url === '/api/artifacts/artifact') return detail;
    if (method === 'POST') { const t = thread('new'); rows = [...rows, t]; return { threadId: t.id }; }
    if (method === 'PATCH') { rows = rows.map(t => ({ ...t, resolved: !t.resolved })); return {}; }
    return rows;
  });
  render(<ToastProvider><FileViewer fileName="review.html" path="" artifactId="artifact" onBack={vi.fn()} /></ToastProvider>);
  frame = await screen.findByTitle('review.html') as HTMLIFrameElement;
  send = vi.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.load(frame);
  await screen.findByRole('button', { name: `All ${initial.length}` });
}
function message(data: object, source: Window | null = frame.contentWindow) {
  act(() => window.dispatchEvent(new MessageEvent('message', { source, data: { channel: 'artifact-review', ...data } })));
}
async function select() {
  await userEvent.click(screen.getByRole('button', { name: 'Comment on section' }));
  message({ type: 'selected', anchor });
}
beforeEach(() => { vi.clearAllMocks(); history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('commenting interactions', () => {
  it('copies a stable review URL that includes the commenting interface', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await setup();
    await user.click(screen.getByRole('button', { name: 'Copy review link' }));
    expect(write).toHaveBeenCalledWith(`${location.origin}/a/artifact`);
    await screen.findByText('Review link copied');
  });

  it('focuses selection, posts with keyboard, and remains ready for the next comment', async () => {
    await setup(); await select();
    const editor = screen.getByRole('textbox', { name: 'New comment' });
    expect(document.activeElement).toBe(editor);
    await userEvent.type(editor, 'My feedback');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await screen.findByText('Comment posted. Select another section to keep reviewing.');
    expect(screen.getByRole('button', { name: 'Exit comment mode' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    message({ type: 'selected', anchor: { ...anchor, text: 'Next section' } });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'New comment' }));
  });
  it('keeps failed drafts and prevents duplicate writes while a save is pending', async () => {
    await setup(); await select();
    await userEvent.type(screen.getByRole('textbox', { name: 'New comment' }), 'Keep this draft');
    let rejectSave!: (e: Error) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    fireEvent.submit(screen.getByRole('textbox', { name: 'New comment' }).closest('form')!);
    await act(async () => rejectSave(new Error('Offline')));
    expect(screen.getByRole('alert').textContent).toBe('Offline');
    expect((screen.getByRole('textbox', { name: 'New comment' }) as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(vi.mocked(request).mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
  });
  it('clears a successfully posted draft even when the following refresh fails', async () => {
    await setup(); await select();
    await userEvent.type(screen.getByRole('textbox', { name: 'New comment' }), 'Saved once');
    vi.mocked(request).mockResolvedValueOnce({ threadId: 'new' }).mockRejectedValueOnce(new Error('Offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await screen.findByText(/Saved, but comments could not refresh/);
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Exit comment mode' })).toBeTruthy();
  });
  it('preserves separate reply drafts, and resolution never refocuses the document', async () => {
    await setup([thread('one'), thread('two')]);
    await userEvent.click(screen.getByRole('button', { name: /Show comment 1 in document/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'First draft');
    await userEvent.click(screen.getByRole('button', { name: /Show comment 2 in document/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Second draft');
    await userEvent.click(screen.getByRole('button', { name: /Show comment 1 in document/ }));
    expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('First draft');
    send.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve thread' }));
    await screen.findByText('Thread resolved. Find it in Resolved.');
    expect(send.mock.calls.some(([data]) => (data as { type: string }).type === 'focus')).toBe(false);
  });
  it('ignores unrelated frames and sends no comment content or user identities into the artifact', async () => {
    await setup([thread('one')]);
    await userEvent.click(screen.getByRole('button', { name: 'Comment on section' }));
    message({ type: 'selected', anchor }, window);
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    const checks = send.mock.calls.filter(([data]) => (data as { type: string }).type === 'check');
    expect(checks.length).toBeGreaterThan(0);
    const payload = JSON.stringify(checks);
    expect(payload).not.toContain('Existing feedback'); expect(payload).not.toContain('Reviewer'); expect(payload).not.toContain('authorId');
  });
  it('opens a marker thread without scrolling the document, and Escape preserves the composer draft', async () => {
    await setup([thread('one')]);
    send.mockClear(); message({ type: 'open-thread', threadId: 'one' });
    await screen.findByRole('textbox', { name: 'Reply' });
    expect(send.mock.calls.some(([data]) => (data as { type: string }).type === 'focus')).toBe(false);
    await select(); await userEvent.type(screen.getByRole('textbox', { name: 'New comment' }), 'Resume later');
    fireEvent.keyDown(window, { key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume draft' }));
    expect((screen.getByRole('textbox', { name: 'New comment' }) as HTMLTextAreaElement).value).toBe('Resume later');
  });
  it('opens a resolved deep link once and never scrolls again on refresh', async () => {
    history.replaceState({}, '', '/?thread=one');
    await setup([{ ...thread('one'), resolved: true }]);
    await screen.findByRole('button', { name: 'Reopen thread' });
    expect(screen.getByRole('button', { name: 'All 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(send.mock.calls.filter(([data]) => (data as { type: string }).type === 'focus')).toHaveLength(1);
    send.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(send.mock.calls.some(([data]) => (data as { type: string }).type === 'focus')).toBe(false);
  });
  it('keeps reattachment separate from creating new comments', async () => {
    await setup([thread('one')]);
    await userEvent.click(screen.getByRole('button', { name: /Show comment 1 in document/ }));
    message({ type: 'checked', missing: ['one'] });
    await userEvent.click(screen.getByRole('button', { name: 'Select a new anchor' }));
    message({ type: 'selected', anchor });
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Attach thread here' }));
    await screen.findByText('Thread reattached.');
    expect(vi.mocked(request).mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  });
});
