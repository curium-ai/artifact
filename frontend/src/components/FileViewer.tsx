import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api';
import type { Anchor, ArtifactDetail, CommentThread } from '../types';
import { Button, useToast } from './ui';
import { Notifications } from './Notifications';

interface FileViewerProps { fileName: string; path: string; artifactId: string | null; onBack: () => void }
const channel = 'artifact-review';

function validAnchor(value: unknown): value is Anchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return ['selector', 'text', 'tag', 'elementId', 'stableId'].every(k => typeof a[k] === 'string')
    && (a.selector as string).length <= 4096 && (a.text as string).length <= 500;
}

export function FileViewer({ fileName, path, artifactId, onBack }: FileViewerProps) {
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [selected, setSelected] = useState<Anchor | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(() => new URLSearchParams(location.search).get('thread'));
  const [mode, setMode] = useState(false);
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const toast = useToast();
  const send = useCallback((data: Record<string, unknown>) => {
    // Sandboxed documents have opaque origins. Only selection metadata crosses this boundary.
    frame.current?.contentWindow?.postMessage({ channel, ...data }, '*');
  }, []);
  useEffect(() => {
    let alive = true;
    const endpoint = artifactId ? `/api/artifacts/${encodeURIComponent(artifactId)}`
      : `/api/artifact?path=${encodeURIComponent(path.replace(/\/$/, '') + '/' + fileName)}`;
    request<ArtifactDetail>(endpoint).then(a => { if (alive) setArtifact(a); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [artifactId, fileName, path]);
  const refresh = useCallback(async () => {
    if (artifact) setThreads(await request<CommentThread[]>(`/api/artifacts/${artifact.id}/threads`));
  }, [artifact]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      const data = event.data;
      if (data.type === 'selected' && mode && validAnchor(data.anchor)) setSelected(data.anchor);
      if (data.type === 'checked' && Array.isArray(data.missing)) {
        setMissing(data.missing.filter((id: unknown) => typeof id === 'string' && threads.some(t => t.id === id)));
      }
      if (data.type === 'located' && data.found === false) toast('This section needs reattachment', 'error');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [mode, threads, toast]);
  useEffect(() => { if (ready) send({ type: 'mode', enabled: mode }); }, [mode, ready, send]);
  useEffect(() => {
    if (ready && artifact) send({ type: 'check', threads: threads.map(t => ({ ...t, sameRevision: t.revisionId === artifact.revisionId })) });
  }, [ready, artifact, threads, send]);
  useEffect(() => {
    const thread = threads.find(t => t.id === activeThread);
    if (ready && thread && artifact) send({ type: 'focus', threadId: thread.id, anchor: thread.anchor, sameRevision: thread.revisionId === artifact.revisionId });
  }, [activeThread, ready, threads, artifact, send]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await refresh(); setBody(''); setReply(''); setSelected(null); setMode(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  };
  const active = threads.find(t => t.id === activeThread);
  return <div className="viewer">
    <div className="viewer__toolbar">
      <button className="viewer__back" onClick={onBack}>← Back</button>
      <span className="viewer__filename">{artifact?.path.split('/').pop() || fileName}</span>
      <div className="viewer__actions">
        <Notifications />
        <Button disabled={!artifact} onClick={async () => {
          try { await navigator.clipboard.writeText(`${location.origin}/a/${artifact!.id}`); toast('Review link copied'); }
          catch { toast('Could not copy link', 'error'); }
        }}>Copy review link</Button>
        <Button variant={mode ? 'primary' : 'secondary'} disabled={!artifact} onClick={() => {
          setMode(v => !v); setSelected(null);
        }}>{mode ? 'Exit comment mode' : 'Comment on section'}</Button>
      </div>
    </div>
    <div className="review-layout">
      <div className="viewer__frame">
        {artifact && <iframe ref={frame} title={fileName} sandbox="allow-scripts"
          src={`/api/artifacts/${artifact.id}/review/${artifact.revisionId}`} onLoad={() => setReady(true)} />}
      </div>
      <aside className="comment-sidebar" aria-label="Comments">
        <h2>Comments <small>{threads.length}</small></h2>
        {error && <p role="alert" className="review-error">{error}</p>}
        {mode && <p>Click a section in the document to anchor your comment.</p>}
        {selected && artifact && <form onSubmit={e => { e.preventDefault(); void act(async () => {
          const result = await request<{ threadId: string }>(`/api/artifacts/${artifact.id}/threads`, 'POST',
            { revisionId: artifact.revisionId, anchor: selected, body });
          setActiveThread(result.threadId);
        }); }}>
          <div className="anchor-preview"><strong>{selected.tag}</strong><p>{selected.text.slice(0, 140) || 'Selected element'}</p></div>
          <Button onClick={() => send({ type: 'parent' })}>Select containing element</Button>
          <label>New comment<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={10000} required /></label>
          <Button variant="primary" type="submit" disabled={busy || !body.trim()}>Post comment</Button>
          {active && (artifact.userId === active.authorId || artifact.userId === artifact.ownerId) && <Button disabled={busy} onClick={() => void act(() => request(`/api/threads/${active.id}`, 'PATCH',
            { anchor: selected, revisionId: artifact.revisionId }))}>Reattach selected thread here</Button>}
        </form>}
        {!threads.length && !mode && <p>Select “Comment on section” to start a discussion.</p>}
        {threads.map(t => <section className={`comment-thread ${activeThread === t.id ? 'comment-thread--active' : ''}`} key={t.id}>
          <button className="thread-anchor" onClick={() => { setReply(''); if (activeThread === t.id) send({ type: 'focus', threadId: t.id, anchor: t.anchor, sameRevision: t.revisionId === artifact?.revisionId }); else setActiveThread(t.id); }}>
            <strong>{t.anchor.tag}</strong> {t.anchor.text.slice(0, 80) || 'Selected element'}
            {missing.includes(t.id) && <span className="anchor-missing">Needs reattachment</span>}
            {t.resolved && <span>Resolved</span>}
          </button>
          {t.comments.map(c => <div key={c.id} className="comment">
            <strong>{c.author}</strong><small>{new Date(c.createdAt * 1000).toLocaleString()}</small><p>{c.body}</p>
          </div>)}
          {activeThread === t.id && <>
            {!t.resolved && <form onSubmit={e => { e.preventDefault(); void act(() => request(`/api/threads/${t.id}/replies`, 'POST', { body: reply })); }}>
              <label>Reply<textarea value={reply} maxLength={10000} onChange={e => setReply(e.target.value)} required /></label>
              <Button type="submit" disabled={busy || !reply.trim()}>Reply</Button>
            </form>}
            {(artifact?.userId === t.authorId || artifact?.userId === artifact?.ownerId) && <Button disabled={busy} onClick={() => void act(() => request(`/api/threads/${t.id}`, 'PATCH', { resolved: !t.resolved }))}>
              {t.resolved ? 'Reopen thread' : 'Resolve thread'}
            </Button>}
            {missing.includes(t.id) && <Button onClick={() => setMode(true)}>Select a new anchor</Button>}
          </>}
        </section>)}
      </aside>
    </div>
  </div>;
}
