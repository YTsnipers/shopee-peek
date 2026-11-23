# AGENTS.md

Shopee Peek is one userscript, `shopee-peek.user.js`: no build step, no dependencies, no test suite. The block mechanism, data sources and request flow are in `docs/how-it-works.md`. Approaches that already failed, and why, are in `docs/investigation-log.md`; read it before proposing a new way around the login wall.

## Two execution contexts

The file runs in Tampermonkey's sandbox and injects `page()` into the page as an inline `<script>`.

| Context | Code | Can | Cannot |
|---|---|---|---|
| Sandbox (file top level) | `peek-req` / `peek-search-req` listeners, BigGo lookups, price box, fallback card | `GM_xmlhttpRequest` with a custom User-Agent and no cookies, to `@connect` hosts | patch the page's `fetch`, `XMLHttpRequest`, `history` |
| Page (`page()`) | `fetch` / XHR / `history` hooks, response rewriting | patch Shopee's globals; call Shopee APIs with the user's cookies | use `GM_*`; reference anything outside `page()`, because it is serialized with `${page}` |

The two sides talk through `document` CustomEvents whose `detail` is a JSON string, matched by `id`: `peek-req` → `peek-res`, `peek-search-req` → `peek-search-res`. Every request event gets exactly one reply, including on validation failure, network error and timeout; Shopee's pending request waits on that reply. Any page script can fire these events, so the sandbox validates input (numeric ids, non-negative integer page) before it sends a request.

## Invariants

- Act only on blocked responses, the ones where `blocked()` finds the standalone code `90309999`. Every other response, including all responses to logged-in users, passes through untouched.
- A rewritten response keeps the shape Shopee's components read. Several components crash on `data: null`; `STUB` and `RAW` in `page()` hold the shapes they need. When neutralising a new endpoint, check which fields the component reads and add a stub.
- The price box and the fallback card belong to one product. Gate them on `onItem(shop, item)` and drop late async results through the `priceSeq` counter.
- UI strings are Traditional Chinese. Console messages start with `[Shopee Peek]`; bug reports quote them.
- Grants stay at `GM_xmlhttpRequest` with `@connect shopee.tw` and `biggo.com.tw`. A new host needs its own `@connect` line.

## Hard-coded to Taiwan

`@match`, `@connect`, the `language=zhHant` cookie, the `biggo.com.tw` URLs, the BigGo index names `tw_mall_shopeemall` and `tw_bid_shopee`, and `currency: 'TWD'` in the search shim. A port to another region touches all of them. Whether the LINE User-Agent route works outside Taiwan is untested.

## Verify a change

1. `node --check shopee-peek.user.js`
2. Logged out, in a separate browser profile with Tampermonkey, open a product from a Google result: title, gallery, variants, description and shop details render, and the price box follows the selected variant.
3. Click through to another product inside Shopee (client-side navigation): the price box switches to the new product.
4. Search a keyword: page 1 shows 10 results with images, no prices and no paginator.
5. Logged in: product and search pages match what you see with the script disabled.

Loading many products in a short time triggers `/verify/captcha?scene=crawler_item` and rate limiting, so space manual tests out. To install a local edit, serve the file over local HTTP and open the `.user.js` URL so Tampermonkey runs its install flow; pasting into Tampermonkey's editor sometimes fails to save.

## Release

Bump `@version` in the header and add a `CHANGELOG.md` entry in Traditional Chinese. Users update from `main` through `@updateURL`, so merging to `main` is the release.
