# Shopee Peek

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

A userscript for viewing Shopee Taiwan (shopee.tw) product pages without logging in. Products render in Shopee's own page layout, with a BigGo reference price under the title.

[![Install with Tampermonkey](https://img.shields.io/badge/Install-Tampermonkey-00485B?logo=tampermonkey&logoColor=white)](https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js)
![Site: shopee.tw](https://img.shields.io/badge/site-shopee.tw-EE4D2D)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| Without the script: login wall | With the script: Shopee's own product page |
|---|---|
| <img src="docs/before.png" width="300"> | <img src="docs/after.png" width="520"> |

## What you see while logged out

| Visible | Not visible |
|---|---|
| Title, image gallery | Units sold |
| Variant options | Ratings and reviews |
| Spec table, description | Shipping options and fees |
| Shop name, response rate, followers | Live prices (BigGo can lag behind) |
| BigGo reference price per variant, follows your selection | Search pages after the first, prices in search results |
| Search results, first page (10 items with image and title); may currently be broken, see Rate limiting | |

Shopee removes units sold, reviews and shipping from logged-out responses on its servers, and no other source for them has turned up. Items BigGo hasn't indexed show 「查無價格」 ("no price found").

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Chrome, Brave or Edge: open `chrome://extensions` → Tampermonkey → Details → turn on **Allow User Scripts**.
3. Open [shopee-peek.user.js](https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js); Tampermonkey shows its install page.

Tampermonkey installs later versions automatically.

## Supported

- Site: shopee.tw only
- Tested: Brave + Tampermonkey. Untested: Chrome, Edge, Firefox, Violentmonkey.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Still sent to the login page | Tampermonkey can't run user scripts yet, or Shopee changed its site | Check install step 2; if it's on, open an issue |
| A plain card with only title, image and price | Shopee is rate-limiting your IP, so the full product data isn't available | Wait a while, then reload |
| 「查無價格」 under the title | BigGo hasn't indexed this item | Nothing to fix; the rest of the page works |
| Shopee wants a captcha but the page never shows it | The script drops every in-page redirect to `/verify/`, logged in or not | Disable the script for that visit |

To report a bug, open the DevTools console, filter on `[Shopee Peek]`, and paste those lines into an issue with the product URL.

### Rate limiting

Shopee limits how often one IP can load pages through the routes the script uses. What each limit looks like:

| Route | When limited | What you see |
|---|---|---|
| Product data (LINE User-Agent) | HTTP 200, but the embedded data's `cachedMap` is empty | The plain BigGo card instead of the full product page; the console logs `[Shopee Peek] LINE 版回傳空資料` |
| Search (social-preview User-Agents) | `facebookexternalhit`, `Twitterbot` and `Googlebot` all get HTTP 403 with `90309999` | The search page shows 「找不到結果」 ("no results") |
| Home feed | Shopee returns empty data; the script doesn't cause this | 「每日新發現」 (Daily Discover) on the home page is empty when the limit widens |

- Trigger and recovery: earlier tests hit the limit after about 8 product pages in 10 minutes, and it lifted after about 30 minutes. In a later test, after 65 minutes with no requests, product pages still showed the plain card and search still showed no results; the home feed had come back. In the test after that, about 1.5 hours with no requests, product pages were back to the full page; search, more than 3 hours after it was first blocked, still got HTTP 403 with `90309999`.
- Guess (unverified): search may not be rate-limited but blocked outright: Shopee may have shut out the social-preview User-Agent the script searches with. Product pages recovered within 1.5 hours while search stayed blocked for more than 3. If search keeps getting 403, the search feature is effectively broken.
- Space out manual tests, and don't open many products in a row.
- Once product pages are limited, wait 30 minutes to 2 hours before trying again. For search, see the guess above.

## How it works

Logged out, Shopee's product API (`/api/v4/pdp/get_pc`) answers with error `90309999`, and the frontend then redirects to the login wall. The script:

1. Hooks the page's `fetch`, `XMLHttpRequest` and `history` at `document-start`.
2. On a blocked `get_pc`, fetches the same product page with the LINE in-app browser's User-Agent. That version embeds product data in the same shape as `get_pc`, which the script hands to Shopee's frontend.
3. Fills in shop details from `get_shop_base`, answers the other blocked APIs with empty data, and drops redirects to `/verify/`.
4. Looks up per-variant prices on BigGo and shows them under the title.
5. On a blocked search, reads the search page's `ItemList` structured data and feeds it to Shopee's search page.

Logged in, Shopee's APIs never return `90309999`, so the script replaces no data.

Details: [docs/how-it-works.md](docs/how-it-works.md). What was tried and why it failed: [docs/investigation-log.md](docs/investigation-log.md). Both in Traditional Chinese.

## For AI assistants

- [`llms.txt`](llms.txt): purpose, behaviour, limits and file map in one file. To ask an AI chat about this project, give it `https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/llms.txt`.
- [`AGENTS.md`](AGENTS.md): code layout, invariants and a manual test checklist for coding agents that edit the script.

## Contributing

Issues and PRs are welcome. To port the script to another Shopee region, start from the "Hard-coded to Taiwan" list in [`AGENTS.md`](AGENTS.md); whether the LINE User-Agent route works outside Taiwan is untested.

If the script saved you a login, a star helps other people find it.

## Disclaimer

This script is for personally viewing publicly available product information and is not affiliated with Shopee or its affiliates. It depends on how the site works today and may break after any site update; the author doesn't guarantee it keeps working. Users should weigh the risks and follow the site's terms of service; the author accepts no responsibility for any consequence of using the script.

## License

[MIT](LICENSE)
