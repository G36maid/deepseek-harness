# 事後檢討（postmortem）0001：ACP（Agent Client Protocol）伺服器在連線時崩潰——`export default` 丟棄了外掛程式的 `inject`

[English](0001-acp-default-export-drops-inject.md) | [简体中文](0001-acp-default-export-drops-inject.zh.md) | 繁體中文

狀態：已解決；修復見 PR（Pull Request）#41 `feat/acp-2-bridge`

## 摘要

兩個整合錯誤在單元測試全覆蓋的情況下仍然導致 ACP 崩潰：一個預設匯出使 Loader 丟棄了 `inject`，一個經可追蹤代理的選填服務尋找在 shadow 邊界上失敗。手動掛載的測試繞過了這兩條路徑。修復方案增加了無需 API key 的真實 Loader 測試覆蓋，並為外掛程式匯出和選填服務訪問制定了包級規則。

## 概述

ACP 伺服器（`examples/acp-agent`、`@deepseek-ai/dsh-acp`）在真實編輯器（Zed）連線的瞬間崩潰：第一個 `session/new` 請求返回 `Internal error: cannot get property "agents" without inject`，`session/load` 對 `sessionPersistence` 返回同樣的錯誤。儘管有 178 個綠色單元測試和 100% 行覆蓋率，bridge 在生產環境中完全無法工作。兩個獨立的 bug 隱藏在同一個錯誤字串背後，測試套件之所以兩個都沒捕獲，原因也相同：所有測試都透過一條不會觸及外掛程式真實載入方式和服務真實解析方式的路徑來掛載外掛程式。

## 影響

ACP 伺服器無法建立或載入任何一個工作階段——而這正是編輯器最先呼叫的兩個 RPC。任何將 agent（代理）接入 Zed 的人都會立即遭遇硬性失敗。無資料丟失（崩潰前沒有任何內容被持久化）；代價完全是「功能不可用」加上兩次定位原因的除錯時間。

## 時間線

- bridge（RFC 010）落地時有一套完整的單元測試，覆蓋 codec、記憶體傳輸、生成的協定訊息、失敗路徑和 HMR（熱模組替換）；另有一個需要 key 的真實 API e2e 測試和一個無需 key 的 stdout 純淨性 e2e 測試。全部綠色，100% 覆蓋率。
- 真實 Zed 工作階段在 `session/new` 上立即失敗，報錯 `cannot get property "agents" without inject`。
- 調查最初沿著一個 Cordis「traceable/shadow」理論展開（看似合理，且該機制確實存在——見 Bug #2），隨後在 vendor 目錄中的 `reflect.ts` 裡對實際 fiber 遍歷做了插樁，並執行了真實子行程。跟蹤結果顯示，例外在 `apply()` 第 179 行、*外掛程式載入時*拋出，位於 ROOT fiber 且沒有 shadow——推翻了 shadow 理論對 `session/new` 的解釋。
- 找到根因 #1：一行多餘的 `export default apply`。刪除後 `session/new` 修復。
- 刪除後暴露了 Bug #2：`session/load` 仍然在 `sessionPersistence` 上拋錯——這是一個真正不同的機制（shadow 遍歷），透過隔離修復並重新執行真實子行程得到確認。

## 根因 #1——`export default apply` 丟棄了外掛程式的 `inject`（導致 `session/new` 崩潰）

`packages/acp/acp/src/index.ts` 是一個*命名空間外掛程式*：它將 `name`、`inject`、`Config` 和 `apply` 作為獨立的命名匯出，倉庫中其他所有外掛程式（`invariants`、`llm-deepseek`、`tool-bash`、`tui` 等）也是如此。但它*還*多了一行其他外掛程式都沒有的程式碼：

```ts ignore-check
export const name = 'acp'
export const inject = ['agents', 'sessions', 'sessionPersistence']
export function apply(ctx: Context, config: AcpConfig): void { /* … */ }
// …
export default apply   // ← the bug
```

當外掛程式從 `cordis.yml` 載入時，Cordis Loader 透過 `Loader.unwrapExports`（`vendor/loader/src/index.ts`）對匯入的模組進行規範化：

```ts ignore-check
unwrapExports(exports: any) {
  if (isNullable(exports)) return exports
  exports = exports.default ?? exports        // ← prefers `.default`
  if (!exports.__esModule) return exports
  return exports.default ?? exports
}
```

存在預設匯出時，`exports.default ?? exports` 解析為**裸 `apply` 函式**。裸函式沒有 `inject`、沒有 `name`、沒有 `Config` 屬性——這些作為*同級*命名匯出存在於模組命名空間上，而 unwrap 到 `.default` 把整個命名空間丟棄了。Loader 隨後基於空的 `inject` 建置了外掛程式的 fiber。

因此 `apply` 在一個**沒有注入任何服務**的 fiber 中執行。第一行 `const agents = ctx.agents` 遍歷 fiber 樹（ROOT → Include → Loader → ROOT），在所有 fiber 的 store 中都找不到 `agents`，到達根 fiber（`runtime === null`）後拋出 `cannot get property "agents" without inject`。崩潰發生在*載入時*，而非後續的請求處理器中——請求只是恰好觸發了載入。

**修復：**刪除 `export default apply`。Loader 隨後使用模組命名空間，正確識別 `inject`/`name`/`Config`，`apply` 在一個確實注入了所聲明服務的 fiber 中執行。

## 根因 #2——選填服務讀取透過可追蹤 shadow 觸發 inject 守衛（導致 `session/load` 崩潰）

修復 #1 後，`session/new` 正常工作，但 `session/load` 仍然拋出 `cannot get property "sessionPersistence" without inject`。這個問題*確實*源於 Cordis 的可追蹤代理/shadow 機制，值得精確理解。

`session/load` 呼叫 `agents.resume(...)`，後者委託給 `AgentLoop.resume()`，其中讀取了 `this.ctx.sessionPersistence`。`AgentLoop` 的 `static inject` 故意不包含 `sessionPersistence`——注入它會導致非持久化的示範永遠掛起，等待一個永遠不會載入的後端。該服務由一個獨立的兄弟外掛程式/fiber 提供，以機會性方式讀取。

Cordis 中的服務訪問透過上下文代理（`vendor/cordis/src/reflect.ts`）進行。當透過從另一條 fiber 取得的*可追蹤代理*呼叫服務方法時（此處：bridge fiber 呼叫 `ctx.agents.resume`，登錄檔返回 `this.factory`——即 `AgentLoop`——重新包裝為綁定到呼叫方的新 traceable 代理），`createShadowMethod`（`vendor/cordis/src/utils.ts`）將 `this` 重新綁定到一個 *shadow* 對象，其 `ctx` 攜帶 `[symbols.shadow]` 指向 `AgentLoop` 自身的構造上下文。在 `resume` 內部，`this.ctx.sessionPersistence` 的解析從 shadow 的 fiber 開始遍歷：

```ts ignore-check
// reflect.ts get handler
let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber   // ← starts at AgentLoop's fiber
while (true) {
  const impl = fiber.store?.[prop]
  if (impl) return getTraceable(ctx, impl.value)
  if (prop in fiber.inject) { /* inactive-context error */ }
  if (!fiber.runtime) throw error                            // ← reached root, throw
  if (fiber.parent[symbols.isolate][prop] !== key) throw error
  fiber = fiber.parent.fiber                                 // ← ancestor-only
}
```

遍歷**僅向祖先方向**進行。`sessionPersistence` 既不在 `AgentLoop` 的 fiber store 中（不在其 `static inject` 中），也不在通往 root 的任何祖先上（它位於一個*兄弟*分支），因此遍歷到達根 fiber 後拋錯。

為什麼記憶體中的 `AgentLoop` 復原測試沒有捕獲這個問題？因為它們從測試程式碼直接呼叫 `ctx.agents.resume(...)`——*在任何外掛程式 fiber 之外*。此時 `ctx.fiber.runtime` 為 `null`，代理處理器走了一條提前繞過的路徑：

```ts ignore-check
if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)   // ← direct global-store lookup, no fiber walk
```

`ctx.reflect.get(name, false)` 是基於 isolate symbol 的全域性服務 store 直接尋找——完全忽略 fiber 拓撲，能找到服務。因此從頂層測試讀取可以成功；而從真實外掛程式 fiber 內部、經由 shadow 到達時則拋錯。bridge 恰好是後者。

**修復：**使用 `ctx.get('sessionPersistence')` 讀取選填服務，該方法使用全域性 isolate-keyed store 同時保留活躍狀態檢查。對於外掛程式聲明注入集中的服務，直接屬性讀取仍然適用。

## 為什麼所有測試都沒有捕獲（真正的失敗）

兩個 bug 都源於同一個根本流程缺口：**沒有任何測試透過外掛程式的真實載入路徑或真實呼叫拓撲來驅動它。**

- 記憶體 harness 透過手動建置外掛程式對象來掛載 bridge：`ctx.plugin({ name, inject, apply })`。這手動提供了 `inject`，因此永遠無法復現 Bug #1——`unwrapExports` 只被 *Loader* 呼叫，`ctx.plugin` 從不呼叫它。即使 `ctx.plugin(NamespaceImport)` 也無法捕獲。
- 同一個 harness 將所有內容平鋪掛載在一個根上下文上，因此從中觸達的 `AgentLoop` 復原要麼執行在頂層（`!runtime` 繞過），要麼經由 shadow 執行，而該 shadow 的 origin 仍然解析到 root——掩蓋了 Bug #2 的祖先遍歷失敗。
- 唯一的無 key e2e 傳送 `initialize` 並檢查 stdout 純淨性。`initialize` 從不觸達 factory，因此兩個 bug 都安然透過。
- 唯一驅動 `session/new`/`session/load` 的測試需要 key 才能執行，因此 CI（無 key）跳過了它——而本機它之所以「透過」，只是因為一個過時的已建置 `lib/`（包含舊程式碼）恰好滿足了模組解析。

100% 行覆蓋率始終滿足。覆蓋率證明程式碼行*被執行過*；它不能說明功能是否*按交付方式正常工作*。

## 新增的防護措施

- **刪除 `export default apply`**（`packages/acp/acp/src/index.ts`）——Bug #1 的修復。
- **`AgentLoop.resume` 使用 `this.ctx.get('sessionPersistence')`**（`packages/core/agent-loop/src/index.ts`）——Bug #2 的修復，附註釋說明 shadow 遍歷陷阱。
- **無需 key 的 `session/new` e2e，透過真實 stdio 執行**（`examples/acp-agent/tests/acp.e2e.ts`）：以子行程方式透過真實 Loader 啟動示例，並斷言 `session/new` 正常返回。無需 API key 即可明確暴露 Bug #1。已驗證復原 `export default apply` 時測試失敗。
- **e2e spawn 中設定 `TSX_TSCONFIG_PATH`**：子行程從臨時 cwd 執行，tsx 無法透過向上搜尋找到倉庫根的 tsconfig `paths` 對映——因此 dsh-* 的 import 靜默回退到已建置的 `lib/`。將 tsx 指向倉庫 tsconfig 使解析不相依性 cwd，確保測試執行的是*原始碼*而非可能過時的建置產物。
- **[docs/testing.md](../testing.md) 規則**：「測試真實入口路徑」，行覆蓋率不等於行為覆蓋率——將這一教訓編纂為所有未來外掛程式的規則。

## 經驗教訓

- 命名空間外掛程式與 default export 在 Cordis Loader 下互斥。選擇命名空間形式（`name`/`inject`/`Config`/`apply`），不要新增 `export default`——`unwrapExports` 會丟棄命名空間。
- 對於外掛程式機會性讀取但未在 `static inject` 中聲明的服務，使用 `ctx.get(name)`，絕不使用 `ctx.<name>`。屬性代理透過僅向祖先方向的 fiber 遍歷解析，經由外部 shadow 時會失敗；`ctx.get(name)` 是拓撲無關的尋找（且預設採用嚴格模式——非活躍後端讀取為 `undefined`，不會在 teardown 期間仍將該後端返回給呼叫方）。
- 手動建置外掛程式的測試無法驗證外掛程式的載入方式。至少一個測試必須端到端地驅動真實的 Loader/export 路徑。當核心操作不呼叫模型時，該測試無需 API key——因此它屬於 CI，而非 key 門控之後。
- 相信跟蹤結果，不要迷信理論。優雅的 shadow 解釋是真實的，但它是*第二個* bug；*第一個*是一行匯出錯誤，在數小時看似合理但實際錯誤的推理之後，一個 fiber 遍歷的 `console.error` 在幾分鐘內就找到了它。
