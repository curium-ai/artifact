(() => {
  if (window.parent === window) return;
  const parentOrigin = new URL(document.referrer || location.href).origin;
  let enabled = false, selected = null, overlay;
  const send = data => parent.postMessage({ channel: 'artifact-review', ...data }, parentOrigin);
  const quote = value => CSS.escape(value);
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const usable = el => el instanceof HTMLElement && !['HTML', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName) && el !== overlay;
  function selector(el) {
    if (el.id && document.querySelectorAll('#' + quote(el.id)).length === 1) return '#' + quote(el.id);
    const parts = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const siblings = Array.from(node.parentElement?.children || []).filter(s => s.tagName === node.tagName);
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return 'body > ' + parts.join(' > ');
  }
  function anchor(el) {
    return { selector: selector(el), text: text(el), tag: el.tagName.toLowerCase(), elementId: el.id || '', stableId: el.getAttribute('data-artifact-id') || '' };
  }
  function highlight(el) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #f54e00', background: '#f54e0010', boxSizing: 'border-box' });
      document.documentElement.appendChild(overlay);
    }
    if (!el) { overlay.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function find(a, sameRevision) {
    if (!a || typeof a.selector !== 'string' || a.selector.length > 4096) return null;
    if (!sameRevision && !a.stableId && !a.elementId) return null;
    try {
      const query = a.stableId ? '[data-artifact-id="' + quote(a.stableId) + '"]' : a.elementId ? '#' + quote(a.elementId) : a.selector;
      const matches = document.querySelectorAll(query);
      if (matches.length !== 1) return null;
      const el = matches[0];
      return usable(el) && el.tagName.toLowerCase() === a.tag && text(el) === a.text ? el : null;
    } catch { return null; }
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'artifact-review') return;
    const data = event.data;
    if (data.type === 'mode') { enabled = data.enabled === true; if (!enabled) { selected = null; highlight(null); } }
    if (data.type === 'parent' && selected && usable(selected.parentElement)) {
      selected = selected.parentElement; highlight(selected); send({ type: 'selected', anchor: anchor(selected) });
    }
    if (data.type === 'focus') {
      const el = find(data.anchor, data.sameRevision === true);
      send({ type: 'located', threadId: data.threadId, found: !!el });
      if (el) { selected = el; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); highlight(el); }
    }
    if (data.type === 'check' && Array.isArray(data.threads)) {
      send({ type: 'checked', missing: data.threads.filter(t => !find(t.anchor, t.sameRevision === true)).map(t => t.id) });
    }
  });
  addEventListener('pointermove', event => { if (enabled && !selected && usable(event.target)) highlight(event.target); }, true);
  addEventListener('click', event => {
    if (!enabled || !usable(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation(); selected = event.target;
    highlight(selected); send({ type: 'selected', anchor: anchor(selected) });
  }, true);
  addEventListener('scroll', () => { if (selected) highlight(selected); }, true);
  addEventListener('resize', () => { if (selected) highlight(selected); });
})();
