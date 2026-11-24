// Runs shopee-peek.user.js in a Node vm with just enough browser to exercise
// the sandbox listeners and the page hooks offline. No network, no dependencies.
// Sandbox and page share one global here; in the browser they are separate worlds.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = process.env.PEEK_SCRIPT || new URL('../shopee-peek.user.js', import.meta.url);

// Captured from shopee.tw while logged out (2026-11-23).
export const BLOCKED = '{"is_customized":false,"is_login":false,"action_type":2,"error":90309999,"tracking_id":"995f0cfd578-09ff-4140-ad2d-5a3c392804dd","redirect_to_error_page":true}';

// Parses script[type="..."] for LINE PDP HTML; BigGo search reads self.__next_f.push directly.
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

class FakeNode {
  appendChild(n) { return n; }
  insertBefore(n) { return n; }
}

const element = (tag) => {
  const n = Object.assign(new FakeNode(), {
    tagName: tag.toUpperCase(), style: {}, textContent: '', children: [], id: '',
    append: (...c) => n.children.push(...c),
    remove: () => { n.removed = true; },
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (k) => n[k] ?? null,
    setAttribute: (k, v) => { n[k] = String(v); },
    removeAttribute: (k) => { delete n[k]; },
  });
  return n;
};

/**
 * @param {object} o
 * @param {string} [o.path] location.pathname
 * @param {(opts: object) => void} [o.gm] GM_xmlhttpRequest stub; call opts.onload/onerror/ontimeout
 * @param {(url: string, init?: object) => Promise<Response>} [o.fetch] network seen by the page
 * @param {(sel: string) => Array<object>} [o.querySelectorAll] custom document.querySelectorAll stub
 */
export const load = ({ path = '/', gm = () => {}, fetch = async () => new Response('{}'), querySelectorAll = () => [] } = {}) => {
  const document = new EventTarget();
  const mounted = [];
  const headNodes = [];
  const logs = [];
  const observers = [];
  const beacons = [];
  const opened = [];
  const historyCalls = [];
  let cookie = '';
  Object.defineProperty(document, 'cookie', { get: () => cookie, set: (v) => { cookie += `${v.split(';')[0]}; `; } });
  const ctx = {
    console: { info: (...a) => logs.push(a.map(String).join(' ')), log() {}, warn() {}, error() {} },
    location: { pathname: path, origin: 'https://shopee.tw', get href() { return `https://shopee.tw${this.pathname}`; } },
    sessionStorage: new Map(Object.entries({})),
    history: {
      pushState: (s, t, url) => { historyCalls.push(['push', url]); return 'push'; },
      replaceState: (s, t, url) => { historyCalls.push(['replace', url]); return 'replace'; },
    },
    navigator: { sendBeacon: (u, data) => { beacons.push([u, data]); return true; } },
    open: (u, target) => { opened.push([u, target]); return { url: u }; },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    },
    DOMParser: FakeDOMParser,
    XMLHttpRequest: FakeXHR,
    Node: FakeNode,
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
    querySelectorAll,
    body: { append: (n) => mounted.push(n) },
    head: {
      // The script injects page() through an inline <script>; run it in the same context.
      appendChild: (n) => {
        headNodes.push(n);
        if (n.tagName === 'SCRIPT') vm.runInContext(n.textContent, ctx);
      },
    },
  });
  vm.runInContext(readFileSync(SCRIPT, 'utf8'), ctx);
  return {
    ctx,
    mounted,
    headNodes,
    observers,
    beacons,
    opened,
    historyCalls,
    /** console.info lines, joined per call: what a user pastes into a bug report. */
    logs,
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

export const biggoSearchHtml = (list) => {
  const payload = `15:["$","$L2a",null,${JSON.stringify({ initValue: { ssrData: { result: true, list } } })}]`;
  const mid = Math.floor(payload.length / 2);
  return `<html><script>self.__next_f.push([1,${JSON.stringify(payload.slice(0, mid))}])</script><script>self.__next_f.push([1,${JSON.stringify(payload.slice(mid))}])</script></html>`;
};
