# 運作原理

## 蝦皮的擋法

```
商品頁載入 → 前端呼叫 /api/v4/pdp/get_pc
→ 未登入：伺服器回 {"error": 90309999}
→ 前端 history.pushState 到 /verify/traffic/error?is_logged_in=false
→ 畫出「請登入」頁
```

## 資料來源

用 LINE 內建瀏覽器的 User-Agent 請求商品頁時，伺服器會把商品資料寫進 HTML：

```html
<script type="text/mfe-initial-data">{"initialState": {"DOMAIN_PDP": {"data": {"PDP_BFF_DATA": ...}}}}</script>
```

`PDP_BFF_DATA.cachedMap[currentKey]` 的格式與 `get_pc` 回應的 `data` 欄位一致，但 `product_price`、`product_review` 的數值和 `shop_detailed` 被清空。

## 腳本流程

| 步驟 | 執行位置 | 做什麼 |
|---|---|---|
| 1 | 油猴環境 | 沒有 `language` cookie 時設為 `zhHant`，避免語言選擇框 |
| 2 | 頁面環境 | `document-start` 注入攔截器，改寫 `fetch`、`XMLHttpRequest`、`history.pushState/replaceState` |
| 3 | 頁面環境 | 攔到 `get_pc` → 發 `peek-req` 事件 |
| 4 | 油猴環境 | 收到事件 → `GM_xmlhttpRequest` 用 LINE UA 抓商品頁 → 解析 BFF 資料 → 發 `peek-res` 事件 |
| 5 | 頁面環境 | 呼叫 `/api/v4/shop/get_shop_base` 補賣場資訊 → 把組好的資料當成 `get_pc` 回應交給蝦皮 |
| 6 | 頁面環境 | 其他 API 回 `90309999` 時換成 `{"error":0,"data":null}`，避免觸發錯誤頁 |
| 7 | 頁面環境 | 擋下所有往 `/verify/` 的 `pushState/replaceState` |

## 為什麼分兩個執行環境

- 只有油猴環境能用 `GM_xmlhttpRequest` 自訂 User-Agent
- 只有頁面環境能改寫蝦皮使用的 `fetch` 和 `XMLHttpRequest`
- 兩邊用 `document` 上的 CustomEvent 溝通

## 已知限制

- 價格、銷量、評價、運送：伺服器端移除，無其他來源
- 蝦皮取消 LINE 預先渲染或改 BFF 格式時失效
