// ==UserScript==
// @name         Shopee Peek
// @version      0.8.0
// @namespace    https://github.com/YTsnipers/shopee-peek
// @license      MIT
// @homepageURL  https://github.com/YTsnipers/shopee-peek
// @updateURL    https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js
// @downloadURL  https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js
// @description  不登入看蝦皮商品頁與站內搜尋：商品資料取自 LINE 版頁面，價格與搜尋結果取自 BigGo，由蝦皮原生介面顯示，並封鎖頁首雜項、搜尋框熱搜詞與頁尾及其連結與請求
// @match        https://shopee.tw/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      shopee.tw
// @connect      biggo.com.tw
// ==/UserScript==

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0';

if (!document.cookie.includes('language=')) document.cookie = 'language=zhHant; domain=.shopee.tw; path=/; max-age=31536000';

// The one way to answer a page request: exactly one reply per request, even when the handler throws.
// `empty` is the reply when it does; the page side reads its fields.
const serve = (req, res, empty, handler) => document.addEventListener(req, async (e) => {
  let id = null;
  let out = empty;
  try {
    const d = JSON.parse(e.detail);
    id = d.id;
    out = await handler(d);
  } catch (err) {
    console.info('[Shopee Peek] 請求處理失敗', req, err);
  }
  document.dispatchEvent(new CustomEvent(res, { detail: JSON.stringify({ ...out, id }) }));
});

// The one way to call GM_xmlhttpRequest: resolves to the response, or null on error or timeout.
const gm = (url, ua) => new Promise((resolve) => GM_xmlhttpRequest({
  url,
  headers: ua ? { 'User-Agent': ua } : {},
  anonymous: true,
  timeout: 15000,
  onload: resolve,
  onerror: () => resolve(null),
  ontimeout: () => resolve(null),
}));

const lineEntry = (html) => {
  try {
    const raw = new DOMParser().parseFromString(html, 'text/html').querySelector('script[type="text/mfe-initial-data"]');
    const bff = raw && JSON.parse(raw.textContent).initialState.DOMAIN_PDP?.data?.PDP_BFF_DATA;
    const entry = bff ? bff.cachedMap[bff.currentKey] : null;
    if (bff && !entry) console.info('[Shopee Peek] LINE 版回傳空資料（疑似蝦皮限流），稍後再試');
    return entry || null;
  } catch (err) {
    console.info('[Shopee Peek] LINE 版資料解析失敗', err);
    return null;
  }
};

serve('peek-req', 'peek-res', { entry: null }, async ({ shop, item }) => {
  if (!/^\d+$/.test(shop) || !/^\d+$/.test(item)) return { entry: null };
  const r = await gm(`https://shopee.tw/product/${shop}/${item}`, UA);
  const entry = r && lineEntry(r.responseText);
  if (entry) showPrice(shop, item, entry);
  else showFallback(shop, item);
  return { entry };
});

const fmt = (n) => `$${Number(n).toLocaleString('en-US')}`;
let variantState = null;

const gmGet = (url) => gm(url).then((r) => (r?.status === 200 ? r.responseText : null));

const fetchVariants = async (shop, item) => {
  for (const kind of ['tw_mall_shopeemall', 'tw_bid_shopee']) {
    const t = await gmGet(`https://biggo.com.tw/api/v1/spa/product/multiple?i=${kind}&oid=${shop}.${item}`);
    let list = null;
    try {
      list = JSON.parse(t).list;
    } catch {}
    if (Array.isArray(list) && list.length) return list.map((v) => ({ title: v.title, price: v.price, offline: v.is_offline, modelId: String(v.history_id).split('-').pop() }));
  }
  return null;
};

const fetchBigGoHit = async (shop, item, link) => {
  const t = await gmGet(link);
  if (!t) return null;
  const a = new DOMParser().parseFromString(t, 'text/html').querySelector(`a[href*="id=${shop}.${item}&"]`);
  if (!a) return null;
  const imgEl = a.querySelector('img');
  const image = imgEl?.getAttribute('src') || null;
  const name = imgEl?.getAttribute('alt') || null;
  const foreign = (n) => [...n.querySelectorAll('a[href*="/r/?i="]')].some((x) => !x.getAttribute('href').includes(`id=${shop}.${item}&`));
  let el = a;
  for (let i = 0; el && i < 8 && !foreign(el); i++, el = el.parentElement) {
    const price = [...el.querySelectorAll('*')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).find((x) => /^\$[\d,]+$/.test(x));
    if (price) return { price, image, name };
  }
  return { price: null, image, name };
};

const fetchSinglePrice = async (shop, item, link) => (await fetchBigGoHit(shop, item, link))?.price || null;

const slugTitle = () => {
  const m = decodeURIComponent(location.pathname).match(/^\/(.+)-i\.\d+\.\d+$/);
  return m ? m[1].replace(/-/g, ' ').trim() : '';
};

const onItem = (shop, item) => new RegExp(`(?:i\\.${shop}\\.${item}|/product/${shop}/${item})/?$`).test(location.pathname);

// The one owner of "which product is on screen". Async work for a product (price box, fallback card)
// writes to the page only while its alive() holds: the URL is still that product and no newer claim exists.
let priceSeq = 0;
const claim = (shop, item) => {
  const my = ++priceSeq;
  return () => my === priceSeq && onItem(shop, item);
};

const showFallback = async (shop, item) => {
  const alive = claim(shop, item);
  if (!alive()) return;
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
    if (!alive()) clearInterval(watch), box.remove();
  }, 500);
  const cached = sessionStorage.getItem(`peek:${shop}.${item}`);
  const found = cached ? JSON.parse(cached) : null;
  if (found) {
    nameEl.textContent = found.name;
    img.src = found.image;
  }
  const name = found?.name || title;
  big.href = `https://biggo.com.tw/s/${encodeURIComponent(name)}`;
  const vars = await fetchVariants(shop, item);
  if (!alive()) return;
  const live = vars && (vars.filter((v) => !v.offline).length ? vars.filter((v) => !v.offline) : vars);
  if (live) {
    const ps = live.map((v) => v.price);
    const min = Math.min(...ps), max = Math.max(...ps);
    priceEl.textContent = min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
    noteEl.textContent = live.map((v) => `${v.title} ${fmt(v.price)}`).join('　');
  }
  const hit = name ? await fetchBigGoHit(shop, item, big.href) : null;
  if (!alive()) return;
  if (!live) priceEl.textContent = hit?.price || '查無價格';
  if (!found && hit?.name) nameEl.textContent = hit.name;
  if (!found && hit?.image) img.src = hit.image;
  if (!img.getAttribute('src')) img.remove();
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

let priceItem = null;

const showPrice = async (shop, item, entry) => {
  const alive = claim(shop, item);
  const title = entry.item.title;
  priceTitle = title;
  priceItem = { shop, item };
  variantState = null;
  const link = `https://biggo.com.tw/s/${encodeURIComponent(title)}`;
  drawPrice('價格載入中…', link);
  const list = await fetchVariants(shop, item);
  if (!alive()) return;
  if (list) {
    variantState = { list, link, tiers: (entry.item.tier_variations || []).map((t) => t.options), models: entry.item.models || [] };
    return renderVariantPrice();
  }
  const single = await fetchSinglePrice(shop, item, link);
  if (!alive()) return;
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

const biggoItems = (html) => {
  try {
    let stream = '';
    const pushRe = /self\.__next_f\.push\(\[\s*1\s*,\s*"/g;
    let m;
    while ((m = pushRe.exec(html))) {
      let i = m.index + m[0].length;
      for (let esc = false; i < html.length; i++) {
        if (esc) esc = false;
        else if (html[i] === '\\') esc = true;
        else if (html[i] === '"') break;
      }
      stream += JSON.parse(html.slice(m.index + m[0].length - 1, i + 1));
      pushRe.lastIndex = i + 1;
    }
    const key = '"ssrData":{';
    const s = stream.indexOf(key);
    if (s < 0) return [];
    const at = s + key.length - 1;
    let depth = 0, inStr = false, esc = false, i = at;
    for (; i < stream.length; i++) {
      const c = stream[i];
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = !inStr;
      else if (!inStr && (c === '{' ? (++depth, false) : c === '}' && !--depth)) break;
    }
    const list = JSON.parse(stream.slice(at, i + 1)).list;
    if (!Array.isArray(list)) return [];
    return list.flatMap((x) => {
      if (x?.is_offline || x?.is_notfound || typeof x?.title !== 'string' || !/^\d+\.\d+$/.test(x.oid)) return [];
      const im = String(x.origin_image || x.image || '').match(/\/file\/([a-zA-Z0-9_-]+?)(?:_tn)?(?:\.[a-zA-Z0-9]+)?(?:[?#]|$)/);
      return im ? [{ name: x.title, image: `https://down-tw.img.susercontent.com/file/${im[1]}`, url: `https://shopee.tw/product-i.${x.oid}` }] : [];
    });
  } catch (err) {
    console.info('[Shopee Peek] BigGo 搜尋資料解析失敗', err);
    return [];
  }
};

const fetchBigGoStore = async (keyword, store, page) => {
  const q = encodeURIComponent(keyword.trim()).replace(/\./g, '%2E');
  const r = await gm(`https://biggo.com.tw/s/${q}?m=cp&c[]=${store}${page > 0 ? `&p=${page + 1}` : ''}`);
  if (r && r.status !== 200) console.info(`[Shopee Peek] BigGo 搜尋失敗（HTTP ${r.status}）`);
  return r?.status === 200 ? biggoItems(r.responseText) : [];
};

const fetchSearchPage = async (keyword, page) => {
  const lists = await Promise.all(['tw_mall_shopeemall', 'tw_bid_shopee'].map((s) => fetchBigGoStore(keyword, s, page)));
  const seen = new Set();
  const out = [];
  const max = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const it = l[i];
      if (it && !seen.has(it.url)) {
        seen.add(it.url);
        out.push(it);
      }
    }
  }
  return out;
};

serve('peek-search-req', 'peek-search-res', { items: [] }, async ({ keyword, page }) => {
  if (typeof keyword !== 'string' || !keyword.trim() || !Number.isInteger(page) || page < 0) return { items: [] };
  const items = await fetchSearchPage(keyword, page);
  for (const it of items) {
    const m = it.url.match(/i\.(\d+\.\d+)$/);
    if (m) sessionStorage.setItem(`peek:${m[1]}`, JSON.stringify({ name: it.name, image: it.image }));
  }
  return { items };
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

const HIDE_SEL = [
  'nav.navbar > :first-child:not(.navbar__spacer):not(.navbar__links)',
  '.navbar__link--sell',
  '.navbar__links > li.navbar__link--help',
  '.navbar__links > li:has(#notifications)',
  '.navbar__links > li:has(a[href*="/notifications"])',
  '.navbar__links > li:has(.icon-notification-2)',
  '.navbar__links > li:has(a[href*="help.shopee"])',
  '.header-with-search__search-section > form.shopee-searchbar ~ *',
  '.shopee-searchbar-hints__search-prefill',
  'footer',
  '[role="contentinfo"]',
].join(', ');

const BLOCKED_LINK_HOSTS = /^(?:(?:seller|help)\.shopee\.tw|careers\.shopee\.com|(?:[\w-]+\.)?(?:facebook\.com|facebook\.net|instagram\.com|line\.me|linkedin\.com)|shopee\.(?:com\.(?:ar|my|br|mx)|sg|co\.(?:id|th)|vn|ph))$/i;

const page = () => {
  const of = window.fetch;
  const STUB = { search_suggestion: { queries: [] }, search_user: { users: [] }, search_prefills: { items: [], ordered_prefills: [] } };
  const RAW = { 'experiment/config': { is_success: false }, 'experiment/performance': { is_success: true } };
  const BLOCKED_HOSTS = /^(?:(?:seller|help)\.shopee\.tw|careers\.shopee\.com|(?:[\w-]+\.)?(?:facebook\.com|facebook\.net|instagram\.com|line\.me|linkedin\.com)|shopee\.(?:com\.(?:ar|my|br|mx)|sg|co\.(?:id|th)|vn|ph))$/i;
  const BLOCKED_PATHS = /^\/(?:seller\/signup(?:\/|$)|web(?:\/|$)|user\/notifications(?:\/|$)|blog(?:\/|$))/;
  const parseUrl = (u) => {
    try {
      return new URL(String(u), location.origin);
    } catch {
      return null;
    }
  };
  const blockedHost = (u) => {
    const p = parseUrl(u);
    return Boolean(p && BLOCKED_HOSTS.test(p.hostname));
  };
  const blockedNav = (u) => {
    const p = parseUrl(u);
    if (!p) return false;
    return BLOCKED_HOSTS.test(p.hostname) || (p.origin === location.origin && BLOCKED_PATHS.test(p.pathname));
  };
  const dropBody = (u) => {
    const s = String(u);
    if (blockedHost(s)) return '{}';
    if (s.includes('/api/v4/pages/get_footer_layout')) return JSON.stringify({ error: 0, error_msg: null, data: { id: 1, name: '', pc: [], rw: [] } });
    if (s.includes('/backend/CMS/footer/')) return JSON.stringify({ data: '' });
    if (s.includes('/api/v4/search/search_prefills')) return JSON.stringify({ error: 0, error_msg: null, data: STUB.search_prefills });
    if (s.includes('/api/v4/search/search_suggestion') && /[?&]bundle=popsearch(?:&|$)/.test(s)) return JSON.stringify({ error: 0, error_msg: null, data: STUB.search_suggestion });
    if (s.includes('/api/v4/notification/get_activities')) return JSON.stringify({ error: 0, error_msg: null, data: { activities: [] } });
    if (s.includes('/api/v4/notification/get_notifications')) return JSON.stringify({ error: 0, error_msg: null, data: { actions: [] } });
    if (s.includes('/api/v4/notification/')) return JSON.stringify({ error: 0, error_msg: null, data: { item_cards: [] } });
    return null;
  };
  const empty = (u) => {
    const r = Object.keys(RAW).find((x) => String(u).includes(`/${x}`));
    if (r) return JSON.stringify(RAW[r]);
    const k = Object.keys(STUB).find((x) => String(u).includes(`/${x}`));
    return JSON.stringify({ error: 0, error_msg: null, data: k ? STUB[k] : null });
  };
  const isPdp = (u) => String(u).includes('/api/v4/pdp/get_pc');
  const isApi = (u) => String(u).includes('/api/');
  const blocked = (t) => /\b90309999\b/.test(t);
  const json = (b) => new Response(b, { status: 200, headers: { 'content-type': 'application/json' } });
  let seq = 0;

  // The one way to ask the sandbox: the sandbox's serve() replies exactly once per id.
  const ask = (req, res, payload) => new Promise((resolve) => {
    const id = ++seq;
    const onRes = (e) => {
      const d = JSON.parse(e.detail);
      if (d.id !== id) return;
      document.removeEventListener(res, onRes);
      resolve(d);
    };
    document.addEventListener(res, onRes);
    document.dispatchEvent(new CustomEvent(req, { detail: JSON.stringify({ ...payload, id }) }));
  });
  const getEntry = (shop, item) => ask('peek-req', 'peek-res', { shop, item }).then((d) => d.entry);

  const fillShop = async (entry, shop) => {
    const r = await of(`/api/v4/shop/get_shop_base?shopid=${shop}`, { credentials: 'include' }).then((x) => x.json()).catch(() => null);
    const base = r && r.data;
    if (!base || !entry.shop_detailed) return;
    for (const k of Object.keys(entry.shop_detailed)) {
      if (entry.shop_detailed[k] == null && base[k] != null) entry.shop_detailed[k] = base[k];
    }
  };

  const isSearch = (u) => String(u).includes('/api/v4/search/search_items');

  const getSearch = (keyword, page) => ask('peek-search-req', 'peek-search-res', { keyword, page }).then((d) => d.items || []);

  const searchBody = async (u) => {
    const q = new URL(u, location.origin).searchParams;
    const limit = Number(q.get('limit') || 60);
    const page = Math.floor(Number(q.get('newest') || 0) / limit);
    const list = await getSearch(q.get('keyword') || '', page);
    if (!list.length) return null;
    document.documentElement.dataset.peekNoPrice = '1';
    const capped = list.slice(0, limit > 0 ? Math.min(limit, 35) : 35);
    const items = capped.map((it) => {
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
    const total = items.length >= 10 ? limit * (page + 2) : limit * page + items.length;
    return JSON.stringify({ error: null, total_count: total, total_ads_count: 0, nomore: items.length < 10, items, query_rewrite: null });
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
    const u = input?.url ?? String(input);
    const dropped = dropBody(u);
    if (dropped !== null) return Promise.resolve(json(dropped));
    return of.apply(this, arguments).then(async (r) => {
      if (!isApi(u)) return r;
      if (!blocked(await r.clone().text())) {
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
    const def = (k, get) => Object.defineProperty(x, k, { get, configurable: true });
    const fake = (t, status = 200, hdrs = null) => {
      def('responseText', () => t);
      def('response', () => (x.responseType === 'json' ? JSON.parse(t) : t));
      def('status', () => status);
      if (hdrs) {
        x.getResponseHeader = (k) => hdrs.get(k);
        x.getAllResponseHeaders = () => [...hdrs].map(([k, v]) => `${k}: ${v}`).join('\r\n');
      }
    };
    const finish = (...events) => {
      def('readyState', () => 4);
      for (const ev of ['readystatechange', ...events]) x.dispatchEvent(new ProgressEvent(ev));
    };
    if (isApi(u) || dropBody(u) !== null) {
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

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const ob = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (u, data) => (dropBody(u) !== null ? true : ob(u, data));
  }

  if (typeof window.open === 'function') {
    const oop = window.open;
    window.open = function (u) {
      if (u != null && blockedNav(u)) return null;
      return oop.apply(this, arguments);
    };
  }

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (s, t, url) {
      if (url && (String(url).includes('/verify/') || blockedNav(url))) return;
      return orig.apply(this, arguments);
    };
  }

  const scrubNode = (n) => {
    if (!n || typeof n.tagName !== 'string') return;
    const attr = n.tagName === 'LINK' ? 'href' : /^(?:SCRIPT|IFRAME|IMG)$/.test(n.tagName) ? 'src' : null;
    if (attr && n[attr] && blockedHost(n[attr])) n.removeAttribute(attr);
  };
  if (typeof Node !== 'undefined') {
    for (const fn of ['appendChild', 'insertBefore']) {
      const orig = Node.prototype[fn];
      Node.prototype[fn] = function (n) {
        scrubNode(n);
        return orig.apply(this, arguments);
      };
    }
  }
};

const disarm = () => {
  for (const l of document.querySelectorAll('link[rel~="dns-prefetch"][href], link[rel~="preconnect"][href]')) {
    try {
      if (BLOCKED_LINK_HOSTS.test(new URL(l.getAttribute('href'), location.origin).hostname)) l.removeAttribute('href');
    } catch {}
  }
  for (const box of document.querySelectorAll(HIDE_SEL)) {
    for (const n of box.querySelectorAll('a[href], img[src], img[srcset], source[srcset], iframe[src]')) {
      for (const a of ['href', 'src', 'srcset']) n.removeAttribute(a);
      if (n.tagName === 'A') {
        n.tabIndex = -1;
        n.setAttribute('aria-hidden', 'true');
      }
    }
  }
};

let disarmPending = false;
const scheduleDisarm = () => {
  if (disarmPending) return;
  disarmPending = true;
  Promise.resolve().then(() => {
    disarmPending = false;
    disarm();
  });
};

const boot = (root) => {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'x-dns-prefetch-control';
  meta.content = 'off';
  root.appendChild(meta);

  const s = document.createElement('script');
  s.textContent = `(${page})();`;
  root.appendChild(s);
  s.remove();

  const css = document.createElement('style');
  css.textContent = `
    div:has(> div > #HomePagePopupBannerSection), #HomePagePopupBannerSection { display: none !important; }
    html[data-peek-no-price] a[href*="-i."] .text-shopee-primary { visibility: hidden !important; }
    html[data-peek-no-price] .shopee-page-controller, html[data-peek-no-price] .shopee-mini-page-controller { display: none !important; }
    html:has(#HomePagePopupBannerSection), body:has(#HomePagePopupBannerSection) { overflow: auto !important; }
    ${HIDE_SEL} { display: none !important; }
  `;
  root.appendChild(css);

  disarm();
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    new MutationObserver(scheduleDisarm).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'srcset'],
    });
  }
};

const rootNow = document.head || document.documentElement;
if (rootNow) boot(rootNow);
else if (typeof MutationObserver !== 'undefined') {
  const mo = new MutationObserver(() => {
    const r = document.head || document.documentElement;
    if (r) {
      mo.disconnect();
      boot(r);
    }
  });
  mo.observe(document, { childList: true });
}

for (const ev of ['click', 'auxclick']) {
  document.addEventListener(ev, (e) => {
    if (e.target?.closest?.(HIDE_SEL)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}
