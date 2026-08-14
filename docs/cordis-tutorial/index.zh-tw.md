# Cordis 教學

[English](index.md) | [简体中文](index.zh.md) | 繁體中文

Cordis 是 DeepSeek Harness 底層的外掛程式框架：它是一個小型執行時期，其中的每項能力，包括工具、LLM（大型語言模型）配接器、文件訪問乃至 agent loop（代理循環）本身，都是掛載到共享上下文中的外掛程式。本教學透過動手實踐講解 Cordis：每一章都是一個可以執行的示例，你將在本倉庫內的臨時目錄中逐步建置它，最後把一個外掛程式接入真實的 harness 服務。

本教學面向 agent 開發者。你不需要深入掌握 TypeScript；下文的 [TypeScript 說明](#typescript-notes)會解釋可能陌生的文法，並且每一章都會給出確切命令和預期輸出。

如果你想閱讀精簡的概念參考，而不是逐步實踐，請參閱 [Cordis 入門](../cordis-primer.md)。詳盡的 API 參考見[子系統頁面](../subsystems/core.md)上生成的 `cordis-surface` 區塊，以及 [Cordis 核心 API](../cordis-api/context.md) 頁面。

如果你要為 harness 本身編寫外掛程式——由 `cordis.yml` 載入、在 Web UI 中驅動，而不是下面這個啟動器——請從[第一個 Harness 外掛程式](../user/develop/basic/index.md)開始。

<a id="setup"></a>

## 準備工作

你需要克隆本倉庫並安裝相依性；[開發指南](../development.md#setup-tutorial)列出了前置條件。本教學不需要 API 金鑰；所有示例均可在無金鑰環境中執行。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

建立各章使用的臨時目錄。`tmp/` 已被 git 忽略，因此你在其中寫入的任何內容都不會進入版本控制：

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

每一章都從該目錄執行同一條命令：

```sh
node --import tsx ../../vendor/cordis/bin.js
```

這個單文件啟動器（見 [vendor/cordis/bin.js](../../vendor/cordis/bin.js)）會建立根 `Context`、掛載 Loader 外掛程式，並讓它從當前目錄載入 `./cordis.yml`。其餘所有內容，包括有哪些外掛程式以及如何設定它們，都來自你稍後將編寫的 YAML 文件。`--import tsx` 標志讓 Node 無需建置步驟即可執行設定所指向的 TypeScript 文件。

## 章節

1. [你的第一個外掛程式](01-first-plugin.md)：外掛程式是函式，由 loader 掛載。
2. [生命週期與 effect](02-lifecycle-and-effects.md)：由 Cordis 管理的註冊會在所屬外掛程式解除安裝時撤銷。
3. [服務](03-services.md)：在 `ctx` 上公開一項能力，並透過 `inject` 相依性它。
4. [事件](04-events.md)：類型化事件、廣播分發和 waterfall（瀑布式事件）的短路行為。
5. [設定](05-config.md)：讀取 `cordis.yml` 中經過校驗的設定，並在輸入錯誤時明確報錯。
6. [組合與 HMR（熱模組替換）](06-composition-and-hmr.md)：把設定檔作為外掛程式樹，使用熱重新載入，並診斷始終無法載入的外掛程式。
7. [進入 harness](07-into-the-harness.md)：基於真實的 harness 服務註冊一個可由模型呼叫的工具。

<a id="typescript-notes"></a>

## TypeScript 說明

這些示例使用了普通現代 JavaScript 之外的三項 TypeScript 功能：

- **類型註解**描述值，但不會改變執行時期行為：`ctx: Context` 表示 `ctx` 具備 Cordis 上下文 API，`who: string` 接受文字，而 `string[]` 表示字串陣列。
- **`import type { Context } from '@deepseek-ai/cordis'`** 只匯入類型資訊。它在執行時期會消失，因此僅為類型註解使用 `Context` 的外掛程式文件不會增加執行時期相依性。
- **聲明合併**（`declare module '@deepseek-ai/cordis' { ... }`）會為 Cordis 已經聲明的介面新增你的條目，例如新 `ctx.greeter` 屬性的類型或事件名稱。它不會生成任何執行時期接線；外掛程式必須另行提供服務或寄出事件。第 3 章會完整展示該模式。

第 5 章還會使用 `interface` 描述設定對象的欄位，並使用 `Schema<Config>` 這類泛型表示 schema 校驗哪些對象欄位。你可以直接照寫這些聲明；周圍的正文會解釋每項聲明連線了什麼。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
