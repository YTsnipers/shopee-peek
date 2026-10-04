# 除錯日誌

記錄試過的方法、失敗原因與判斷修正。依時間順序排列。

## 1. 摸清擋法

| 觀察 | 結論 |
|---|---|
| 未登入時被導到「請登入」頁 | 網址其實是 `/verify/traffic/error?is_logged_in=false&next=...`，屬於防機器人頁 |
| 商品頁先閃一下才被導走 | 前端呼叫 `/api/v4/pdp/get_pc`，伺服器回 `{"error": 90309999}`，約 0.2 秒後前端用 `history.pushState` 換網址並畫出錯誤頁 |
| 逐一呼叫商品相關 API | `get_pc`、`pdp/get`、`pdp/get_rw`、`item/get`、`search_items`、`get_ratings`、`hot_sales`、`rcmd_items`、`recommend` 全部回 `90309999` 或 403 |
| `get_shop_base` | 在頁面內呼叫時開放（需帶蝦皮 cookie）；用 curl 直接呼叫會被拒 |

## 2. 換 User-Agent

| UA | 結果 |
|---|---|
| iOS Safari（瀏覽器內建的 UA 切換） | 手機版一樣被擋 |
| Googlebot、Bingbot、Twitterbot、TelegramBot | 回 `90309999` JSON |
| facebookexternalhit、WhatsApp | 只拿到首頁標題的 og 標籤 |
| Slackbot、Discordbot | 回完整 HTML，但沒有商品資料 |
| **iPhone + LINE 內建瀏覽器**（`... Line/14.0.0`） | **回傳含商品資料的完整頁面**，資料在 `<script type="text/mfe-initial-data">` |

LINE 版資料的限制：`product_price` 為 `null` 且列在 `removed_fields`，`product_review` 數值、`shop_detailed`、`product_shipping` 皆為 `null`。

## 3. 攔截跳轉

| 嘗試 | 結果 | 原因 |
|---|---|---|
| Firefox `redirection-limit`、封鎖自動重新整理（他人回報） | 無效 | 只擋 HTTP 3xx 與 meta refresh，蝦皮用 JS 換網址 |
| 關閉 JavaScript | 連商品都不顯示 | 頁面由 JS 畫出 |
| 油猴腳本攔 `/buyer/login` | 無效 | 實際目的地是 `/verify/` |
| 改成攔 `/verify/`（Navigation API + 改寫 `pushState`） | 網址留住，畫面空白 | 前端沒拿到資料，攔跳轉只留下空殼 |
| Brave 自訂過濾器擋 `pcmall-antifrauderror` | 整頁白畫面 | 商品畫面已先被清掉，前端卡在等錯誤頁模組 |
| 關閉 Brave Shields | 無差別 | 判斷在伺服器端，與瀏覽器擋追蹤器無關 |

另外遇到的環境問題：新版 Chromium 的 Tampermonkey 必須在擴充功能頁打開「允許使用者腳本」才會執行。

## 4. 改寫畫面（v0.1 → v0.2）

| 問題 | 原因 | 解法 |
|---|---|---|
| 要在不換網址的情況下顯示資料 | 網址列與 DOM 互相獨立 | `GM_xmlhttpRequest` 背景抓 LINE 版頁面，直接替換 `document.documentElement` |
| `window.stop()` 後畫不出內容 | 停止載入時 `<html>` 元素尚未建立；`document.write` 也無效 | 先 `appendChild(createElement('html'))` 再寫入 |
| 從站內點商品時腳本沒反應 | 單頁應用站內換頁不會重新載入，腳本只在載入時執行一次（線索：網址帶 `sp_atk`、`extraParams`，是站內連結參數） | 每 0.2 秒檢查網址，遇到 `/verify/` 就從 `next` 參數取回商品網址 |

## 5. 模擬原生介面（v0.3）

| 問題 | 原因 | 解法 |
|---|---|---|
| 簡易頁不易閱讀 | 自行排版 | 發現 `PDP_BFF_DATA.cachedMap[currentKey]` 與 `get_pc` 回應格式一致，改成攔下 `get_pc` 回傳這份資料，由蝦皮自己的程式渲染 |
| 油猴腳本改寫不到頁面的 `fetch` | 油猴腳本在隔離環境執行 | 注入 `<script>` 到頁面環境；需要自訂 UA 的請求透過 CustomEvent 交給油猴環境 |
| CSP 是否擋注入 | — | 檢查回應標頭，CSP 只有 `frame-ancestors`，不影響 |
| 塞入資料後仍顯示錯誤頁 | `get_ratings`、`hot_sales/get_item_cards` 也回 `90309999`，同樣觸發錯誤頁 | 所有含 `90309999` 的 API 回應換成 `{"error":0,"data":null}` |
| 賣場資訊空白 | LINE 版清空 `shop_detailed` | 頁面內呼叫 `get_shop_base`，填回空欄位 |
| 首次瀏覽跳出語言選擇框 | 缺少 `language` cookie | 未設定時寫入 `language=zhHant` |

## 6. 補上價格（v0.4 → v0.5）

| 問題 | 原因 | 解法 |
|---|---|---|
| 官方 API 不給價格 | 伺服器端移除 | 改用比價網站 BigGo 的資料 |
| BigGo 搜尋 API 拒絕直接呼叫 | 回 `Please use correct method.` | 先解析搜尋結果頁 HTML，用 `id=賣場ID.商品ID` 精準比對 |
| 價格顯示 `$4690` | 卡片上 `$469` 與回饋率 `0~10%` 文字相連 | 只取內容剛好是價格的元素 |
| 使用者瀏覽器看不到價格框 | 標題外層是 `overflow:hidden` + `line-clamp:2` 的容器，窄視窗下價格框被裁掉 | 往外找到第一個不裁切的祖先再插入 |
| 區間 `$300 ~ $1,000` 不準 | 混入已下架的佔位規格 | 錄下 BigGo 下拉選單的請求，找到公開的規格 API，濾掉 `is_offline` |
| 點規格要換價格 | — | `history_id` 結尾等於蝦皮 `model_id`，由選中的按鈕換算規格索引後對應 |
| 登入使用者的價格被蓋掉 | 無條件替換 `get_pc` | 只在回應 `90309999` 時替換 |

## 7. 測試方法

- 新版 Chromium 禁止對預設設定檔開啟遠端除錯埠，改為另開獨立設定檔的除錯模式瀏覽器，透過 Chrome DevTools Protocol 錄製請求、回應與畫面
- 為了測試真實的 Tampermonkey 行為，只複製 Tampermonkey 的擴充功能資料到獨立設定檔
- 短時間大量載入商品頁會觸發 `/verify/captcha?scene=crawler_item`，之後改用模擬（直接 `pushState` 到 `/verify/`）測試站內換頁
- 編輯器貼上更新失敗時（Dashboard 顯示的大小沒變），改用本機 HTTP 伺服器提供 `.user.js`，讓 Tampermonkey 走安裝流程

## 8. 判斷錯誤與修正

| 原本的判斷 | 實際 |
|---|---|
| 改 UA 成 iPhone 可能可行 | 無效 |
| 伺服器完全不送資料，前端無計可施 | 桌面版不送，LINE 版會送 |
| Brave 擋掉安全模組回報才被判成機器人 | 無關 |
| 使用者瀏覽器有快取，蝦皮 JS 比腳本先跑 | 實際原因是站內換頁 |
| 價格框不見是 VPN 擋了 BigGo | Console 顯示價格有抓到，是被裁切容器藏起來 |
