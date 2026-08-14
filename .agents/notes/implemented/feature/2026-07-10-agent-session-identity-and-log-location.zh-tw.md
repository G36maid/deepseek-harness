# Agent Note: 向工具與掛鉤公開 agent 工作階段標識和 JSONL 位置

Status: implemented

[English](2026-07-10-agent-session-identity-and-log-location.md) | [简体中文](2026-07-10-agent-session-identity-and-log-location.zh.md) | 繁體中文

## 問題

agent（代理）可以透過 `session.header.cwd` 識別其工作區，但使用 bash 的模型無法可靠識別當前呼叫所屬的工作階段，也無法找到記錄該呼叫的持久 transcript（文字記錄）。搜尋 `./.sessions` 等同於猜測部署設定和 JSONL 版面配置；自訂根目錄、替代持久化後端、復原、fork，以及並行執行的父子 agent，都會讓這種猜測失效。掛鉤同樣需要 transcript 位置，而未來的外掛程式也可能需要向 shell 命令公開其他由 harness 所有的環境事實。

這項邊界必須維持兩個屬性：事實的所有者決定如何解析該事實；每個子行程接收每次執行的快照，而不是行程級可變全域性狀態。尤其是巢狀 harness 不能把環境中的 `DSH_*` 值洩漏給當前 agent、持久化後端或設定均可能不同的子行程。

## 決策

在 [`SessionPersistence`](../architecture/2026-06-14-session-persistence.md) seam 上增加同步、無副作用的位置查詢：

```ts
import type { SessionHeader } from '@deepseek-ai/dsh-session'

interface SessionLocation {
  readonly kind: string
  readonly path: string
}

interface SessionPersistence {
  locate(meta: SessionHeader): SessionLocation | undefined
}
```

`path` 是該後端為 `meta` 保留的專用日誌的本機絕對路徑；`kind` 標識其表示形式。JSONL 使用解析後的根目錄和路徑輔助函式返回 `{ kind: 'jsonl', path }`。SQLite 以及任何無法誠實提供逐工作階段本機產物的後端均返回 `undefined`。該查詢不會建立或刷寫任何內容，因此即使文件尚不存在，也可以報告按需建立的目標路徑。

面向模型的 bash 包擁有一個 `ctx.shellEnv` 登錄檔。貢獻方聲明穩定名稱、它可能返回的每個 `DSH_*` 鍵、每個鍵的說明，以及 `resolve(execution: ToolExecution)`。貢獻方名稱重複、鍵所有權重複、使用保留鍵、聲明格式錯誤、執行時期輸出未聲明或輸出不是字串時，系統都會明確失敗。註冊屬於 Cordis effect，並隨貢獻外掛程式的 fiber 一同移除。`list()` 無需執行解析器即可公開聲明，從而讓環境 API 可供診斷工具和未來的提示詞／UI 消費端枚舉。

登錄檔會為每次前臺和後臺 bash `ToolExecution` 重新建置受信任的覆蓋層：

- `DSH_HOME` 始終是設定的 Harness home 絕對路徑。獨立的 [`@deepseek-ai/dsh-home-paths`](../../../../packages/util/home-paths/README.md) 工具庫規定其優先級：顯式 `dshHome`，其次是環境中的 `$DSH_HOME`，最後是 `~/.dsh`。
- `DSH_SHELL=1` 始終存在，用於標識由 DeepSeek Harness 管理、面向模型的 bash 子行程。
- 執行具有關聯 agent 時，`DSH_SESSION_ID` 存在並等於 `agent.session.header.id`。
- 內建的持久化轉換層提供 `DSH_SESSION_JSONL` 的條件是 `ctx.sessionPersistence.locate(header)` 返回 `kind: 'jsonl'`。

工作階段持久化仍然是事實所有者：JSONL 不相依性 tool-bash，也不會自行註冊 shell 變數；掛鉤繼續直接使用 `locate()`。tool-bash 是把持久化事實轉換為 shell 約定的轉換層。其他需要向 shell 公開事實的外掛程式相依性該登錄檔，並註冊各自的鍵；它們不修改 `process.env`。

bash seam 匯出 `DSH_ENV_PREFIX` 作為唯一的命名空間來源，並派生 `DshEnvironmentKey`，其來源是該常數的 `typeof`。tool-bash 從該常數派生內建名稱與模型指引，執行器則使用該常數過濾環境中已有的值。seam 透過 `ShellExecRequest.dshEnv`／`ShellExecSpec.dshEnv` 單獨傳遞受管理的覆蓋層：普通 `env` 仍是掛鉤所用的通用行程內外掛程式介面，`dshEnv` 則以類型約束為受管理鍵。本機執行器移除環境中繼承的全部受管理鍵，依次應用普通清理、終端機環境和顯式 `env`，最後合併受信任的 `dshEnv` 快照，因此 `env` 條目永遠無法頂掉受管理的值。這保證了值缺失表示它當前確實不存在，而不是從外層或先前的 harness 繼承而來。面向模型的工具仍忽略模型提供的 `env`／`stdin` 參數。

bash 工具說明只講解持久約定：當前 harness 環境事實透過受管理的 `$DSH_*` 變數提供，可以在需要時查看。它不會枚舉持久化專用鍵，也不會新增永久的系統提示詞章節。工具 schema 已記錄在請求 header 中，工具輸出則記錄為 `tool/result`，因此無需新增工作階段事件。

[Claude Code 和 Codex 掛鉤橋接層](2026-06-30-hook-bridges.md)在構造 payload 時，從同一持久化 seam 解析 transcript 位置。Codex 使用 `transcript_path: string | null`；Claude Code 保留其字串欄位，並回退為 `''`。掛鉤查詢不會物化或刷寫工作階段。

## 同類產品調研

同類產品把穩定標識與物理儲存分開處理。Codex 向 spawn 的 shell 注入穩定的 `CODEX_THREAD_ID`，而 recorder 和掛鉤介面負責提供 transcript 路徑。Claude Code 透過結構化的掛鉤／狀態輸入提供 `session_id` 和 `transcript_path`。OpenCode 在結構化工具上下文中攜帶標識；Kimi Code 展開工作階段佔位符；Reasonix 則把活動工作階段路徑保存在控制器上。可移植的規則是：在呼叫邊界注入標識，由儲存層解析位置，絕不在並行 harness 中使用行程級的當前工作階段全域性變數。

## 生命週期與持久化語義

新工作階段在第一個輪次之前獲得 id，因此它的首次 bash 呼叫即可讀取 `DSH_SESSION_ID` 和 JSONL 目標。JSONL 文件可能要等到第一次成功的輪次結束檢查點後才存在，而且在一個輪次仍未結束時，它只包含上次刷寫的前綴。`DSH_SESSION_JSONL` 是位置提示，不是授權憑據或新鮮度保證。

復原操作複用已載入的 header，因此 id 和位置不變。fork 和 spawn 會建立新的工作階段 id 與位置。父子呼叫分別從自己的 `ToolExecution.agent` 解析事實；即使呼叫重疊，每條命令也會收到不可變快照。替換持久化服務會影響後續收集，因為轉換層在執行時查詢 `ctx.get('sessionPersistence')`；登錄檔本身受 effect 作用域約束，並且可安全用於 HMR（熱模組替換）。

`dshHome` 是與工作階段無關的部署上下文。agent-core 透過 `@deepseek-ai/dsh-home-paths` 解析出一個值，並將其同時傳給 tool-bash 和本機 skill（技能）發現；獨立消費端呼叫同一解析器。如果頂層 `dshHome` 與 `skills.local.dshHome` 均已提供但解析結果不同，組合會失敗，而不會公開互相矛盾的 home。持久化可以獨立變更，無需把其事實凍結到工作階段前綴中。

## 測試

單元測試覆蓋登錄檔聲明校驗、effect 釋放、逐次執行收集、`dshHome` 優先級，以及本機執行器清理並重建 `DSH_*` 的順序。請求錄制測試覆蓋前臺／後臺快照、無 agent 呼叫、持久化不存在或為 JSONL、忽略模型 `env`，以及父子隔離。JSONL／SQLite 定位器約定測試與兩套掛鉤橋接測試均鎖定 transcript 可用和不可用兩種方言。

一項無金鑰的完整迴圈整合測試會在第一個輪次驅動程式真實的 agent loop、JSONL 持久化、tool-bash 與 bash-local。子行程列印 `DSH_HOME`、`DSH_SHELL`、工作階段 id、JSONL 目標和繼承的過時哨兵值；測試校驗當前值、過時變數不存在、刷寫前文件不存在，並最終檢查持久化 header。快照測試會固定錄制請求 header 中的通用 bash 說明。該約定屬於確定性的本機執行，不涉及模型選擇，因此無需帶金鑰測試。

## 考慮過的替代方案

**只提供 id，再用 `find`。** 搜尋無法得知自訂根目錄或後端版面配置，並且在多工作階段環境下存在競態。

**只提供絕對路徑。** 路徑可能不可用、延遲建立或取決於表示形式，不能作為穩定的工作階段標識。

**使用全域性 `process.env`。** 並行 agent 會互相覆蓋，巢狀 harness 也會繼承過時的當前工作階段值。

**把持久化說明放入工作階段前綴。** 活動服務可以在 HMR 或未來的後端切換中改變，而工作階段前綴保持凍結；持久化專用指引會因此變得過時。

**使用類型化 waterfall 事件。** 監聽器不執行就無法聲明所有權，而後續監聽器可以無提示地覆蓋鍵。登錄檔能在註冊時偵測鍵衝突，並且保持可枚舉。

**讓每個持久化後端直接註冊 bash 環境。** 這會反轉相依性方向，讓儲存層相依性某一個消費端，並迫使未使用 bash 的部署也引入它。掛鉤仍然需要 `locate()`。

**增加面向模型的 `session_info` 工具。** bash 已經提供查詢 API，新增工具只會多出 schema 和一次呼叫；登錄檔可以擴充至未來的環境事實，無需為每項事實增加一個工具。

## 影響

每個面向模型的 bash 子行程都會收到當前 Harness home 和 shell 標識，關聯 agent 的呼叫還會收到穩定的工作階段標識。使用 JSONL 後端的呼叫可以獲得選填的目標路徑；非文件持久化會如實省略該值。這些子行程中受管理的 `DSH_*` 事實來自 harness：系統移除環境中已有的受管理值、在最後重新加入當前受信任的值，普通呼叫方的 `env` 條目無法頂掉它們。

該命名空間可被發現，但並非祕密。路徑可能洩露設定的根目錄，延遲建立的目標也可能不存在或處於過時狀態，而且命令可以在自己的 shell 文法中覆蓋變數。消費端應把這些值視為關聯資訊和環境事實，在歸屬關係重要時校驗 transcript 元資料，並依靠沙盒／檔案系統策略而不是變數保密性來完成授權。
