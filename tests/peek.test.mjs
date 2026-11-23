// node --test
// Each block guards a mistake that shipped at least twice; see the rule table in AGENTS.md.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { load, BLOCKED, pdpHtml } from './harness.mjs';

// A hang is a failure: Shopee's request waits forever on a bridge that never replies.
const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);

const respond = (body) => async () => new Response(body, { headers: { 'content-type': 'application/json' } });

// Rule: only blocked responses are rewritten (0.5.1, 0.5.3, 0.6.0 each shipped a violation).
test('passes a non-blocked API response through as the same object', async () => {
  const original = new Response('{"error":0,"data":{"itemid":190309999,"name":"x"}}');
  const { ctx } = load({ fetch: async () => original });
  const r = await ctx.window.fetch('/api/v4/pdp/get_pc?shop_id=1&item_id=190309999');
  assert.equal(r, original);
});

test('a block code inside a longer number is not a block', async () => {
  const { ctx } = load({ fetch: respond('{"error":0,"data":{"shopid":903099991,"price":1903099990}}') });
  const r = await ctx.window.fetch('/api/v4/shop/get_shop_base?shopid=903099991');
  assert.match(await r.text(), /1903099990/);
});

test('passes non-API requests through untouched', async () => {
  const original = new Response(BLOCKED);
  const { ctx } = load({ fetch: async () => original });
  assert.equal(await ctx.window.fetch('/static/app.js'), original);
});

test('rewrites a blocked API to the empty shape components read', async () => {
  const { ctx } = load({ fetch: respond(BLOCKED) });
  const plain = await (await ctx.window.fetch('/api/v4/item/get_ratings?itemid=1')).json();
  assert.deepEqual(plain, { error: 0, error_msg: null, data: null });
  const stub = await (await ctx.window.fetch('/api/v4/search/search_suggestion?keyword=a')).json();
  assert.deepEqual(stub.data, { queries: [] });
});

test('an XHR to a non-blocked API sees the original body and status', async () => {
  const body = '{"error":0,"data":{"itemid":190309999}}';
  const { ctx } = load({ fetch: async () => new Response(body, { status: 201 }) });
  const x = new ctx.XMLHttpRequest();
  const done = new Promise((resolve) => x.addEventListener('load', resolve));
  x.open('GET', '/api/v4/pdp/get_pc?shop_id=1&item_id=2');
  x.send();
  await done;
  assert.equal(x.responseText, body);
  assert.equal(x.status, 201);
});

// Rule: every bridge request gets exactly one reply (0.5.3 and 0.6.0 each fixed a hang).
const once = async (gm, req, res, detail) => {
  const { replies } = load({ path: '/x-i.1.23', gm });
  const got = await replies(req, res, detail);
  assert.equal(got.length, 1, `${req} replied ${got.length} times`);
  assert.equal(got[0].id, detail.id);
  return got[0];
};

for (const [name, gm] of [
  ['network error', (o) => o.onerror()],
  ['timeout', (o) => o.ontimeout()],
  ['GM throws', () => { throw new Error('boom'); }],
  ['HTML without data', (o) => o.onload({ status: 200, responseText: '<html></html>' })],
  ['malformed embedded JSON', (o) => o.onload({ status: 200, responseText: '<script type="text/mfe-initial-data">{oops</script>' })],
]) {
  test(`product request replies once with no entry on ${name}`, async () => {
    const d = await once(gm, 'peek-req', 'peek-res', { id: 7, shop: '1', item: '23' });
    assert.equal(d.entry, null);
  });
  test(`search request replies once with no items on ${name}`, async () => {
    const d = await once(gm, 'peek-search-req', 'peek-search-res', { id: 8, keyword: 'a', page: 0 });
    assert.deepEqual(d.items, []);
  });
}

// Rule: a route Shopee blocks says so in the console, so nobody has to call Shopee by hand to
// tell a block from a script bug (search 403s were only diagnosable with curl before).
test('a blocked search page is logged with its HTTP status', async () => {
  const gm = (o) => o.onload({ status: 403, responseText: BLOCKED });
  const { replies, logs } = load({ gm });
  await replies('peek-search-req', 'peek-search-res', { id: 3, keyword: 'a', page: 0 });
  assert.ok(logs.some((l) => l.includes('[Shopee Peek]') && l.includes('403')), `logs: ${JSON.stringify(logs)}`);
});

test('invalid bridge input replies once without a request', async () => {
  let calls = 0;
  const gm = () => calls++;
  assert.equal((await once(gm, 'peek-req', 'peek-res', { id: 1, shop: '1/../x', item: '2' })).entry, null);
  assert.deepEqual((await once(gm, 'peek-search-req', 'peek-search-res', { id: 2, keyword: 'a', page: -1 })).items, []);
  assert.equal(calls, 0);
});

test('a blocked product page is answered from the LINE entry', async () => {
  const entry = { item: { title: 'T', models: [], tier_variations: [] }, shop_detailed: { name: null } };
  const fetch = async (u) => new Response(String(u).includes('get_shop_base') ? '{"data":{"name":"S"}}' : BLOCKED);
  const gm = (o) => o.onload({ status: 200, responseText: pdpHtml('1', '23', entry) });
  const { ctx } = load({ path: '/x-i.1.23', gm, fetch });
  const body = await (await ctx.window.fetch('/api/v4/pdp/get_pc?shop_id=1&item_id=23')).json();
  assert.equal(body.data.item.title, 'T');
  assert.equal(body.data.shop_detailed.name, 'S');
});

test('a blocked product page with no LINE data keeps Shopee\'s response instead of hanging', async () => {
  const { ctx } = load({ path: '/x-i.1.23', gm: (o) => o.onerror(), fetch: async () => new Response(BLOCKED) });
  const r = await ctx.window.fetch('/api/v4/pdp/get_pc?shop_id=1&item_id=23');
  assert.match(await r.text(), /90309999/);
});

// Rule: product UI belongs to one product (0.6.0 fixed four leaks: stale price, price box on other
// pages, ID prefix match, neighbouring BigGo price). Async work writes only while claim() holds.
test('an item id that is a prefix of the current one is a different product', () => {
  const { get, ctx } = load({ path: '/x-i.1.234' });
  const onItem = get('onItem');
  assert.equal(onItem('1', '23'), false);
  assert.equal(onItem('1', '234'), true);
  ctx.location.pathname = '/product/1/23';
  assert.equal(onItem('1', '23'), true);
  assert.equal(onItem('1', '2'), false);
});

// Routes GM requests by URL. LINE answers for any item (or fails when entry is undefined);
// BigGo variant lookups price item N at $N and wait until release() runs them, newest first.
const network = (entry) => {
  const held = [];
  const gm = (o) => {
    const line = o.url.match(/shopee\.tw\/product\/(\d+)\/(\d+)/);
    if (line) return entry === undefined ? held.push(() => o.onerror()) : o.onload({ status: 200, responseText: pdpHtml(line[1], line[2], entry) });
    const oid = o.url.match(/product\/multiple\?.*oid=\d+\.(\d+)/);
    if (oid) return held.push(() => o.onload({ status: 200, responseText: JSON.stringify({ list: [{ title: 'v', price: Number(oid[1]), is_offline: false, history_id: 'x-9' }] }) }));
    o.onerror();
  };
  return { gm, release: async () => { held.splice(0).reverse().forEach((f) => f()); await new Promise((r) => setTimeout(r, 20)); } };
};

test('a late BigGo price for the previous product does not replace the current one', async () => {
  const net = network({ item: { title: 'T', models: [], tier_variations: [] } });
  const { ctx, get, replies } = load({ path: '/a-i.1.100', gm: net.gm });
  await replies('peek-req', 'peek-res', { id: 1, shop: '1', item: '100' });
  ctx.location.pathname = '/b-i.1.200';
  await replies('peek-req', 'peek-res', { id: 2, shop: '1', item: '200' });
  await net.release();
  assert.equal(get('priceState').text, '$200');
});

test('a late fallback card for the previous product is not shown on the next one', async () => {
  const net = network(undefined);
  const { ctx, mounted, replies } = load({ path: '/a-i.1.23', gm: net.gm });
  const pending = replies('peek-req', 'peek-res', { id: 1, shop: '1', item: '23' }, 0);
  ctx.location.pathname = '/b-i.9.99';
  await net.release();
  await pending;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(mounted.filter((n) => n.id === 'peek-fallback').length, 0);
});
