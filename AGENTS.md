# AGENTS.md

Shopee Peek is one userscript, `shopee-peek.user.js`: no build step, no dependencies. Offline tests in `tests/` run it in a Node `vm` with fake browser and Tampermonkey globals. The block mechanism, data sources and request flow are in `docs/how-it-works.md`. Approaches that already failed, and why, are in `docs/investigation-log.md`; read it before proposing a new way around the login wall.

## Two execution contexts

The file runs in Tampermonkey's sandbox and injects `page()` into the page as an inline `<script>`.

| Context | Code | Can | Cannot |
|---|---|---|---|
| Sandbox (file top level) | `peek-req` / `peek-search-req` listeners, BigGo lookups, price box, fallback card | `GM_xmlhttpRequest` with a custom User-Agent and no cookies, to `@connect` hosts | patch the page's `fetch`, `XMLHttpRequest`, `history` |
| Page (`page()`) | `fetch` / XHR / `history` hooks, response rewriting | patch Shopee's globals; call Shopee APIs with the user's cookies | use `GM_*`; reference anything outside `page()`, because it is serialized with `${page}` |

The two sides talk through `document` CustomEvents whose `detail` is a JSON string, matched by `id`: `peek-req` → `peek-res`, `peek-search-req` → `peek-search-res`. Every request event gets exactly one reply, including on validation failure, network error and timeout; Shopee's pending request waits on that reply. Any page script can fire these events, so the sandbox validates input (numeric ids, non-negative integer page) before it sends a request.

Each of these has one supported way; a new request or network call uses it instead of a hand-written listener:

| Job | Use |
|---|---|
| Answer a page request in the sandbox | `serve(req, res, empty, handler)`: replies exactly once, with `empty` when the handler throws |
| Send a request from `page()` | `ask(req, res, payload)` |
| Call `GM_xmlhttpRequest` | `gm(url, ua)`: resolves to the response, or `null` on error or timeout |
| Write product UI after an `await` | `const alive = claim(shop, item)`, then `if (!alive()) return` after every `await` |

## Invariants

- Act only on blocked responses, the ones where `blocked()` finds the standalone code `90309999`. Every other response, including all responses to logged-in users, passes through untouched.
- A rewritten response keeps the shape Shopee's components read. Several components crash on `data: null`; `STUB` and `RAW` in `page()` hold the shapes they need. When neutralising a new endpoint, check which fields the component reads and add a stub.
- The price box and the fallback card belong to one product. `claim(shop, item)` is the only owner of which product is on screen; its `alive()` is false once the URL leaves the product or a newer product claims the screen.
- UI strings are Traditional Chinese. Console messages start with `[Shopee Peek]`; bug reports quote them.
- Grants stay at `GM_xmlhttpRequest` with `@connect shopee.tw` and `biggo.com.tw`. A new host needs its own `@connect` line.

## Hard-coded to Taiwan

`@match`, `@connect`, the `language=zhHant` cookie, the `biggo.com.tw` URLs, the BigGo index names `tw_mall_shopeemall` and `tw_bid_shopee`, and `currency: 'TWD'` in the search shim. A port to another region touches all of them. Whether the LINE User-Agent route works outside Taiwan is untested.

## Verify a change

1. Run the offline checks. CI runs the same command.

   ```sh
   node --check shopee-peek.user.js && node --test
   ```

2. Logged out, in a separate browser profile with Tampermonkey, open a product from a Google result: title, gallery, variants, description and shop details render, and the price box follows the selected variant.
3. Click through to another product inside Shopee (client-side navigation): the price box switches to the new product.
4. Search a keyword: page 1 shows 10 results with images, no prices and no paginator.
5. Logged in: product and search pages match what you see with the script disabled.

Steps 2 to 5 hit Shopee from the user's own IP and spend the quota they browse with. The product and search routes have separate quotas; the measured limits and recovery times live only in the README's "Rate limiting" section, so read them there. Cover a change with an offline test first; tell the user before any live request and keep it to the steps the change touches. Loading many products in a short time triggers `/verify/captcha?scene=crawler_item` and rate limiting, so space manual tests out. To install a local edit, serve the file over local HTTP and open the `.user.js` URL so Tampermonkey runs its install flow; pasting into Tampermonkey's editor sometimes fails to save.

When reporting a live test, open with a one-sentence verdict in plain language, then keep two causes apart: the script failed, or Shopee blocked or rate-limited the route (HTTP 403 with `90309999`, or HTTP 200 with an empty `cachedMap`). A rate-limited run proves nothing about the normal path; say which steps it left untested. Tell the causes apart from the `[Shopee Peek]` console lines (each blocked route logs its status), not by calling Shopee with curl: that spends the same quota.

A live test that shows something new about Shopee's limits (a status code, a trigger count, a recovery time, a route that stays blocked) goes into the "Rate limiting" section of all three READMEs in the same change, each in its own language. Label a guess "unverified" and give the observation it rests on.

## Rules and what enforces them

| Rule | Enforced by |
|---|---|
| Rewrite only responses where `blocked()` matches the standalone `90309999` | `tests/`: pass-through and longer-number tests |
| Every bridge request gets exactly one reply | `serve()` owns the reply; `tests/`: error, timeout, throw and malformed-data tests |
| Product UI writes only for the product on screen | `claim()` owns it; `tests/`: id-prefix, late-price and late-fallback tests |
| Rewritten responses keep the shape components read | `tests/`: stub-shape test for `search_suggestion`; new stubs need their own case |
| Don't spend the user's IP quota on checks a fixture can do | Judgment: this file, "Verify a change" |
| Live-test reports lead with a verdict and separate script failure from Shopee blocking | Judgment: this file, "Verify a change" |
| A route Shopee blocks says so in the console with its status | `tests/`: blocked-search log test; a new route needs its own case |
| New observations about Shopee's limits go into all three READMEs' "Rate limiting" section | Judgment: this file, "Verify a change"; AGENTS.md links there instead of copying the numbers |

## Release

Bump `@version` in the header and add a `CHANGELOG.md` entry in Traditional Chinese. Users update from `main` through `@updateURL`, so merging to `main` is the release.
