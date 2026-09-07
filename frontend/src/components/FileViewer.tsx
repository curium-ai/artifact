import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { request } from '../api';
import type { Anchor, ArtifactDetail, CommentThread } from '../types';
import { Button, useToast } from './ui';
import { Notifications } from './Notifications';

interface FileViewerProps { fileName: string; path: string; artifactId: string | null; onBack: () => void }
const channel = 'artifact-review';
type Filter = 'open' | 'resolved' | 'all';
function validAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return ['selector', 'text', 'tag', 'elementId', 'stableId'].every(k => typeof a[k] === 'string')
    && !!a.selector && (a.selector as string).length <= 4096 && (a.text as string).length <= 500
    && !!a.tag && (a.tag as string).length <= 32 && (a.elementId as string).length <= 512 && (a.stableId as string).length <= 512;
}
function submitShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault(); event.currentTarget.form?.requestSubmit();
  }
}

export function FileViewer({ fileName, path, artifactId, onBack }: FileViewerProps) {
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [selected, setSelected] = useState<Anchor | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [mode, setMode] = useState(false);
  const [body, setBody] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [reattaching, setReattaching] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadNodes = useRef(new Map<string, HTMLElement>());
  const deepLink = useRef(new URLSearchParams(location.search).get('thread'));
  const saving = useRef(false);
  const refreshVersion = useRef(0);
  const toast = useToast();
  const send = useCallback((data: Record<string, unknown>) => {
    // The sandbox has an opaque origin. Send only anchor and marker metadata, never comments or identities.
    frame.current?.contentWindow?.postMessage({ channel, ...data }, '*');
  }, []);
  useEffect(() => {
    let alive = true;
    const endpoint = artifactId ? `/api/artifacts/${encodeURIComponent(artifactId)}`
      : `/api/artifact?path=${encodeURIComponent(path.replace(/\/$/, '') + '/' + fileName)}`;
    request<ArtifactDetail>(endpoint).then(a => { if (alive) setArtifact(a); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; refreshVersion.current++; };
  }, [artifactId, fileName, path]);
  const refresh = useCallback(async () => {
    if (!artifact) return;
    const version = ++refreshVersion.current;
    const result = await request<CommentThread[]>(`/api/artifacts/${artifact.id}/threads`);
    if (version === refreshVersion.current) { setThreads(result); setLoaded(true); }
  }, [artifact]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => {
    const update = () => { if (!document.hidden && !saving.current) void refresh().catch(() => {}); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);
  const openThread = useCallback((thread: CommentThread, fromDocument = false) => {
    setActiveThread(thread.id);
    if ((filter === 'open' && thread.resolved) || (filter === 'resolved' && !thread.resolved)) setFilter('all');
    if (!fromDocument) {
      frame.current?.scrollIntoView({ block: 'nearest' });
      send({ type: 'focus', threadId: thread.id, anchor: thread.anchor, sameRevision: thread.revisionId === artifact?.revisionId });
    }
    else requestAnimationFrame(() => {
      const node = threadNodes.current.get(thread.id);
      node?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      node?.querySelector<HTMLButtonElement>('.thread-anchor')?.focus({ preventScroll: true });
    });
  }, [artifact, filter, send]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      const data = event.data;
      if (data.type === 'selected' && mode && !saving.current && validAnchor(data.anchor)) setSelected(data.anchor);
      if (data.type === 'escape') setMode(false);
      if (data.type === 'open-thread') {
        const thread = threads.find(t => t.id === data.threadId);
        if (thread) openThread(thread, true);
      }
      if (data.type === 'checked' && Array.isArray(data.missing)) {
        setMissing(data.missing.filter((id: unknown) => typeof id === 'string' && threads.some(t => t.id === id)));
      }
      if (data.type === 'located' && data.found === false) toast('This section needs reattachment', 'error');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [mode, threads, toast, openThread]);
  useEffect(() => { if (ready) send({ type: 'mode', enabled: mode, locked: busy }); }, [mode, busy, ready, send]);
  useEffect(() => {
    if (ready && artifact) send({ type: 'check', activeThread, threads: threads.map((t, index) => ({
      id: t.id, number: index + 1, anchor: t.anchor, sameRevision: t.revisionId === artifact.revisionId,
      visible: filter === 'all' || (filter === 'resolved') === t.resolved, resolved: t.resolved,
    })) });
  }, [ready, artifact, threads, activeThread, filter, send]);
  useEffect(() => {
    if (!ready || !loaded || !deepLink.current) return;
    const thread = threads.find(t => t.id === deepLink.current);
    deepLink.current = null;
    if (thread) openThread(thread);
  }, [ready, loaded, threads, openThread]);
  useEffect(() => {
    if (mode && selected && !reattaching) composer.current?.focus();
    else if (mode && !selected) frame.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, mode, reattaching]);
  useEffect(() => {
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMode(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const hasDraft = !!body.trim() || Object.values(replies).some(value => value.trim());
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);
  const clearSelection = () => { setSelected(null); setReattaching(null); send({ type: 'clear-selection' }); };
  const act = async (fn: () => Promise<unknown>, success: () => void, message: string) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setStatus('');
    try {
      await fn(); success(); setStatus(message);
      // A successful write must never leave a retryable draft if the subsequent read fails.
      try { await refresh(); } catch { setError('Saved, but comments could not refresh. Use Refresh to reload them.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed. Your draft is still here.');
      requestAnimationFrame(() => {
        const editor = composer.current || threadNodes.current.get(activeThread || '')?.querySelector<HTMLTextAreaElement>('textarea');
        editor?.focus();
      });
    }
    finally { saving.current = false; setBusy(false); }
  };
  const visible = threads.filter(t => filter === 'all' || (filter === 'resolved') === t.resolved);
  const canManage = (t: CommentThread) => artifact?.userId === t.authorId || artifact?.userId === artifact?.ownerId;
  return <div className="viewer">
    <div className="viewer__toolbar">
      <button className="viewer__back" onClick={() => { if (!hasDraft || window.confirm('Leave this review and discard your unsent comments?')) onBack(); }}>← Back</button>
      <span className="viewer__filename">{artifact?.path.split('/').pop() || fileName}</span>
      <div className="viewer__actions">
        <Notifications />
        <Button disabled={!artifact} onClick={async () => {
          try { await navigator.clipboard.writeText(`${location.origin}/a/${artifact!.id}`); toast('Review link copied'); }
          catch { toast('Could not copy link', 'error'); }
        }}>Copy review link</Button>
        <Button variant={mode ? 'primary' : 'secondary'} disabled={!artifact || busy} aria-pressed={mode} onClick={() => setMode(v => !v)}>{mode ? 'Exit comment mode' : 'Comment on section'}</Button>
      </div>
    </div>
    <div className="review-layout">
      <div className="viewer__frame">
        {artifact && <iframe ref={frame} title={fileName} sandbox="allow-scripts"
          src={`/api/artifacts/${artifact.id}/review/${artifact.revisionId}`} onLoad={() => setReady(true)} />}
      </div>
      <aside className="comment-sidebar" aria-label="Comments">
        <div className="comment-panel-header"><div className="comment-heading"><h2>Comments <small>{threads.length}</small></h2><Button disabled={busy} onClick={() => void refresh().then(() => setError('')).catch(e => setError(e.message))}>Refresh</Button></div>
        <div className="comment-filters" role="group" aria-label="Filter comments">{(['open', 'resolved', 'all'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'open' ? 'Open' : value === 'resolved' ? 'Resolved' : 'All'} <span>{threads.filter(t => value === 'all' || (value === 'resolved') === t.resolved).length}</span></button>)}</div></div>
        {error && <p role="alert" className="review-error">{error}</p>}
        <p role="status" className="comment-status">{status}</p>
        {mode && <p className="comment-hint">{reattaching ? `Choose a new section for comment ${threads.findIndex(t => t.id === reattaching) + 1}.` : 'Click any section to comment. Numbered markers open existing discussions.'} <span>Esc exits · ⌘/Ctrl + Enter posts</span></p>}
        {!mode && selected && <Button onClick={() => setMode(true)}>Resume {reattaching ? 'reattachment' : 'draft'}</Button>}
        {mode && selected && artifact && <form className="comment-composer" onSubmit={e => {
          e.preventDefault(); if (!body.trim() || busy || reattaching) return;
          void act(async () => {
            const result = await request<{ threadId: string }>(`/api/artifacts/${artifact.id}/threads`, 'POST', { revisionId: artifact.revisionId, anchor: selected, body });
            setActiveThread(result.threadId); setFilter('open');
          }, () => { setBody(''); clearSelection(); frame.current?.focus(); }, 'Comment posted. Select another section to keep reviewing.');
        }}>
          <div className="anchor-preview"><strong>{reattaching ? `Move comment ${threads.findIndex(t => t.id === reattaching) + 1} to` : 'Commenting on'} · {selected.tag}</strong><p>{selected.text.slice(0, 140) || 'Selected element'}</p></div>
          <Button disabled={busy} onClick={() => send({ type: 'parent' })}>Select containing element</Button>
          {reattaching ? <Button variant="primary" disabled={busy} onClick={() => void act(() => request(`/api/threads/${reattaching}`, 'PATCH', { anchor: selected, revisionId: artifact.revisionId }), clearSelection, 'Thread reattached.')}>Attach thread here</Button> : <>
            <label>New comment<textarea ref={composer} value={body} disabled={busy} onChange={e => setBody(e.target.value)} onKeyDown={submitShortcut} placeholder="What would you like to discuss?" maxLength={10000} required /></label>
            <Button variant="primary" type="submit" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Post comment'}</Button>
          </>}
          <Button disabled={busy} onClick={() => { if (!body.trim() || window.confirm('Discard this unsent comment?')) { setBody(''); clearSelection(); } }}>Cancel</Button>
        </form>}
        {!loaded && !error && <p className="comment-hint">Loading comments…</p>}
        {loaded && !visible.length && <p className="comment-empty">{filter === 'resolved' ? 'No resolved discussions.' : filter === 'open' && threads.length ? 'All caught up. No open discussions.' : 'No comments yet. Select a section to start a discussion.'}</p>}
        {visible.map(t => <section aria-label={`Comment ${threads.indexOf(t) + 1}`} ref={node => { if (node) threadNodes.current.set(t.id, node); else threadNodes.current.delete(t.id); }} className={`comment-thread ${activeThread === t.id ? 'comment-thread--active' : ''}`} key={t.id}>
          <button className="thread-anchor" aria-label={`Show comment ${threads.indexOf(t) + 1} in document: ${t.anchor.text.slice(0, 80) || t.anchor.tag}`} onClick={() => openThread(t)}>
            <span className="thread-number">{threads.indexOf(t) + 1}</span><span className="thread-quote">{t.anchor.text.slice(0, 100) || `Selected ${t.anchor.tag}`}<small>{missing.includes(t.id) ? 'Needs reattachment' : 'Show in document'}{t.resolved ? ' · Resolved' : ''}</small></span>
          </button>
          {t.comments.map(c => <div key={c.id} className="comment"><strong>{c.author}</strong><small><time dateTime={new Date(c.createdAt * 1000).toISOString()}>{new Date(c.createdAt * 1000).toLocaleString()}</time></small><p>{c.body}</p></div>)}
          {activeThread === t.id && <>
            {!t.resolved && <form onSubmit={e => { e.preventDefault(); if (!(replies[t.id] || '').trim() || busy) return; void act(() => request(`/api/threads/${t.id}/replies`, 'POST', { body: replies[t.id] }), () => setReplies(values => ({ ...values, [t.id]: '' })), 'Reply posted.'); }}>
              <label>Reply<textarea value={replies[t.id] || ''} maxLength={10000} disabled={busy} onKeyDown={submitShortcut} onChange={e => setReplies(values => ({ ...values, [t.id]: e.target.value }))} placeholder="Add to the discussion…" required /></label>
              <Button type="submit" disabled={busy || !(replies[t.id] || '').trim()}>Reply</Button>
            </form>}
            {canManage(t) && <Button disabled={busy} onClick={() => void act(() => request(`/api/threads/${t.id}`, 'PATCH', { resolved: !t.resolved }), () => {}, t.resolved ? 'Thread reopened.' : 'Thread resolved. Find it in Resolved.')}>{t.resolved ? 'Reopen thread' : 'Resolve thread'}</Button>}
            {missing.includes(t.id) && canManage(t) && <Button disabled={busy || !!body.trim()} onClick={() => { setReattaching(t.id); setMode(true); setSelected(null); send({ type: 'clear-selection' }); }}>Select a new anchor</Button>}
          </>}
        </section>)}
      </aside>
    </div>
  </div>;
}
