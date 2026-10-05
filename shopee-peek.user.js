// ==UserScript==
// @name         Shopee Peek
// @version      0.6.0
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
  if (!/^\d+$/.test(shop) || !/^\d+$/.test(item)) return reply(null);
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
        if (bff && !entry) console.info('[Shopee Peek] LINE 版回傳空資料（疑似蝦皮限流），稍後再試');
      } catch (err) {
        console.info('[Shopee Peek] LINE 版資料解析失敗', err);
      }
      reply(entry);
      if (entry) showPrice(shop, item, entry);
      else showFallback(shop, item);
    },
    onerror: () => (reply(null), showFallback(shop, item)),
    ontimeout: () => (reply(null), showFallback(shop, item)),
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

const fetchBigGoHit = async (shop, item, link) => {
  const t = await gmGet(link);
  if (!t) return null;
  const a = new DOMParser().parseFromString(t, 'text/html').querySelector(`a[href*="id=${shop}.${item}&"]`);
  if (!a) return null;
  const image = a.querySelector('img')?.getAttribute('src') || null;
  let el = a;
  for (let i = 0; el && i < 8; i++, el = el.parentElement) {
    const price = [...el.querySelectorAll('*')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).find((x) => /^\$[\d,]+$/.test(x));
    if (price) return { price, image };
  }
  return { price: null, image };
};

const fetchSinglePrice = async (shop, item, link) => (await fetchBigGoHit(shop, item, link))?.price || null;

const slugTitle = () => {
  const m = decodeURIComponent(location.pathname).match(/^\/(.+)-i\.\d+\.\d+$/);
  return m ? m[1].replace(/-/g, ' ').trim() : '';
};

const onItem = (shop, item) => location.pathname.includes(`i.${shop}.${item}`) || location.pathname.includes(`/product/${shop}/${item}`);

const showFallback = async (shop, item) => {
  console.info('[Shopee Peek] 蝦皮商品資料被限流，改用 BigGo 備援');
  document.getElementById('peek-fallback')?.remove();
  const title = slugTitle();
  const box = el('div', 'position:fixed;inset:0;z-index:2147483647;background:#f5f5f5;overflow:auto;font-family:sans-serif');
  box.id = 'peek-fallback';
  const card = el('div', 'max-width:900px;margin:60px auto;background:#fff;padding:24px;display:flex;gap:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)');
  const img = el('img', 'width:360px;height:360px;object-fit:contain;background:#fafafa;flex:none;border:0');
  const info = el('div', 'flex:1;min-width:0');
  const priceEl = el('div', 'color:#ee4d2d;font-size:30px;font-weight:500;margin:16px 0', '價格載入中…');
  const big = el('a', 'color:#888;font-size:13px', 'BigGo 參考價，可能非即時 ↗');
  big.target = '_blank';
  const nameEl = el('div', 'font-size:20px;line-height:28px;color:#222', title || `商品 ${shop}.${item}`);
  const noteEl = el('div', 'color:#555;font-size:14px;line-height:22px;margin-bottom:8px');
  info.append(
    nameEl,
    priceEl,
    noteEl,
    big,
    el('div', 'margin-top:24px;padding:12px;background:#fff8e1;color:#8a6d00;font-size:13px;line-height:20px', '蝦皮目前對這個 IP 限流，拿不到完整商品資料（規格、描述、多圖）。這是 BigGo 備援的精簡版；限流解除後重新整理即可看到完整頁面。'),
  );
  card.append(img, info);
  box.append(card);
  const mount = () => document.body ? document.body.append(box) : setTimeout(mount, 100);
  mount();
  const watch = setInterval(() => {
    if (!onItem(shop, item)) clearInterval(watch), box.remove();
  }, 500);
  const cached = sessionStorage.getItem(`peek:${shop}.${item}`);
  const found = cached ? JSON.parse(cached) : title ? await findInShopeeSearch(title, shop, item) : null;
  if (found) {
    nameEl.textContent = found.name;
    img.src = found.image;
  }
  const name = found?.name || title;
  big.href = `https://biggo.com.tw/s/${encodeURIComponent(name)}`;
  const vars = await fetchVariants(shop, item);
  const live = vars && (vars.filter((v) => !v.offline).length ? vars.filter((v) => !v.offline) : vars);
  if (live) {
    const ps = live.map((v) => v.price);
    const min = Math.min(...ps), max = Math.max(...ps);
    priceEl.textContent = min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
    noteEl.textContent = live.map((v) => `${v.title} ${fmt(v.price)}`).join('　');
  }
  const hit = name ? await fetchBigGoHit(shop, item, big.href) : null;
  if (!live) priceEl.textContent = hit?.price || '查無價格';
  if (!found && hit?.image) img.src = hit.image;
  if (!img.getAttribute('src')) img.remove();
};

const findInShopeeSearch = async (keyword, shop, item) => {
  for (let i = 0; i < 3; i++) {
    const hit = await searchOnce(keyword, shop, item);
    if (hit) return hit;
  }
  return null;
};

const searchOnce = (keyword, shop, item) => new Promise((resolve) => GM_xmlhttpRequest({
  url: `https://shopee.tw/search?keyword=${encodeURIComponent(keyword)}`,
  headers: { 'User-Agent': BOT_UA },
  anonymous: true,
  timeout: 15000,
  onload: (r) => resolve(parseItemList(r.responseText).find((x) => x.url.endsWith(`i.${shop}.${item}`)) || null),
  onerror: () => resolve(null),
  ontimeout: () => resolve(null),
}));

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

let priceSeq = 0;
let priceItem = null;

const showPrice = async (shop, item, entry) => {
  const my = ++priceSeq;
  const title = entry.item.title;
  priceTitle = title;
  priceItem = { shop, item };
  variantState = null;
  const link = `https://biggo.com.tw/s/${encodeURIComponent(title)}`;
  drawPrice('價格載入中…', link);
  const list = await fetchVariants(shop, item);
  if (my !== priceSeq) return;
  if (list) {
    variantState = { list, link, tiers: (entry.item.tier_variations || []).map((t) => t.options), models: entry.item.models || [] };
    return renderVariantPrice();
  }
  const single = await fetchSinglePrice(shop, item, link);
  if (my !== priceSeq) return;
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
  if (!priceItem || !onItem(priceItem.shop, priceItem.item)) return document.getElementById('peek-price')?.remove();
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

const BOT_UA = 'facebookexternalhit/1.1';
const parseItemList = (html) => {
  const raw = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => s.textContent).find((x) => x.includes('"ItemList"'));
  let list = [];
  try {
    list = raw ? JSON.parse(raw).itemListElement : [];
  } catch {
    return [];
  }
  return Array.isArray(list) ? list.filter((x) => typeof x?.name === 'string' && typeof x.image === 'string' && /i\.\d+\.\d+$/.test(x.url)) : [];
};

const fetchSearchPage = (keyword, page) => new Promise((resolve) => GM_xmlhttpRequest({
  url: `https://shopee.tw/search?keyword=${encodeURIComponent(keyword)}&page=${page}`,
  headers: { 'User-Agent': BOT_UA },
  anonymous: true,
  timeout: 15000,
  onload: (r) => resolve(parseItemList(r.responseText)),
  onerror: () => resolve([]),
  ontimeout: () => resolve([]),
}));

document.addEventListener('peek-search-req', async (e) => {
  const { id, keyword, page } = JSON.parse(e.detail);
  let items = [];
  if (typeof keyword !== 'string' || !Number.isInteger(page) || page < 0) {
    return document.dispatchEvent(new CustomEvent('peek-search-res', { detail: JSON.stringify({ id, items }) }));
  }
  for (let i = 0; i < 3 && !items.length; i++) items = await fetchSearchPage(keyword, page);
  for (const it of items) {
    const m = it.url.match(/i\.(\d+\.\d+)$/);
    if (m) sessionStorage.setItem(`peek:${m[1]}`, JSON.stringify({ name: it.name, image: it.image }));
  }
  document.dispatchEvent(new CustomEvent('peek-search-res', { detail: JSON.stringify({ id, items }) }));
});

setInterval(() => {
  if (location.pathname !== '/search') delete document.documentElement.dataset.peekNoPrice;
}, 500);

const el = (tag, css, text) => {
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (text != null) n.textContent = text;
  return n;
};

const page = () => {
  const of = window.fetch;
  const STUB = { search_suggestion: { queries: [] }, search_user: { users: [] }, search_prefills: { items: [], ordered_prefills: [] } };
  const RAW = { 'experiment/config': { is_success: false }, 'experiment/performance': { is_success: true } };
  const empty = (u) => {
    const r = Object.keys(RAW).find((x) => String(u).includes(`/${x}`));
    if (r) return JSON.stringify(RAW[r]);
    const k = Object.keys(STUB).find((x) => String(u).includes(`/${x}`));
    return JSON.stringify({ error: 0, error_msg: null, data: k ? STUB[k] : null });
  };
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

  const isSearch = (u) => String(u).includes('/api/v4/search/search_items');

  const getSearch = (keyword, page) => new Promise((resolve) => {
    const id = ++seq;
    const onRes = (e) => {
      const d = JSON.parse(e.detail);
      if (d.id !== id) return;
      document.removeEventListener('peek-search-res', onRes);
      resolve(d.items);
    };
    document.addEventListener('peek-search-res', onRes);
    document.dispatchEvent(new CustomEvent('peek-search-req', { detail: JSON.stringify({ id, keyword, page }) }));
  });

  const searchBody = async (u) => {
    const q = new URL(u, location.origin).searchParams;
    const limit = Number(q.get('limit') || 60);
    const page = Math.floor(Number(q.get('newest') || 0) / limit);
    const list = await getSearch(q.get('keyword') || '', page);
    if (!list.length) return null;
    document.documentElement.dataset.peekNoPrice = '1';
    const items = list.map((it) => {
      const [, shopid, itemid] = it.url.match(/i\.(\d+)\.(\d+)$/).map(Number);
      const image = it.image.split('/').pop().replace(/_tn$/, '');
      const item_basic = {
        itemid, shopid, name: it.name, image, images: [image], currency: 'TWD',
        price: 0, price_min: 0, price_max: 0, stock: 1, sold: 0, historical_sold: 0, liked_count: 0,
        item_rating: { rating_star: 0, rating_count: [0, 0, 0, 0, 0, 0] },
        shop_location: '', ctime: 0, status: 1, item_status: 'normal', is_adult: false, show_free_shipping: false,
      };
      return { item_basic, itemid, shopid, adsid: null, campaignid: null, item_type: 0 };
    });
    const total = list.length >= 10 ? limit * (page + 2) : limit * page + list.length;
    return JSON.stringify({ error: null, total_count: total, total_ads_count: 0, nomore: list.length < 10, items, query_rewrite: {} });
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
      if (!(await r.clone().text()).includes('90309999')) {
        if (isSearch(u)) delete document.documentElement.dataset.peekNoPrice;
        return r;
      }
      if (isSearch(u)) {
        const s = await searchBody(u);
        return json(s || empty(u));
      }
      if (!isPdp(u)) return json(empty(u));
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
    if (isApi(u)) {
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
  html[data-peek-no-price] a[href*="-i."] .text-shopee-primary { visibility: hidden !important; }
  html[data-peek-no-price] .shopee-page-controller, html[data-peek-no-price] .shopee-mini-page-controller { display: none !important; }
  html:has(#HomePagePopupBannerSection), body:has(#HomePagePopupBannerSection) { overflow: auto !important; }
`;
(document.head || document.documentElement).appendChild(css);
