# 運作原理

## 阻擋機制

未登入時 `GET /api/v4/pdp/get_pc` 回 `{"error": 90309999}`，前端以 `pushState` 導向 `/verify/traffic/error`。

## 資料來源

| 資料 | 來源 |
|---|---|
| 商品 | 以 LINE in-app UA 請求商品頁，SSR 內嵌 `PDP_BFF_DATA`，結構同 `get_pc.data`，但價格、評價、賣場欄位為 `null` |
| 賣場 | `/api/v4/shop/get_shop_base`（頁面環境呼叫時不受限） |
| 價格 | BigGo `/api/v1/spa/product/multiple?oid={shop}.{item}`；`history_id` 尾段即 `model_id` |

## 流程

1. `document-start` 注入頁面腳本，hook `fetch`、`XMLHttpRequest`、`history.pushState/replaceState`
2. `get_pc` 回 `90309999` 時，經 CustomEvent 請油猴環境以 `GM_xmlhttpRequest` 取得 BFF 資料，合併賣場資訊後作為回應交給前端，由原生元件渲染
3. 其餘 `90309999` 回應改寫為 `{"error":0,"data":null}`；導向 `/verify/` 的 `pushState` 一律丟棄
4. 依 `button.selection-box-selected` 推算 `model_id`，於標題下方渲染對應價格

已登入時 `get_pc` 正常回應，腳本不介入。

## 限制

- 銷量、評價、運送：伺服端移除，無替代來源
- 價格來自 BigGo 非公開 API，非即時
- 蝦皮停用 LINE SSR 或變更 BFF 結構即失效
