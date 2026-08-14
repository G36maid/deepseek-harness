# Agent Note: 按 agent 的工具呈現方式，以及 `code` 預設

Status: implemented

[English](2026-08-05-per-agent-tool-presentation.md) | 繁體中文

## 問題

agent preset 已經能按工作階段組裝一個 agent 的工具，卻管不了這些工具以何種**形態**抵達模型。Code Mode——一個 `run_code` 工具加一份生成的 TypeScript SDK，用一段程序替代一串呼叫——此前是宿主 `dsh-tools` 那一行上的部署級 `mode` 欄位。一個部署要麼所有工作階段都跑 Code Mode，要麼一個都不跑，於是那個顯而易見的產品形態（預設選擇器裡「程式碼模式」與標準/極簡/創造並列）無處安放。

「把 tools 下沉到 agent 平面」這個字面讀法行不通。`ctx.tools` 有一批跟不下來的宿主平面消費者：`dsh-agent-loop` 讀它私有的調度器 seam，`dsh-apiproxy` 讀它的 presenter 來渲染工具卡，每個工具外掛程式都往裡註冊。按本 stack 自己的規則——只有**所有**消費者一起下沉，服務才能下沉——登錄檔必須留在原地。

## 決策

把登錄檔和它的投影拆開。登錄檔留在宿主平面；**呈現方式**變成它內部按 scope 的狀態，與已經住在那裡的作用域限制和守衛並列。

`ToolRuntime.presentAs(mode)` 只接受 scoped 上下文，形狀照抄 `restrict()`：它透過 `ScopedLayers.effect` 在呼叫方 scope 的 `ToolLayer` 上寫一個單元，因此會隨聲明它的那個 scope 一起解除安裝。在隨附的 Web 介面裡那個 scope 是某個 agent preset 的常駐掛載——`code` preset 攜帶 `tool-presentation` 行——因此一份聲明覆蓋加入該 preset 的每個 agent，而 `modeFor(scope)` 取作用域鏈上最近的那份聲明。它與 config 的 `mode` 一並解析，後者於是成為「未作聲明的 scope」的預設值，而不再是行程級事實。原先決定呈現方式的三處讀取——wire schema、可見性檢視表裡的 `run_code` 條目、以及生成的 SDK 段——改為讀取該 scope 的模式，而非服務的。

有兩個隨之而來的結果，且都是承重的：

- **`run_code` 按 scope 追加。** 此前只要傳輸存在，它就進入每一個檢視表。按 agent 之後，一個 native agent 不能因為行程裡別的 agent 呈現了它、就在自己的分發表裡看到 `run_code`——因此這次追加以該 scope 自身的模式為條件，傳輸也改為首次需要時才建置。
- **保留名現在無條件生效。** `run_code` 此前只在設定了 code 模式時才被拒絕註冊。如今任何 agent 都可能選擇 code 模式，因此一個在 native 部署下可以隨便佔用的名字，會在某個 preset 掛載的那一刻變成衝突。

SDK 提示詞段由 code 模式的部署全域性註冊（不變），並由 `presentAs` 額外按 scope 註冊一份，後者按名字遮蔽前者。它的正文對 native scope 渲染為空，而提示詞渲染器會丟棄空段——正是這一點讓「在 code 模式部署下選擇退出」的 agent 不帶 SDK 段。

preset 用一行來表達這個選擇：`@deepseek-ai/dsh-agent-tool-presentation`，其全部內容就是一次 `presentAs` 呼叫。code 類模式透過 `ctx.inject` 等待 `ctx.codeRuntime` 而非假定它存在：執行時期在宿主平面，而一個 pending 的行正是 `dsh-agent-presets` 已經會報告的「不可用掛載」並會指名該行——於是在無執行時期的部署上選擇 Code Mode 的 preset，會在操作者能夠動手的地方失敗。

## 考慮過的替代方案

**在 preset 的 isolate realm 裡再起一個 `ToolRuntime`。** 否決：`dsh-agent-loop` 透過一個私有 symbol 從宿主上下文一次性解析登錄檔，因此按 agent 的登錄檔對調度器不可見。把 loop 改成按 agent 解析登錄檔，遠比把一個欄位變成 scope 感知的改動大。

**在 preset 自己的 YAML 裡加一個頂層鍵。** 否決，理由與 preset 展示元資料落到獨立 `preset.yml` 相同：組裝是一個頂層的外掛程式行清單，裝不下並列的鍵。

**把包命名為 `dsh-tool-mode`。** 被一道 gate 否決，而且它是對的。`gen-tool-catalog` 以 `packages/*/tool-*` 通配，並要求每個命中項發布一個面向模型的工具 schema——因為在本倉庫裡這個前綴就意味著「帶工具」。而這一行不帶任何工具。

**在構造函式裡無條件註冊 SDK 段。** 試過之後否決：`renderPrompt` 會丟棄空段，但 `PromptAssembly.sections` 會保留它們，於是每個 native 部署都將攜帶一個什麼也不渲染的 `tools:sdk` 條目，而兩處既有斷言不得不為此放寬。

**用 include 共享 `standard` 的組裝。** 按本 stack 自己的慣例否決：`cordis` 已經複製了一份 `standard`，而 preset 的價值恰在於整份組裝能在一個文件裡讀完。代價——第三份約 240 行、且必須同步演進的副本——是真實的，也正是未來引入 include 機制最有力的論據。

## 後果

同一行程內的兩個工作階段現在可以有不同的呈現方式，因此「模型看到哪些工具」不再能只憑部署設定回答，必須給出 agent。凡是引用模式的診斷資訊，現在引用的都是該 scope 的，而不是服務的。

`ctx.tools.schemas(agent)` 仍然是該 agent 的**能力**清單，不受呈現方式影響——坍縮的只是 assembly 裡的工具。斷言「模型收到什麼」的測試必須讀 assembly；`web-agent-presets.spec.ts` 對隨附的 `code` 預設同時斷言了這個區分的兩側。

隨附的名單變成四個預設（標準/程式碼/極簡/創造），因此任何列出它們的 golden 都會變動。未組裝 code 執行時期的部署無法組裝任何 code 模式的 preset；隨附的 Web overlay 帶了一個，base 組裝沒有。
