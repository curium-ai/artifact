(() => {
  if (window.parent === window) return;
  const parentOrigin = new URL(document.referrer || location.href).origin;
  let enabled = false, locked = false, selected = null, hovered = null, located = null;
  let host, root, outline, timer, scheduled = false, markers = [], activeThread = null, navigating = false, focusRequest = 0;
  const send = data => parent.postMessage({ channel: 'artifact-review', ...data }, parentOrigin);
  const quote = value => CSS.escape(value);
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const text = el => normalize(el.textContent);
  const legacyText = el => normalize(el.innerText || el.textContent);
  const hidden = el => !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible';
  const usable = el => el instanceof HTMLElement && !['HTML', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName) && el !== host && !host?.contains(el);
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
    const elementId = el.id && document.querySelectorAll('#' + quote(el.id)).length === 1 ? el.id : '';
    const stable = el.getAttribute('data-artifact-id');
    const stableId = stable && document.querySelectorAll('[data-artifact-id="' + quote(stable) + '"]').length === 1 ? stable : '';
    return { selector: selector(el), text: text(el), tag: el.tagName.toLowerCase(), elementId, stableId };
  }
  function mount() {
    if (host) return;
    host = document.createElement('div');
    // Keep annotations outside the author's DOM and CSS, including anchor text and nth-of-type selectors.
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .outline {position:fixed;pointer-events:none;box-sizing:border-box;border:1px solid #758c87;border-radius:3px;background:transparent;}
      .outline.selecting {border:1.5px solid #28776a;background:#28776a08;}
      button {all:initial;box-sizing:border-box;position:fixed;pointer-events:auto;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 3px;border:1px solid #b7c9c4;background:#fff;color:#245b50;box-shadow:0 1px 5px #142e2720;font:600 12px/1 system-ui,sans-serif;cursor:pointer;}
      button:hover,button.active {background:#245b50;color:#fff;border-color:#245b50;}
      button:focus-visible {outline:2px solid #245b50;outline-offset:3px;}
      button.resolved {color:#68736f;background:#f4f6f5;border-color:#ccd4d1;}
      button[hidden],.outline[hidden] {display:none;}
    `;
    outline = document.createElement('div'); outline.className = 'outline'; outline.hidden = true; outline.setAttribute('aria-hidden', 'true');
    root.append(style, outline);
  }
  function find(a, sameRevision, deferHidden = false) {
    if (!a || typeof a.selector !== 'string' || a.selector.length > 4096) return null;
    if (!sameRevision && !a.stableId && !a.elementId) return null;
    try {
      const query = a.stableId ? '[data-artifact-id="' + quote(a.stableId) + '"]' : a.elementId ? '#' + quote(a.elementId) : a.selector;
      const matches = document.querySelectorAll(query);
      if (matches.length !== 1) return null;
      const el = matches[0];
      return usable(el) && el.tagName.toLowerCase() === a.tag && (text(el) === a.text || legacyText(el) === a.text || (deferHidden && sameRevision && hidden(el))) ? el : null;
    } catch { return null; }
  }
  // Resolve only local, declaratively associated controls. Never evaluate author
  // scripts, replay arbitrary clicks, or force display styles (which breaks tab state).
  const controlSelector = 'button, [role="tab"], a[href^="#"]';
  function controls(panel, buttons = Array.from(document.querySelectorAll(controlSelector))) {
    const candidates = buttons.filter(button => {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.closest('form')) return false;
      if (button.tagName === 'A' && !button.getAttribute('href')?.startsWith('#')) return false;
      if (panel.id) {
        if ((button.getAttribute('aria-controls') || '').split(/\s+/).includes(panel.id)) return true;
        if (panel.getAttribute('role') === 'tabpanel' && button.id && (panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(button.id)) return true;
        if (['data-artifact-target', 'data-target', 'data-bs-target', 'href'].some(attr => button.getAttribute(attr) === '#' + panel.id)) return true;
        if (button.dataset.tab === panel.id) return true;
        // Common generated reports: data-select="1" switches a panel id="case-1".
        const choice = button.dataset.select;
        if (choice && panel.id.endsWith('-' + choice) && panel.parentElement &&
            Array.from(panel.parentElement.children).filter(sibling => sibling.id.startsWith(panel.id.slice(0, -choice.length))).length > 1) return true;
      }
      if (panel.hasAttribute('data-view') && button.dataset.mode === panel.dataset.view) {
        // Scope repeated view names to their nearest shared group.
        let group = panel.parentElement;
        while (group && group !== document.body && !group.contains(button)) group = group.parentElement;
        return group && group !== document.body && group.querySelectorAll('[data-view="' + quote(panel.dataset.view) + '"]').length === 1;
      }
      return false;
    });
    return candidates.length === 1 ? candidates : [];
  }
  function navigationControl(target) {
    const button = target.closest(controlSelector);
    if (!button) return false;
    const buttons = Array.from(document.querySelectorAll(controlSelector));
    return Array.from(document.querySelectorAll('[id], [data-view]')).some(panel => controls(panel, buttons)[0] === button);
  }
  async function focus(data) {
    const request = ++focusRequest;
    clearTimeout(timer); located = null; redraw();
    let el = find(data.anchor, data.sameRevision === true, true);
    if (el && hidden(el)) {
      const ancestors = [];
      for (let node = el; node && node !== document.body; node = node.parentElement) ancestors.unshift(node);
      for (const panel of ancestors) {
        if (request !== focusRequest) return;
        if (panel.tagName === 'DETAILS' && !panel.open) panel.open = true;
        const button = controls(panel)[0];
        if (button && hidden(panel) && !hidden(button)) {
          navigating = true;
          try { button.click(); } finally { navigating = false; }
          // Give author handlers and layout a bounded opportunity to reveal content.
          for (let attempt = 0; hidden(panel) && attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25));
            if (request !== focusRequest) return;
          }
        }
      }
    }
    if (request !== focusRequest) return;
    // A hidden old anchor is provisional: verify its rendered text once revealed.
    const candidate = el;
    el = find(data.anchor, data.sameRevision === true);
    const unavailable = candidate && hidden(candidate);
    send({ type: 'located', threadId: data.threadId, found: !!el && !hidden(el), reason: unavailable ? 'hidden' : 'missing' });
    if (el && !hidden(el)) {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); showLocation(el);
    }
    refreshMarkers();
  }
  function refreshMarkers() {
    for (const marker of markers) marker.el = find(marker.anchor, marker.sameRevision === true, true);
    send({ type: 'checked', missing: markers.filter(marker => !marker.el).map(marker => marker.id) });
    redraw();
  }
  function bounds(el) {
    if (!el?.isConnected || !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') return null;
    const r = el.getBoundingClientRect();
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    // Markers follow nested scroll areas and never float above clipped content.
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node), b = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  }
  function draw() {
    scheduled = false; mount();
    const target = located || (enabled ? selected || hovered : null);
    const r = bounds(target);
    outline.hidden = !r;
    outline.className = 'outline' + (enabled && !located ? ' selecting' : '');
    if (r) Object.assign(outline.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const occupied = [];
    for (const marker of markers) {
      const b = bounds(marker.el);
      const button = marker.button;
      button.hidden = !b || !marker.visible;
      button.className = (marker.id === activeThread ? 'active ' : '') + (marker.resolved ? 'resolved' : '');
      if (!b || !marker.visible) continue;
      let x = Math.max(4, Math.min(innerWidth - 30, b.right - 13)), y = Math.max(4, Math.min(innerHeight - 30, b.top - 13));
      // Multiple threads on a section remain individually reachable.
      while (occupied.some(p => Math.abs(p.x - x) < 28 && Math.abs(p.y - y) < 28) && x > 32) x -= 30;
      while (occupied.some(p => Math.abs(p.x - x) < 28 && Math.abs(p.y - y) < 28) && y < innerHeight - 58) y += 30;
      occupied.push({ x, y });
      Object.assign(button.style, { left: x + 'px', top: y + 'px' });
    }
  }
  function redraw() { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } }
  function showLocation(el) {
    clearTimeout(timer); located = el;
    timer = setTimeout(() => { located = null; redraw(); }, 1800);
    redraw();
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'artifact-review') return;
    const data = event.data;
    if (data.type === 'mode') { enabled = data.enabled === true; locked = data.locked === true; hovered = null; located = null; redraw(); }
    if (data.type === 'clear-selection') { selected = null; hovered = null; located = null; redraw(); }
    if (data.type === 'parent' && !locked && selected && usable(selected.parentElement)) {
      selected = selected.parentElement; redraw(); send({ type: 'selected', anchor: anchor(selected) });
    }
    if (data.type === 'focus') void focus(data);
    if (data.type === 'check' && Array.isArray(data.threads)) {
      mount(); activeThread = data.activeThread;
      const previous = new Map(markers.map(m => [m.id, m]));
      markers = data.threads.map(t => {
        const marker = previous.get(t.id) || { button: document.createElement('button') };
        previous.delete(t.id);
        Object.assign(marker, t, { el: find(t.anchor, t.sameRevision === true, true) });
        marker.button.type = 'button'; marker.button.textContent = String(t.number);
        marker.button.setAttribute('aria-label', 'Open comment ' + t.number + (t.resolved ? ' (resolved)' : ''));
        marker.button.title = 'Comment ' + t.number;
        marker.button.onclick = () => { activeThread = t.id; showLocation(marker.el); send({ type: 'open-thread', threadId: t.id }); };
        if (!marker.button.isConnected) root.appendChild(marker.button);
        return marker;
      });
      previous.forEach(m => m.button.remove());
      send({ type: 'checked', missing: markers.filter(m => !m.el).map(m => m.id) }); redraw();
    }
  });
  addEventListener('pointermove', event => { if (enabled && !locked && !selected) { hovered = usable(event.target) ? event.target : null; redraw(); } }, true);
  addEventListener('pointerout', event => { if (!event.relatedTarget) { hovered = null; redraw(); } }, true);
  addEventListener('click', event => {
    if (!enabled || navigating || !usable(event.target)) return;
    if (!locked && navigationControl(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (locked) return;
    selected = event.target; located = null; redraw(); send({ type: 'selected', anchor: anchor(selected) });
  }, true);
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && enabled) { event.preventDefault(); enabled = false; hovered = null; redraw(); send({ type: 'escape' }); }
  }, true);
  addEventListener('scroll', redraw, true);
  addEventListener('resize', redraw);
  addEventListener('load', redraw, true);
  addEventListener('DOMContentLoaded', () => { new ResizeObserver(redraw).observe(document.body);
    new MutationObserver(refreshMarkers).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open', 'aria-selected'] });
    redraw(); });
})();
