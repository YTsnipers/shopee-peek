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
| 搜尋結果 | 以 `facebookexternalhit` UA 請求 `/search?keyword=`，解析 `application/ld+json` 的 `ItemList`（每頁 10 筆：標題、圖片、網址） |

## 流程

1. `document-start` 注入頁面腳本，hook `fetch`、`XMLHttpRequest`、`history.pushState/replaceState`；`/api/` 的 XHR 一律轉交 fetch 攔截流程
2. `get_pc` 回 `90309999` 時，經 CustomEvent 請油猴環境以 `GM_xmlhttpRequest` 取得 BFF 資料，合併賣場資訊後作為回應交給前端，由原生元件渲染
3. `search_items` 回 `90309999` 時，同樣經 CustomEvent 取得 `ItemList`，轉成 `search_items` 格式交給原生搜尋頁；隱藏價格與分頁器
4. 其餘 `90309999` 回應改寫為 `{"error":0,"data":null}`，元件會讀取的欄位（如 `search_suggestion.queries`）補空陣列；導向 `/verify/` 的 `pushState` 一律丟棄
5. 依 `button.selection-box-selected` 推算 `model_id`，於標題下方渲染對應價格
6. LINE 版拿不到資料（多半是 IP 限流）時，蓋上全頁備援商品卡：標題取自網址或搜尋結果，圖片與價格取自 BigGo

已登入時 API 不會回 `90309999`，腳本不替換任何資料。

## 限制

- 銷量、評價、運送：伺服端移除，無替代來源
- 價格來自 BigGo 非公開 API，非即時
- 搜尋只有第 1 頁且無價格：蝦皮前端禁止未登入翻頁，`ItemList` 不含價格
- 導向 `/verify/` 的頁內跳轉（含驗證碼頁）一律丟棄，登入狀態也一樣
- 蝦皮停用 LINE SSR、變更 BFF 結構，或拿掉搜尋頁的 `ItemList` 即失效
