import { useEffect, useState } from 'react';
import { request } from '../api';
import type { AppNotification } from '../types';

export function Notifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => request<AppNotification[]>('/api/notifications').then(rows => {
      if (alive) { setItems(rows); setError(''); }
    }).catch(e => { if (alive) setError(e.message); });
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { alive = false; clearInterval(interval); };
  }, []);
  return <div className="notification-wrap">
    <button className="btn btn--secondary btn--medium" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      Notifications {items.some(n => !n.read) ? `(${items.filter(n => !n.read).length})` : ''}
    </button>
    {open && <section className="notification-menu" aria-label="Notifications">
      {error && <p role="alert">{error}</p>}
      {!items.length && !error && <p>No notifications yet.</p>}
      {items.map(n => <a className={n.read ? 'notification' : 'notification notification--unread'} key={n.id}
        href={`/browse?artifact=${encodeURIComponent(n.artifactId)}&thread=${encodeURIComponent(n.threadId)}`}
        onClick={() => { void request(`/api/notifications/${n.id}/read`, 'POST').catch(() => {}); }}>
        <strong>{n.actor}</strong><span>{n.body}</span><small>{n.path}</small>
      </a>)}
    </section>}
  </div>;
}
