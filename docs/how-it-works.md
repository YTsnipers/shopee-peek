# 運作原理

## 阻擋機制

未登入時 `GET /api/v4/pdp/get_pc` 回 `{"error": 90309999}`，前端以 `pushState` 導向 `/verify/traffic/error`。搜尋（`search_items`）、評價、推薦等 API 同樣回 `90309999`。

## 資料來源

| 資料 | 來源 |
|---|---|
| 商品 | 以 LINE in-app UA 請求商品頁，SSR 內嵌 `PDP_BFF_DATA`，結構同 `get_pc.data`，但價格、評價、賣場欄位為 `null` |
| 賣場 | `/api/v4/shop/get_shop_base`（頁面環境呼叫時不受限） |
| 價格 | BigGo `/api/v1/spa/product/multiple?oid={shop}.{item}`；`history_id` 尾段即 `model_id` |
| 價格（單一規格） | BigGo 搜尋頁 `/s/{商品標題}`，以 `id={shop}.{item}` 找到商品卡再取價格 |
| 搜尋結果 | BigGo `/s/{關鍵字}?m=cp&c[]=...`，並行取 `tw_mall_shopeemall` 與 `tw_bid_shopee` 的 `ssrData.list` 交錯合併（每頁最多 35 筆：標題、圖片、商品 ID） |

## 流程

1. `document-start` 注入頁面腳本，hook `fetch`、`XMLHttpRequest`、`history.pushState/replaceState`；`/api/` 的 XHR 一律轉交 fetch 攔截流程
2. `get_pc` 回 `90309999` 時，經 CustomEvent 請油猴環境以 `GM_xmlhttpRequest` 取得 BFF 資料，合併賣場資訊後作為回應交給前端，由原生元件渲染
3. `search_items` 回 `90309999` 時，同樣經 CustomEvent 向 BigGo 取得蝦皮商城與拍賣搜尋結果，轉成 `search_items` 格式（上限 35 筆以避開未登入 40 筆的「登入以查看更多」提示，`query_rewrite: null` 讓前端標記為正常結果）交給原生搜尋頁；隱藏價格與分頁器
4. 其餘 `90309999` 回應改寫為 `{"error":0,"data":null}`，元件會讀取的欄位（如 `search_suggestion.queries`）補空陣列；導向 `/verify/` 的 `pushState` 一律丟棄
5. 依 `button.selection-box-selected` 推算 `model_id`，於標題下方渲染對應價格
6. LINE 版拿不到資料（多半是 IP 限流）時，蓋上全頁備援商品卡：標題與圖片取自搜尋快取或 BigGo，價格取自 BigGo
7. 介面與請求封鎖：注入 `x-dns-prefetch-control: off` 關閉連結預解析，隱藏並移除頁首雜項（保留語言、註冊、登入與帳號）、搜尋框下方熱搜詞與全站頁尾的 `href`／`src`／`srcset`；在 `fetch`／`XHR`／`sendBeacon` 發送前直接攔截 `get_footer_layout`、`/backend/CMS/footer/`、`search_prefills`、`search_suggestion?bundle=popsearch`、`notification/*` 與外連子網域，另附 `filters.txt` 供 Brave Shields、uBlock Origin 或 AdGuard 於瀏覽器網路層攔截

除上述無用區塊請求外，已登入時其餘 API 不會回 `90309999`，腳本不替換商品與搜尋資料。

## 限制

- 銷量、評價、運送：伺服端移除，無替代來源
- 價格與搜尋結果來自 BigGo，非即時，搜尋排序依 BigGo 相關度而非蝦皮站內排序
- 搜尋只有第 1 頁且不顯示價格：蝦皮前端禁止未登入翻頁，搜尋卡價格容易混入佔位規格故維持隱藏
- 導向 `/verify/` 的頁內跳轉（含驗證碼頁）一律丟棄，登入狀態也一樣
- 蝦皮停用 LINE SSR、變更 BFF 結構，或 BigGo 變更 `ssrData` 結構即失效
