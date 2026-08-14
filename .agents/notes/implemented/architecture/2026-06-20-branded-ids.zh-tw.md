# Agent Note: 在所有應有之處使用 branded ID

Status: implemented

[English](2026-06-20-branded-ids.md) | [简体中文](2026-06-20-branded-ids.zh.md) | 繁體中文

## 問題

harness 使用 `Branded<B> = string & { readonly [BRAND]: B }` 機制，為 `CallId`（`packages/llm/llm/src/brand.ts`）和 agent（代理）/工作階段共享的 `SessionId`（`packages/core/session/src/types.ts`）做 brand 處理；該機制由純類型包 `@deepseek-ai/dsh-brand` 擁有，位於 `packages/util/brand/`，見其 [README](../../../../packages/util/brand/README.md)，並為每個類型提供零開銷的 cast 工廠。`dsh-brand` 還聲明瞭治理策略：*「Branding 用於跨包邊界且可能被混淆的 id；不是每個 string 都需要 brand。」* 這條策略是正確的；問題在於它只落實了一半。兩處缺口使得結構相同但語義錯誤的 string 今天仍能透過型別檢查器。

**缺口 1：bash seam 中未 brand 的跨邊界 ID。** 後臺 job id 是普通 `string`：`BashTask.id: string`（`packages/shell/shell/src/types.ts`），作為 `string` 貫穿整個執行器 seam（`packages/shell/shell/src/index.ts` 中的 `ShellExecutor.get`/`ownerOf`/`readOutput`/`kill(id: string)`），再由面向模型的工具以 `string` 校驗並傳遞（`validateJobId`、`assertTaskAccess`、`packages/shell/tool-bash/src/index.ts` 中 `job_id` 的 schema 參數）。它由每執行器計數器生成——`packages/shell/bash-local/src/index.ts` 中的 `` `bash-${this.nextTaskId++}` ``——其形状与 `SessionId` 的默认值**完全相同，都是 `name-N`**（`packages/core/session/src/index.ts` 中的 `` `session-${++counter}` ``）。bash job id 和会话 id 在调用点轻易就能互换，而编译器毫无反应。它是面向模型的 id（模型会把 `job_id` 传回 `bash_output`/`bash_kill`），所以該混淆可由不受信任的輸入觸達。

bash **owner token** 是相關的子情形：`ShellExecRequest.owner?: string` 和 `ShellExecSpec.owner: string | undefined`（`packages/shell/shell/src/types.ts`）被文件描述為刻意*不透明*的隔離鍵，但在所有實際呼叫方中，該值就是所屬 agent 共享的 `Agent.id`/`SessionId`（`callerToken = (exec) => exec.agent?.id`，位於 `packages/shell/tool-bash/src/index.ts`），只是披著另一個 seam 本機名稱。它被用於訪問控制比較（`owner !== callerToken(exec)`），因此一個不匹配但類型正確的 string 在此處就是跨工作階段隔離 bug，而當前類型系統無法捕獲。這正是[統一 agent/session 標識決策](../simplification/2026-06-20-unify-agent-and-session-id.md)覆蓋的共享 id 別名。

**缺口 2：*已經 brand* 的 ID 在邊界處被侵蝕。** 就連 `CallId` 和 `SessionId` 也恰好在最容易混淆的地方退化為裸 `string`：登錄檔/store 鍵類型和公開方法參數。代表性位置包括工作階段儲存、agent 登錄檔（二者都以共享的 `SessionId` 為鍵）、工具展示層的 call-id map、ACP（Agent Client Protocol）的工作階段記錄，以及持久化協調器。在集合鍵處丟棄 brand，會讓既有 brand 在尋找時毫無價值；它們的價值只實作了一部分。

## 決策

純類型變更。Brand 是零開銷 cast；執行時期行為、序列化、比較和協定格式（wire format）均不變。該決策分三部分，全部遵循既有的「不是每個 string 都需要」策略。

- **為 bash job id 加 brand。** 在 `packages/shell/shell/src/types.ts`（*擁有*該 id 的包）中新增 `BashTaskId = Branded<'BashTaskId'>` 及其同名工廠，從 `@deepseek-ai/dsh-brand` 匯入 `Branded`，方式與 `SessionId` 完全一致。brand 原語位於無相依性的 `dsh-brand` 工具包中，正是為了讓 `dsh-shell` 僅相依性它就能為自己的 id 加 brand，而無需引入 `dsh-llm`（或 `dsh-session`）來取得 `Branded`。將其貫穿 `BashTask.id`、`ShellExecutor` Service Definition 方法（`get`/`ownerOf`/`readOutput`/`kill`）、`dsh-bash-local` 中的生成點（在建立時對計數器輸出做一次 brand），以及 `dsh-tool-bash` 的校驗/訪問面（`validateJobId` 返回 `BashTaskId`；`job_id` 在模型 string 到達的工具邊界處被 brand）。

- **鑄造獨立的 `OwnerToken` brand。** 在 `packages/shell/shell/src/types.ts` 中新增 `OwnerToken = Branded<'OwnerToken'>`；將 `ShellExecRequest.owner` / `ShellExecSpec.owner` / `ShellExecutor.ownerOf` 的類型標注為 `OwnerToken | undefined`。`dsh-tool-bash` 消費端在邊界處將 agent 共享的 `id`（`SessionId`）cast 為 `OwnerToken`——這是兩套詞彙唯一交匯的地方。bash Service Definition 從不匯入 `dsh-session`。（理由見下一節。）

- **阻止 brand 侵蝕。** 將既有 brand 傳播到缺口 2 列出的 `Map` 鍵類型和公開方法參數中：`Map<SessionId, Session>`、`Map<SessionId, Agent>`、`get(id: SessionId)`、`Map<CallId, …>`、ACP 的 `SessionId` surface、協調器的 `Map<SessionId, …>`。這是變更中機械量最大的部分，也是讓*既有* brand 在尋找處真正發揮作用（而不僅僅標注在結構體欄位上）的關鍵。

示意形狀（工廠模式與已有的三個 brand 完全一致）：

```ts ignore-check
import type { Branded } from '@deepseek-ai/dsh-brand'

/** A background bash task handle (generated `bash-N` by the local executor). */
export type BashTaskId = Branded<'BashTaskId'>
export function BashTaskId(id: string): BashTaskId {
  return id as BashTaskId
}

/** A bash task's opaque isolation key — the consumer's owner identity, NOT the bash seam's. */
export type OwnerToken = Branded<'OwnerToken'>
export function OwnerToken(id: string): OwnerToken {
  return id as OwnerToken
}
```

## 曾考慮的替代方案

### 為什麼不把 `owner` 類型標注為 `SessionId`？

顯而易見的捷徑是直接把 `owner` 類型標注為 `SessionId`——它確實*總是*一個工作階段 id。我們否決這個方案。bash 執行器 seam 是能力 seam（Service Definition `dsh-shell`、Service Provider `dsh-bash-local`、Consumer `dsh-tool-bash`），其 owner token 被*明確記錄為刻意不透明*：執行器「從不解釋它（seam 中沒有訪問策略——那是消費端的職責）」（`packages/shell/shell/src/types.ts`）。把 Service Definition 的欄位類型標注為 `SessionId`，會把 `dsh-session` 的詞彙引入一個不應知道 owner token *含義*的包——這會讓通用執行後端耦合會話模型，並違背不透明 token 的設計。取代 `dsh-bash-local` 的沙盒化執行器或遠端執行器不應繼承工作階段相依性。獨立的 `OwnerToken` brand 使 seam 保持解耦：`dsh-shell` 只知道「owner 是某種帶 brand 的不透明 token」，而已經決定訪問策略的 `dsh-tool-bash` 消費端，是把其 `SessionId` cast 為 `OwnerToken` 的唯一邊界。該 brand 仍帶來安全收益（不能把 `BashTaskId` 或裸 string 傳到 owner 位置），且不引入耦合。

## 不在範圍內 / 可能的擴充

遵循「不是每個 string 都需要 brand」的策略，刻意保持窄範圍。以下每項都是合理的未來 brand 候選，附帶推遲理由而非承諾：

- **`ModelId`**（`GenerateOptions.model`，`LlmRuntime` 配接器登錄檔的鍵）：一個真正的跨包尋找鍵（config → agent → llm → 配接器）；合理的下一個 brand，僅為控制本決策的影響範圍而暫不納入。
- **`ToolName`**（`ToolRuntime` 的鍵）：由作者定義、人類可讀，且很少與其他 id 混淆；最弱的候選，可能不值得加 brand。
- **`ErrorCode`**（`HarnessError.code`）：一個封閉詞彙（`ABORTED`、`NO_ADAPTER`……），不是逐實例的 id；如果要做，string 字面量聯合類型比 brand 更合適。
- **數值序號**：輪次號、步驟號和事件 `seq` 是 `number` 而非 `string`，`Branded<string>` 不適用；可以用平行的 `number & { readonly [BRAND]: B }` 變體來 brand 它們，但它們是位置序號、很少跨邊界傳遞，收益較低。
- **帶校驗的構造**：brand 工廠是純 cast，無執行時期檢查，且每個邊界（ACP `sessionId`、提供方簽發的 `call.id`、`dsh-llm-deepseek` 中的空字串回退）今天都信任裸 string。一個在邊界處對格式錯誤的輸入拋例外的 `SessionId.parse()` / `isValid()` 配套工具確實是缺口，但它是*執行時期行為*變更，有自己的設計問題（什麼算「格式錯誤」？失敗時會怎樣？），應在獨立決策中處理，不應捆綁進這次純類型變更。

## 驗證

已落地的不變式如下：`BashTaskId` 和 `OwnerToken` 定義在 `dsh-shell` 中，並端到端貫穿 Service Definition、`dsh-bash-local` 生成點與 `dsh-tool-bash` 面向模型的工具，且 `dsh-shell` 未新增對 `dsh-session` 的相依性；沒有任何以範圍內 brand id（`CallId`/`SessionId`/`BashTaskId`）為鍵的集合使用裸 `string`；公開方法參數和匯出簽名保留 brand；每個原始 string 進入的邊界（提供方 call id、ACP 工作階段 id、模型提供的 `job_id`）都透過 cast 工廠構造 brand，而不是散落的 `as` cast。

## 後果

- **兩個介面面的機械性改動。** 傳播 brand 涉及 bash seam（Service Definition + Service Provider + Consumer）以及 ACP 工作階段 id 介面和持久化協調器。改動面廣但嚴重度低：遺漏的位置是編譯錯誤而非靜默 bug。從可觀察行為看，這是一項純類型變更——無快照或 e2e 行為差異。它與[統一 agent/工作階段標識決策](../simplification/2026-06-20-unify-agent-and-session-id.md)相鄰，因為二者都觸及工作階段 id / owner-token 邊界；`OwnerToken` 出於上述解耦理由仍與統一後的 id 保持獨立。
- **Brand 不做校驗。** Brand 是混淆防護，不是正確性證明：一個*錯誤的*工作階段 id 只要仍是格式正確的 string，就和以前一樣能透過型別檢查器。本決策不關閉這個缺口（見「不在範圍內」）——它只阻止這類*類別*錯誤：傳入錯誤*種類*的 id。
- **「在哪裡停下」仍是判斷題。** 為 `BashTaskId` 加 brand 但不為 `ToolName` 加，為 `OwnerToken` 加但不為 `ModelId` 加，是對哪些 string「可能被混淆」的品味判斷。合理的評審者可能想要更多或更少；`brand.ts` 中的策略是裁決依據，本決策傾向於面向模型或用於訪問控制的 id。
