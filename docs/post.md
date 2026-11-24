# 開發與除錯貼文（繁體中文 / English）

## 繁體中文版

做了一個單檔、零相依套件的油猴腳本 Shopee Peek：從 Google 點進蝦皮台灣（shopee.tw）商品頁或站內搜尋時，不用登入就能用蝦皮原生版面看規格、多圖與 BigGo 參考價。

記錄幾個開發與除錯踩到的問題：

### 1. 單純擋跳轉沒用，因為前端根本沒拿到資料

未登入時蝦皮不是靠 HTTP 302 踢人，而是 `/api/v4/pdp/get_pc` 回 `90309999` 後由前端 `pushState` 換頁。只攔跳轉只會留下空白頁；後來發現 LINE 內建瀏覽器版的 SSR 仍內嵌同結構的 `PDP_BFF_DATA`，在 `document-start` 攔下 `fetch` 餵回前端，就能交給蝦皮原生元件渲染，再用 BigGo 規格 API 對應 `model_id` 補上各規格參考價。

### 2. 搜尋路線被封死後的轉向，與三個資料結構陷阱

原本搜尋靠社群預覽 UA 抓 `ItemList`，後來被伺服端封鎖固定回 403。v0.7.0 改從已白名單的 BigGo 取搜尋結果時連踩三個坑：

- 單一網址同時篩「蝦皮商城＋拍賣」時，商城會全排在前面（搜二手物只看得到商城書局），必須拆成兩路並行抓再交錯去重。
- 蝦皮前端 normalizer 用 `query_rewrite || {...}` 補狀態碼，傳空物件 `{}`（truthy）反而讓狀態變 `undefined` 而顯示無結果，傳 `null` 才會正常渲染。
- 未登入結果達 40 筆會出現「登入以查看更多」按鈕，壓在 35 筆（7 排 × 5 欄）剛好避開。

### 3. 實測最隱蔽的競態：新舊兩版腳本同時搶答

用自動化瀏覽器驗收新版時，`sessionStorage` 明明已寫進 50 筆搜尋資料，畫面卻還是「找不到結果」。追查 Redux 狀態才發現設定檔裡還裝著舊版 Tampermonkey 腳本：頁面發出單次 CustomEvent 後，舊版撞 403 秒回空陣列，搶在新版解析完前就把 Promise 結案了。後來改送一筆不發網路請求的 `{ page: -1 }` 檢查回覆數，零額度就能抓出重複掛載。

### 4. 用 Node 內建 `vm` 離線測油猴雙環境

為了不在每次改動時燒掉自己 IP 的瀏覽額度，專案用 Node 24 內建 `vm` 與 `node --test` 模擬沙盒與頁面橋接，把「只改寫 `90309999`、每個事件保證剛好回覆一次、切換商品不殘留舊價格」都寫成離線測試。

### 已知限制

- 銷量、評價、運費在伺服端已移除，未登入無法顯示；搜尋僅第 1 頁（最多 35 筆），價格為 BigGo 參考價非即時。
- 短時間連續開約 8 個商品頁會觸發 IP 限流（自動退回精簡商品卡，休息 30 分鐘至 2 小時恢復）。

Repo（MIT，含完整試錯紀錄 `docs/investigation-log.md`）：
https://github.com/YTsnipers/shopee-peek

---

## English Version

Built Shopee Peek — a single-file, zero-dependency Tampermonkey userscript that lets logged-out visitors view Shopee Taiwan (shopee.tw) product pages and first-page search results in Shopee's native UI, with per-variant reference prices from BigGo.

A few debugging lessons from building and maintaining it:

### 1. Blocking redirects leaves a blank shell because the API never sent data

Logged out, Shopee doesn't HTTP-redirect you; `/api/v4/pdp/get_pc` returns error `90309999` and the SPA calls `history.pushState` to `/verify/`. Blocking `pushState` alone leaves an empty page. Fetching the same URL with the LINE in-app browser User-Agent returns SSR HTML embedding `PDP_BFF_DATA` in the exact shape `get_pc` expects. Hooking `fetch` at `document-start` and swapping only `90309999` responses lets Shopee's own React components render the page untouched, while logged-in sessions pass through unchanged.

### 2. Surviving a blocked search route — and three subtle frontend/ranking traps

Search originally read `application/ld+json` `ItemList` via social-preview User-Agents (`facebookexternalhit`), until Shopee blocked them outright with HTTP 403. Moving search to BigGo (already in `@connect`) hit three traps:

- Querying Shopee Mall and Marketplace in one BigGo filter ranks all Mall listings ahead of individual sellers (searching for secondhand manga only returned Mall bookstores). Fetching `tw_mall_shopeemall` and `tw_bid_shopee` in parallel and interleaving by `oid` fixed relevance.
- Shopee's reducer normalizes `t.query_rewrite || { ..., fe_query_write_status: NORMAL }`. Returning `query_rewrite: {}` (truthy!) left `FEQueryWriteStatus` as `undefined` and rendered "No results"; returning `null` lets Shopee fill in `NORMAL`.
- Logged-out search results with `>= 40` items trigger a "Log in to see more" prompt; capping at 35 items (7 full 5-card rows) avoids it.

### 3. A fast-failing race between two copies of the same userscript

During live browser verification, `sessionStorage` showed 50 parsed items, yet the page still rendered "No results". Inspecting Redux revealed the browser profile still had the old v0.6.0 Tampermonkey script active alongside the injected v0.7.0 build. Both listened to the `peek-search-req` CustomEvent: the old script hit Shopee's 403 and replied `[]` in ~300ms, resolving the page's one-shot Promise before BigGo returned. Firing a no-network `{ page: -1 }` probe and asserting a single reply now catches duplicate instances without spending IP quota.

### 4. Testing dual-world userscripts offline with Node's `vm`

Live tests spend your own IP's rate-limit quota on Shopee. All invariants (pass-through when not `90309999`, exactly-once bridge replies on errors/timeouts, `claim()` ownership across rapid SPA navigation) run offline in ~1s via Node 24's built-in `vm` and `node --test`.

### Known limits

- Units sold, reviews, and shipping are stripped server-side when logged out; search is page 1 only (up to 35 items), and BigGo prices can lag behind live prices.
- Opening ~8 product pages in 10 minutes triggers temporary IP rate limiting (falls back to a plain BigGo card; lifts after 30m–2h).

Repo (MIT, full dead-end log in `docs/investigation-log.md`):
https://github.com/YTsnipers/shopee-peek
