// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const script = readFileSync(new URL('../../backend/static/review.js', import.meta.url), 'utf8');
let dom: JSDOM;
function setup() {
  dom = new JSDOM('<!doctype html><html><body><section id="overview"><p>Original section</p></section><button id="preview">Preview</button></body></html>', { url: 'https://artifact.test/review', referrer: 'https://artifact.test/browse', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const parent = { postMessage: vi.fn() };
  Object.defineProperty(w, 'parent', { value: parent });
  Object.defineProperty(w, 'CSS', { value: { escape: (v: string) => v } });
  w.matchMedia = () => ({ matches: false }) as unknown as MediaQueryList;
  w.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  w.requestAnimationFrame = callback => { callback(0); return 1; };
  w.HTMLElement.prototype.scrollIntoView = vi.fn();
  w.HTMLElement.prototype.getClientRects = function() { return this.closest('[hidden]') ? [] as unknown as DOMRectList : [{ x: 40, y: 100, left: 40, top: 100, right: 440, bottom: 200, width: 400, height: 100 }] as unknown as DOMRectList; };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 40, y: 100, left: 40, top: 100, right: 440, bottom: 200, width: 400, height: 100, toJSON() {} });
  let shadow: ShadowRoot;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { shadow = attach.call(this, options); return shadow; };
  w.eval(script);
  const send = (data: object, origin = 'https://artifact.test') => w.dispatchEvent(new w.MessageEvent('message', { origin, source: parent as unknown as Window, data: { channel: 'artifact-review', ...data } }));
  const anchor = { selector: '#overview', elementId: 'overview', stableId: '', text: 'Original section', tag: 'section' };
  const mark = (extra = {}) => send({ type: 'check', threads: [{ id: 'one', number: 1, anchor, sameRevision: true, visible: true, ...extra }] });
  return { w, parent, send, anchor, mark, root: () => shadow! };
}
afterEach(() => { dom?.window.close(); vi.useRealTimers(); });
describe('sandbox review bridge', () => {
  it('keeps markers separate from original document content and normal interactions', () => {
    const { w, mark, root, parent } = setup();
    const original = w.document.body.innerHTML;
    mark();
    expect(w.document.body.innerHTML).toBe(original);
    const click = vi.fn(); w.document.getElementById('preview')!.addEventListener('click', click);
    w.document.getElementById('preview')!.click(); expect(click).toHaveBeenCalledOnce();
    root().querySelector('button')!.click();
    expect(parent.postMessage).toHaveBeenCalledWith({ channel: 'artifact-review', type: 'open-thread', threadId: 'one' }, 'https://artifact.test');
  });
  it('selects elements repeatedly, clears posted selections, and blocks document actions only in comment mode', () => {
    const { w, send, parent } = setup();
    send({ type: 'mode', enabled: true });
    const button = w.document.getElementById('preview')!;
    const click = vi.fn(); button.addEventListener('click', click);
    button.click(); expect(click).not.toHaveBeenCalled();
    expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].type).toBe('selected');
    send({ type: 'clear-selection' });
    w.document.querySelector('p')!.click();
    expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].anchor.text).toBe('Original section');
    send({ type: 'mode', enabled: false }); button.click(); expect(click).toHaveBeenCalledOnce();
  });
  it('ignores forged parent origins and rejects ambiguous or changed anchors', () => {
    const { w, send, mark, parent } = setup();
    send({ type: 'mode', enabled: true }, 'https://evil.test');
    w.document.querySelector('p')!.click(); expect(parent.postMessage).not.toHaveBeenCalled();
    w.document.querySelector('p')!.textContent = 'Changed text'; mark();
    expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].missing).toEqual(['one']);
  });
  it('fades the location outline while keeping the numbered marker', () => {
    vi.useFakeTimers();
    const { send, mark, anchor, root } = setup(); mark();
    send({ type: 'focus', threadId: 'one', anchor, sameRevision: true });
    expect((root().querySelector('.outline') as HTMLElement).hidden).toBe(false);
    vi.advanceTimersByTime(1801);
    expect((root().querySelector('.outline') as HTMLElement).hidden).toBe(true);
    expect(root().querySelector('button')!.hidden).toBe(false);
  });
  it('hides filtered markers and keeps same-section markers from overlapping', () => {
    const { send, anchor, root } = setup();
    send({ type: 'check', threads: [1, 2, 3].map(number => ({ id: String(number), number, anchor, sameRevision: true, visible: number !== 3 })) });
    const buttons = Array.from(root().querySelectorAll('button'));
    expect(buttons[0].style.left).not.toBe(buttons[1].style.left);
    expect(buttons[2].hidden).toBe(true);
  });
  it('reveals nested generated report tabs for legacy anchors while comment mode stays on', () => {
    const { w, send, parent } = setup();
    w.document.body.innerHTML = `<button data-select="0">First</button><button data-select="1">Second</button>
      <section id="case-0"></section><section id="case-1" hidden><div class="editor">
      <button data-mode="diff">Diff</button><button data-mode="final">Final</button><div class="editorbody">
      <div data-view="diff"></div><div data-view="final" hidden><article id="target"><p>Heading</p><p>Body</p></article></div></div></div></section>`;
    const target = w.document.getElementById('target')!;
    // innerText introduces block separators only when rendered; old anchors used it.
    Object.defineProperty(target, 'innerText', { get: () => target.closest('[hidden]') ? 'HeadingBody' : 'Heading Body' });
    w.document.querySelector<HTMLButtonElement>('[data-select="1"]')!.onclick = () => { w.document.getElementById('case-1')!.hidden = false; };
    w.document.querySelector<HTMLButtonElement>('[data-mode="final"]')!.onclick = () => { w.document.querySelector<HTMLElement>('[data-view="final"]')!.hidden = false; };
    const anchor = { selector: '#target', elementId: 'target', stableId: '', tag: 'article', text: 'Heading Body' };
    send({ type: 'mode', enabled: true });
    send({ type: 'check', threads: [{ id: 'nested', anchor, sameRevision: true, number: 1, visible: true }] });
    expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].missing).toEqual([]);
    send({ type: 'focus', threadId: 'nested', anchor, sameRevision: true });
    expect(target.closest('[hidden]')).toBeNull();
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'located', found: true }), 'https://artifact.test');
    target.click(); expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].type).toBe('selected');
  });
  it('uses ARIA tab controls and permits tab navigation in comment mode', () => {
    const { w, send, parent } = setup();
    w.document.body.innerHTML = '<button role="tab" aria-controls="panel"><span>Tab</span></button><section id="panel" role="tabpanel" hidden><p id="target">Text</p></section>';
    const button = w.document.querySelector('button')!;
    button.onclick = () => { w.document.getElementById('panel')!.hidden = false; };
    send({ type: 'mode', enabled: true }); w.document.querySelector('span')!.click();
    expect(w.document.getElementById('panel')!.hidden).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'selected' }), expect.anything());
    w.document.getElementById('panel')!.hidden = true;
    send({ type: 'focus', anchor: { selector: '#target', elementId: 'target', tag: 'p', text: 'Text' }, sameRevision: true });
    expect(w.document.getElementById('panel')!.hidden).toBe(false);
  });
  it('does not claim hidden unsupported content needs reattachment or click ambiguous controls', () => {
    const { w, send, parent, anchor } = setup();
    w.document.getElementById('overview')!.hidden = true;
    w.document.body.insertAdjacentHTML('beforeend', '<button aria-controls="overview">One</button><button aria-controls="overview">Two</button>');
    const click = vi.fn(); w.document.querySelectorAll('button').forEach(button => button.onclick = click);
    send({ type: 'focus', anchor, sameRevision: true });
    expect(click).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'located', found: false, reason: 'hidden' }), 'https://artifact.test');
  });
  it('validates changed legacy text after revealing and never highlights the wrong section', () => {
    const { w, send, parent, anchor, mark, root } = setup();
    const section = w.document.getElementById('overview')!; section.hidden = true; section.textContent = 'Changed';
    w.document.body.insertAdjacentHTML('beforeend', '<button aria-controls="overview">Open</button>');
    w.document.querySelector<HTMLButtonElement>('[aria-controls]')!.onclick = () => { section.hidden = false; };
    mark(); send({ type: 'focus', anchor, sameRevision: true });
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'located', found: false, reason: 'missing' }), 'https://artifact.test');
    expect((root().querySelector('.outline') as HTMLElement).hidden).toBe(true);
    expect(parent.postMessage.mock.calls.slice(-1)[0]?.[0].missing).toEqual(['one']);
  });

  it('anchors duplicate IDs in tab views with a unique DOM path', () => {
    const { w, send, parent } = setup();
    w.document.body.innerHTML = '<section><p id="repeated" data-artifact-id="repeated">Text</p></section><section hidden><p id="repeated" data-artifact-id="repeated">Text</p></section>';
    send({ type: 'mode', enabled: true }); w.document.querySelector('p')!.click();
    const anchor = parent.postMessage.mock.calls.slice(-1)[0]?.[0].anchor;
    expect(anchor.elementId).toBe(''); expect(anchor.stableId).toBe('');
    send({ type: 'focus', anchor, sameRevision: true });
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'located', found: true }), 'https://artifact.test');
  });

});
