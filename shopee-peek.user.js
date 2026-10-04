// ==UserScript==
// @name         Shopee Peek
// @version      0.5.3
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
// @connect      biggo.com.tw
// ==/UserScript==

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0';

if (!document.cookie.includes('language=')) document.cookie = 'language=zhHant; domain=.shopee.tw; path=/; max-age=31536000';

document.addEventListener('peek-req', (e) => {
  const { id, shop, item } = JSON.parse(e.detail);
  const reply = (entry) => document.dispatchEvent(new CustomEvent('peek-res', { detail: JSON.stringify({ id, entry }) }));
  GM_xmlhttpRequest({
    url: `https://shopee.tw/product/${shop}/${item}`,
    headers: { 'User-Agent': UA },
    anonymous: true,
    timeout: 15000,
    onload: (r) => {
      let entry = null;
      try {
        const raw = new DOMParser().parseFromString(r.responseText, 'text/html').querySelector('script[type="text/mfe-initial-data"]');
        const bff = raw && JSON.parse(raw.textContent).initialState.DOMAIN_PDP?.data?.PDP_BFF_DATA;
        entry = bff ? bff.cachedMap[bff.currentKey] : null;
      } catch (err) {
        console.info('[Shopee Peek] LINE 版資料解析失敗', err);
      }
      reply(entry);
      if (entry) showPrice(shop, item, entry);
    },
    onerror: () => reply(null),
    ontimeout: () => reply(null),
  });
});

const fmt = (n) => `$${Number(n).toLocaleString('en-US')}`;
let variantState = null;

const gmGet = (url) => new Promise((resolve) => GM_xmlhttpRequest({
  url,
  anonymous: true,
  timeout: 15000,
  onload: (r) => resolve(r.status === 200 ? r.responseText : null),
  onerror: () => resolve(null),
  ontimeout: () => resolve(null),
}));

const fetchVariants = async (shop, item) => {
  for (const kind of ['tw_mall_shopeemall', 'tw_bid_shopee']) {
    const t = await gmGet(`https://biggo.com.tw/api/v1/spa/product/multiple?i=${kind}&oid=${shop}.${item}`);
    const list = t && t.startsWith('{') ? JSON.parse(t).list : null;
    if (list && list.length) return list.map((v) => ({ title: v.title, price: v.price, offline: v.is_offline, modelId: String(v.history_id).split('-').pop() }));
  }
  return null;
};

const fetchSinglePrice = async (shop, item, link) => {
  const t = await gmGet(link);
  if (!t) return null;
  let el = new DOMParser().parseFromString(t, 'text/html').querySelector(`a[href*="id=${shop}.${item}&"]`);
  for (let i = 0; el && i < 8; i++, el = el.parentElement) {
    const hit = [...el.querySelectorAll('*')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).find((x) => /^\$[\d,]+$/.test(x));
    if (hit) return hit;
  }
  return null;
};

const selectedModelId = () => {
  if (!variantState) return null;
  const { tiers, models } = variantState;
  const idx = tiers.map((opts) => opts.findIndex((o) => [...document.querySelectorAll('button.selection-box-selected')].some((b) => b.getAttribute('aria-label') === o)));
  if (idx.some((i) => i < 0)) return null;
  const m = models.find((x) => x.extinfo && String(x.extinfo.tier_index) === String(idx));
  return m ? String(m.model_id) : null;
};

const renderVariantPrice = () => {
  if (!variantState) return;
  const { list, link } = variantState;
  const live = list.filter((v) => !v.offline);
  const pool = live.length ? live : list;
  const sel = list.find((v) => v.modelId === selectedModelId());
  if (sel) return drawPrice(fmt(sel.price), link, `規格：${sel.title}${sel.offline ? '（已下架）' : ''}`, true);
  const ps = pool.map((v) => v.price);
  const min = Math.min(...ps), max = Math.max(...ps);
  drawPrice(min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`, link, pool.map((v) => `${v.title} ${fmt(v.price)}`).join('　'), true);
};

document.addEventListener('click', () => setTimeout(renderVariantPrice, 50), true);
setInterval(renderVariantPrice, 500);

const showPrice = async (shop, item, entry) => {
  const title = entry.item.title;
  priceTitle = title;
  variantState = null;
  const link = `https://biggo.com.tw/s/${encodeURIComponent(title)}`;
  drawPrice('價格載入中…', link);
  const list = await fetchVariants(shop, item);
  if (list) {
    variantState = { list, link, tiers: (entry.item.tier_variations || []).map((t) => t.options), models: entry.item.models || [] };
    return renderVariantPrice();
  }
  const single = await fetchSinglePrice(shop, item, link);
  drawPrice(single || '查無價格', link);
};

let priceState = null;
let priceTitle = '';

const findTitle = () => {
  const hs = [...document.querySelectorAll('h1')].filter((h) => h.offsetParent);
  return hs.find((h) => priceTitle && h.textContent.includes(priceTitle.slice(0, 12))) || hs[0];
};

const anchorOf = (h1) => {
  let el = h1;
  while (el.parentElement && getComputedStyle(el.parentElement).overflow !== 'visible') el = el.parentElement;
  return el;
};

const drawPrice = (text, link, note = '', quiet = false) => {
  if (priceState && priceState.text === text && priceState.note === note) return;
  if (!quiet) console.info('[Shopee Peek]', text, note);
  priceState = { text, link, note };
};

setInterval(() => {
  const h1 = findTitle();
  if (priceState && !h1 && !priceState.warned) {
    priceState.warned = true;
    console.info('[Shopee Peek] 找不到可見的 h1，h1 總數：', document.querySelectorAll('h1').length);
  }
  if (!priceState || !h1) return;
  const anchor = anchorOf(h1);
  let box = document.getElementById('peek-price');
  if (!box || box.previousElementSibling !== anchor) {
    box?.remove();
    box = document.createElement('div');
    box.id = 'peek-price';
    box.style.cssText = 'margin:16px 0;padding:14px 20px;background:#fafafa;display:flex;align-items:baseline;gap:12px';
    box.innerHTML = `<span style="color:#ee4d2d;font-size:30px;font-weight:500"></span><em style="color:#555;font-size:14px;font-style:normal"></em><a target="_blank" style="color:#888;font-size:13px">BigGo 參考價，可能非即時 ↗</a>`;
    anchor.after(box);
  }
  const span = box.querySelector('span');
  if (span.textContent !== priceState.text) span.textContent = priceState.text;
  const em = box.querySelector('em');
  if (em.textContent !== priceState.note) em.textContent = priceState.note;
  box.querySelector('a').href = priceState.link;
}, 300);

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
    return of.apply(this, arguments).then(async (r) => {
      if (!isApi(u)) return r;
      if (!(await r.clone().text()).includes('90309999')) return r;
      if (!isPdp(u)) return json(EMPTY);
      const b = await pdpBody(u);
      return b ? json(b) : r;
    });
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  const osh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this._peek = { method: m, url: String(u), headers: [] };
    return oo.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    this._peek?.headers.push([k, v]);
    return osh.call(this, k, v);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const x = this;
    const { method = 'GET', url: u = '', headers = [] } = x._peek || {};
    const fake = (t, status = 200, hdrs = null) => {
      Object.defineProperty(x, 'responseText', { get: () => t });
      Object.defineProperty(x, 'response', { get: () => (x.responseType === 'json' ? JSON.parse(t) : t) });
      Object.defineProperty(x, 'status', { get: () => status });
      if (hdrs) {
        x.getResponseHeader = (k) => hdrs.get(k);
        x.getAllResponseHeaders = () => [...hdrs].map(([k, v]) => `${k}: ${v}`).join('\r\n');
      }
    };
    const finish = (...events) => {
      Object.defineProperty(x, 'readyState', { get: () => 4 });
      for (const ev of ['readystatechange', ...events]) x.dispatchEvent(new ProgressEvent(ev));
    };
    if (isPdp(u)) {
      const init = { method, headers, credentials: x.withCredentials ? 'include' : 'same-origin' };
      if (!/^(GET|HEAD)$/i.test(method)) init.body = body;
      return window.fetch(u, init)
        .then(async (r) => {
          fake(await r.text(), r.status, r.headers);
          finish('load', 'loadend');
        })
        .catch(() => {
          fake('', 0);
          finish('error', 'loadend');
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

const css = document.createElement('style');
css.textContent = `
  div:has(> div > #HomePagePopupBannerSection), #HomePagePopupBannerSection { display: none !important; }
  html:has(#HomePagePopupBannerSection), body:has(#HomePagePopupBannerSection) { overflow: auto !important; }
`;
(document.head || document.documentElement).appendChild(css);
