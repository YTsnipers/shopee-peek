// Runs shopee-peek.user.js in a Node vm with just enough browser to exercise
// the sandbox listeners and the page hooks offline. No network, no dependencies.
// Sandbox and page share one global here; in the browser they are separate worlds.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = process.env.PEEK_SCRIPT || new URL('../shopee-peek.user.js', import.meta.url);

// Captured from shopee.tw while logged out (2026-11-23).
export const BLOCKED = '{"is_customized":false,"is_login":false,"action_type":2,"error":90309999,"tracking_id":"995f0cfd578-09ff-4140-ad2d-5a3c392804dd","redirect_to_error_page":true}';

// Only the selectors the script parses fetched HTML with: script[type="..."].
class FakeDOMParser {
  parseFromString(html) {
    const scripts = (type) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => m[1].includes(`type="${type}"`))
      .map((m) => ({ textContent: m[2] }));
    const typeOf = (sel) => sel.match(/^script\[type="([^"]+)"\]$/)?.[1];
    return {
      querySelector: (sel) => (typeOf(sel) ? scripts(typeOf(sel))[0] || null : null),
      querySelectorAll: (sel) => (typeOf(sel) ? scripts(typeOf(sel)) : []),
    };
  }
}

class FakeXHR extends EventTarget {
  open(method, url) { this.sent = { method, url }; }
  setRequestHeader() {}
  send() { this.nativeSend = true; }
}

const element = (tag) => {
  const n = {
    tagName: tag.toUpperCase(), style: {}, textContent: '', children: [], id: '',
    append: (...c) => n.children.push(...c),
    remove: () => { n.removed = true; },
    querySelector: () => null,
    getAttribute: (k) => n[k] ?? null,
  };
  return n;
};

/**
 * @param {object} o
 * @param {string} [o.path] location.pathname
 * @param {(opts: object) => void} [o.gm] GM_xmlhttpRequest stub; call opts.onload/onerror/ontimeout
 * @param {(url: string, init?: object) => Promise<Response>} [o.fetch] network seen by the page
 */
export const load = ({ path = '/', gm = () => {}, fetch = async () => new Response('{}') } = {}) => {
  const document = new EventTarget();
  const mounted = [];
  let cookie = '';
  Object.defineProperty(document, 'cookie', { get: () => cookie, set: (v) => { cookie += `${v.split(';')[0]}; `; } });
  const ctx = {
    console: { info() {}, log() {}, warn() {}, error() {} },
    location: { pathname: path, origin: 'https://shopee.tw', get href() { return `https://shopee.tw${this.pathname}`; } },
    sessionStorage: new Map(Object.entries({})),
    history: { pushState: () => 'push', replaceState: () => 'replace' },
    DOMParser: FakeDOMParser,
    XMLHttpRequest: FakeXHR,
    ProgressEvent: class extends Event {},
    CustomEvent, Event, EventTarget, Response, URL, URLSearchParams, Promise, JSON,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    GM_xmlhttpRequest: gm,
    fetch,
    document,
  };
  ctx.sessionStorage.getItem = (k) => ctx.sessionStorage.get(k) ?? null;
  ctx.sessionStorage.setItem = (k, v) => ctx.sessionStorage.set(k, String(v));
  ctx.window = ctx;
  vm.createContext(ctx);
  Object.assign(document, {
    documentElement: { dataset: {} },
    createElement: element,
    getElementById: (id) => mounted.find((n) => n.id === id && !n.removed) || null,
    querySelectorAll: () => [],
    body: { append: (n) => mounted.push(n) },
    head: {
      // The script injects page() through an inline <script>; run it in the same context.
      appendChild: (n) => { if (n.tagName === 'SCRIPT') vm.runInContext(n.textContent, ctx); },
    },
  });
  vm.runInContext(readFileSync(SCRIPT, 'utf8'), ctx);
  return {
    ctx,
    mounted,
    /** Read a top-level binding of the script (const/let live in the context's script scope). */
    get: (name) => vm.runInContext(name, ctx),
    /** Fire a bridge request and collect every reply for `ms`. */
    replies: (req, res, detail, ms = 50) => new Promise((resolve) => {
      const got = [];
      const on = (e) => got.push(JSON.parse(e.detail));
      document.addEventListener(res, on);
      document.dispatchEvent(new CustomEvent(req, { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }));
      setTimeout(() => (document.removeEventListener(res, on), resolve(got)), ms);
    }),
  };
};

export const pdpHtml = (shop, item, entry) => `<html><script type="text/mfe-initial-data">${JSON.stringify({
  initialState: { DOMAIN_PDP: { data: { PDP_BFF_DATA: { cachedMap: entry ? { [`${shop}/${item}`]: entry } : {}, currentKey: `${shop}/${item}` } } } },
})}</script></html>`;
