# Shopee Peek

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

不登录也能看虾皮台湾（shopee.tw）商品页与站内搜索第 1 页的油猴脚本。商品与搜索均用虾皮原生页面显示，商品标题下方附 BigGo 参考价。单个文件、没有依赖、不追踪用户。

[![用 Tampermonkey 安装](https://img.shields.io/badge/%E5%AE%89%E8%A3%85-Tampermonkey-00485B?logo=tampermonkey&logoColor=white)](https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js)
[![check](https://github.com/YTsnipers/shopee-peek/actions/workflows/check.yml/badge.svg)](https://github.com/YTsnipers/shopee-peek/actions/workflows/check.yml)
![网站：shopee.tw](https://img.shields.io/badge/site-shopee.tw-EE4D2D)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 未安装：被挡在登录页 | 安装后：显示虾皮原生商品页 |
|---|---|
| <img src="docs/before.png" width="300"> | <img src="docs/after.png" width="520"> |

## 未登录时能看到什么

| 能看到 | 看不到 |
|---|---|
| 商品标题、多图轮播 | 销量 |
| 规格选项 | 评价 |
| 商品参数、商品详情 | 配送方式与运费 |
| 店铺名称、回复率、粉丝数 | 实时价格（BigGo 价格可能滞后） |
| 各规格 BigGo 参考价，随所选规格切换 | 搜索第 2 页以后、搜索结果里的价格 |
| 站内搜索第 1 页（最多 35 条，含图片与标题） | |

销量、评价、配送信息由虾皮服务器对未登录访客直接移除，目前找不到其他来源。BigGo 没有收录的商品会显示「查無價格」（脚本界面为繁体中文，意为“查不到价格”）。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. Chrome、Brave、Edge：打开 `chrome://extensions` → Tampermonkey → 详情 → 开启「允许用户脚本」（Allow User Scripts）
3. 打开 [shopee-peek.user.js](https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/shopee-peek.user.js)，Tampermonkey 会弹出安装页

之后的新版本由 Tampermonkey 自动安装。

## 支持范围

- 网站：仅支持 shopee.tw
- 已测试：Brave + Tampermonkey；未测试：Chrome、Edge、Firefox、Violentmonkey

## 工作原理

未登录时，虾皮商品 API（`/api/v4/pdp/get_pc`）返回 `90309999` 错误，前端随即把页面导向登录墙。脚本在前端看到错误之前把响应换掉：

```mermaid
sequenceDiagram
    participant F as 虾皮前端
    participant S as 脚本
    participant P as shopee.tw
    participant B as BigGo
    F->>P: get_pc（未登录）
    P-->>S: 90309999（被脚本拦下）
    S->>P: 用 LINE 内置浏览器的 User-Agent 重新请求商品页，不带 cookie
    P-->>S: 内嵌的商品数据
    S-->>F: 转成 get_pc 的格式，前端照常渲染
    S->>B: 查询各规格价格
    B-->>S: 参考价，显示在标题下方
```

1. 在 `document-start` 拦截页面的 `fetch`、`XMLHttpRequest`、`history`
2. `get_pc` 被挡时，用 LINE 内置浏览器的 User-Agent 重新请求同一个商品页。这个版本内嵌与 `get_pc` 同格式的商品数据，脚本把它交给虾皮前端渲染
3. 从 `get_shop_base` 补上店铺信息，其他被挡的 API 返回空数据，并丢弃跳往 `/verify/` 的跳转
4. 向 BigGo 查询各规格价格，显示在标题下方
5. 搜索被挡时，向 BigGo 查询虾皮商城与拍卖商品，交给虾皮原生搜索页

登录状态下虾皮 API 不会返回 `90309999`，脚本不替换任何数据。

细节见 [docs/how-it-works.md](docs/how-it-works.md)；试过哪些方法、为什么失败见 [docs/investigation-log.md](docs/investigation-log.md)。两份文档均为繁体中文。

## 安全与隐私

| 项目 | 实际行为 |
|---|---|
| 运行范围 | 只在 `https://shopee.tw/*` 运行（`@match`） |
| 权限 | 只申请 `GM_xmlhttpRequest`，而且只能连接 `shopee.tw` 与 `biggo.com.tw`（`@connect`） |
| 你的 cookie | 经 Tampermonkey 发出的请求一律不带 cookie。只有店铺信息（`get_shop_base`）在页面内用虾皮自己的 cookie 调用，和虾皮前端平时发出的请求相同 |
| 发送给第三方的数据 | BigGo 会收到你正在看的商品 ID、商品名称（或搜索关键词）和你的 IP。账号、cookie、浏览记录都不会发送 |
| 代码来源 | 单个文件，没有依赖、没有构建步骤，不下载远程代码，没有统计或追踪 |
| 写入页面的外部数据 | BigGo 与虾皮返回的文字一律用 `textContent` 写入，不会当作 HTML 解析 |
| 页面与脚本的通信 | 通过 `document` 事件。页面上的任何脚本都能发出这些事件，所以脚本先校验参数（商品 ID 必须是数字、关键词不能为空、页码必须是非负整数）再发请求 |
| 自动更新 | Tampermonkey 从本仓库的 `main` 分支更新，相当于信任本仓库的维护者。不想自动更新，可以在 Tampermonkey 里关闭这个脚本的「检查更新」 |

会改变网站行为的地方：

- 没有语言 cookie 时，设置 `language=zhHant`
- 丢弃所有跳往 `/verify/` 的页内跳转，**登录时也一样**。虾皮要求验证（包括验证码）时，页面不会带你过去；需要验证就先停用脚本
- 搜索结果的名称与图片链接暂存在 `sessionStorage`（`peek:` 开头），关闭标签页即清除
- 所有发往 `/api/` 的 XHR 改由 `fetch` 发出

发现安全问题请提 issue 说明影响范围，不要附上可以直接利用的细节。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 仍然跳到登录页 | Tampermonkey 还不能运行用户脚本，或虾皮改版 | 检查安装第 2 步；已经开启就提 issue |
| 只出现标题、图片、价格的精简卡片 | 虾皮对你的 IP 限流，拿不到完整商品数据 | 等一段时间再刷新 |
| 搜索一律显示「找不到結果」（意为“找不到结果”） | BigGo 未返回搜索结果，控制台出现 `[Shopee Peek] BigGo 搜尋失敗（HTTP ...）` | 稍后再试；若仍为 v0.6.0 旧版请更新至 v0.7.0 以上 |
| 标题下方显示「查無價格」 | BigGo 没有收录这个商品 | 无需处理，页面其他部分正常 |
| 虾皮要求验证码，页面却一直不出现 | 脚本会丢弃所有跳往 `/verify/` 的页内跳转，登录时也一样 | 本次浏览先停用脚本 |

反馈问题时，打开开发者工具的 Console（控制台），筛选 `[Shopee Peek]`，把这些信息连同商品链接贴到 issue。

### 限流

虾皮会限制同一个 IP 通过脚本所用的路径加载页面的频率。各路径被限流时的表现：

| 路径 | 被限流时 | 页面表现 |
|---|---|---|
| 商品数据（LINE User-Agent） | 返回 HTTP 200，但内嵌数据的 `cachedMap` 为空 | 显示 BigGo 精简卡片，而不是完整商品页；控制台出现 `[Shopee Peek] LINE 版回傳空資料` |
| 搜索（BigGo，v0.7.0+） | 不再请求 `shopee.tw/search`；旧版社交预览 User-Agent（`facebookexternalhit`、`Twitterbot`、`Googlebot`）已被虾皮封锁，固定返回 HTTP 403 + `90309999` | 由 BigGo 获取最多 35 条结果，不消耗虾皮 IP 额度；若 BigGo 返回非 200，控制台出现 `[Shopee Peek] BigGo 搜尋失敗（HTTP ...）` |
| 首页推荐 | 虾皮返回空数据，不是脚本造成的 | 限流范围扩大时，首页「每日新發現」（每日新发现）也会变空 |

- 触发与解除：之前的测试大约 10 分钟内打开 8 次商品页就会触发，约 30 分钟后解除。另一次测试停用 65 分钟后，商品页仍是精简卡片、旧版社交预览搜索仍返回 403，首页推荐已恢复。再下一次测试停用约 1.5 小时后，商品页已恢复完整，但旧版社交预览搜索超过 3 小时仍返回 HTTP 403 + `90309999`（确认虾皮直接封锁了这类 User-Agent，因此 v0.7.0 起搜索改走 BigGo）。之后一次测试停用约 2.5 小时，商品页两次都完整加载，首页推荐也有数据。
- 手动测试要间隔开，不要连续打开很多商品。
- 商品页被限流后，等 30 分钟到 2 小时再试。

## 给 AI 助手与编程智能体

想让 AI 解释这个项目，把这个链接发给它：

```text
https://raw.githubusercontent.com/YTsnipers/shopee-peek/main/llms.txt
```

要修改脚本的编程智能体，按这个顺序阅读：

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| [`llms.txt`](llms.txt) | 用途、行为、限制、文件地图（英文） | 第一次接触项目 |
| [`AGENTS.md`](AGENTS.md) | 两个执行环境、每件事唯一的写法、不能破坏的规则与执行方式、验收步骤（英文） | 改任何代码之前 |
| [`docs/how-it-works.md`](docs/how-it-works.md) | 封锁机制、数据来源、请求流程（繁体中文） | 改请求或数据流程时 |
| [`docs/investigation-log.md`](docs/investigation-log.md) | 试过但失败的方法与原因（繁体中文） | 提出新的绕过方式之前 |
| [`tests/`](tests) | 离线测试，在 Node `vm` 里模拟浏览器与 Tampermonkey | 每次改动 |

规则与验收步骤以 `AGENTS.md` 为准。实测会用掉用户 IP 的虾皮额度，能用离线测试验证的就不要实测。

## 开发与贡献

```sh
node --check shopee-peek.user.js && node --test
```

CI 运行同一条命令，不需要安装任何依赖（Node 24）。

欢迎提 issue 和 PR。想移植到其他地区的虾皮，先看 [`AGENTS.md`](AGENTS.md) 的「Hard-coded to Taiwan」清单；LINE User-Agent 这条路在台湾以外是否有效尚未测试。

如果脚本帮你省下了一次登录，点个 star 能让更多人找到它。

## 免责声明

本脚本仅供个人浏览公开商品信息，与 Shopee 及其关联企业无任何关系。脚本依赖网站目前的运作方式，网站更新后可能随时失效，作者不保证功能持续有效。使用者应自行评估使用风险并遵守网站服务条款，作者不对使用本脚本造成的任何后果负责。

## 许可证

[MIT](LICENSE)
