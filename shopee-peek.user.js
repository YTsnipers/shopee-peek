// ==UserScript==
// @name         Shopee Peek
// @version      0.3.0
// @namespace    https://github.com/YTsnipers/shopee-peek
// @license      MIT
// @homepageURL  https://github.com/YTsnipers/shopee-peek
// @updateURL    https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js
// @downloadURL  https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js
// @description  不登入看蝦皮商品頁：用 LINE 內建瀏覽器的 UA 取得商品資料，餵給蝦皮原生頁面，並擋下錯誤頁跳轉
// @match        https://shopee.tw/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      shopee.tw
// ==/UserScript==

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0';

if (!document.cookie.includes('language=')) document.cookie = 'language=zhHant; domain=.shopee.tw; path=/; max-age=31536000';

document.addEventListener('peek-req', (e) => {
  const { id, shop, item } = JSON.parse(e.detail);
  GM_xmlhttpRequest({
    url: `https://shopee.tw/product/${shop}/${item}`,
    headers: { 'User-Agent': UA },
    anonymous: true,
    onload: (r) => {
      const raw = new DOMParser().parseFromString(r.responseText, 'text/html').querySelector('script[type="text/mfe-initial-data"]');
      const bff = raw && JSON.parse(raw.textContent).initialState.DOMAIN_PDP?.data?.PDP_BFF_DATA;
      const entry = bff ? bff.cachedMap[bff.currentKey] : null;
      document.dispatchEvent(new CustomEvent('peek-res', { detail: JSON.stringify({ id, entry }) }));
    },
  });
});

const page = () => {
  const of = window.fetch;
  const EMPTY = JSON.stringify({ error: 0, error_msg: null, data: null });
  const isPdp = (u) => String(u).includes('/api/v4/pdp/get_pc');
  const isApi = (u) => String(u).includes('/api/');
  const json = (b) => new Response(b, { status: 200, headers: { 'content-type': 'application/json' } });
  let seq = 0;

  const getEntry = (shop, item) => new Promise((resolve) => {
    const id = ++seq;
    const onRes = (e) => {
      const d = JSON.parse(e.detail);
      if (d.id !== id) return;
      document.removeEventListener('peek-res', onRes);
      resolve(d.entry);
    };
    document.addEventListener('peek-res', onRes);
    document.dispatchEvent(new CustomEvent('peek-req', { detail: JSON.stringify({ id, shop, item }) }));
  });

  const fillShop = async (entry, shop) => {
    const r = await of(`/api/v4/shop/get_shop_base?shopid=${shop}`, { credentials: 'include' }).then((x) => x.json()).catch(() => null);
    const base = r && r.data;
    if (!base || !entry.shop_detailed) return;
    for (const k of Object.keys(entry.shop_detailed)) {
      if (entry.shop_detailed[k] == null && base[k] != null) entry.shop_detailed[k] = base[k];
    }
  };

  const pdpBody = async (u) => {
    const q = new URL(u, location.origin).searchParams;
    const shop = q.get('shop_id');
    const entry = await getEntry(shop, q.get('item_id'));
    if (!entry) return null;
    await fillShop(entry, shop);
    return JSON.stringify({ bff_meta: null, error: null, error_msg: null, data: entry });
  };

  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input.url;
    if (isPdp(u)) return pdpBody(u).then((b) => (b ? json(b) : of.call(this, input, init)));
    return of.apply(this, arguments).then(async (r) => {
      if (!isApi(u)) return r;
      return (await r.clone().text()).includes('90309999') ? json(EMPTY) : r;
    });
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this._peekUrl = String(u);
    return oo.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const x = this;
    const u = x._peekUrl || '';
    const fake = (t) => {
      Object.defineProperty(x, 'responseText', { get: () => t });
      Object.defineProperty(x, 'response', { get: () => (x.responseType === 'json' ? JSON.parse(t) : t) });
      Object.defineProperty(x, 'status', { get: () => 200 });
    };
    if (isPdp(u)) {
      return pdpBody(u).then((b) => {
        if (!b) return os.call(x, body);
        fake(b);
        Object.defineProperty(x, 'readyState', { get: () => 4 });
        x.dispatchEvent(new Event('readystatechange'));
        x.dispatchEvent(new ProgressEvent('load'));
        x.dispatchEvent(new ProgressEvent('loadend'));
      });
    }
    if (isApi(u)) x.addEventListener('readystatechange', () => {
      if (x.readyState === 4 && String(x.responseText).includes('90309999')) fake(EMPTY);
    });
    return os.call(x, body);
  };

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (s, t, url) {
      if (url && String(url).includes('/verify/')) return;
      return orig.apply(this, arguments);
    };
  }
};

const s = document.createElement('script');
s.textContent = `(${page})();`;
(document.head || document.documentElement).appendChild(s);
s.remove();
