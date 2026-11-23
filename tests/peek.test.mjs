// node --test
// Each block guards a mistake that shipped at least twice; see the rule table in AGENTS.md.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { load, BLOCKED } from './harness.mjs';

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
