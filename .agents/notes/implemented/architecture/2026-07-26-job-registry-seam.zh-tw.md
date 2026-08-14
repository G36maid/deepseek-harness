# Agent Note: 任務登錄檔是一個能力 seam（`dsh-jobs` / `dsh-jobs-local`）

Status: implemented

[English](2026-07-26-job-registry-seam.md) | [简体中文](2026-07-26-job-registry-seam.zh.md) | 繁體中文

## 問題

[背景工作執行時期](2026-06-20-generic-long-running-tool-runtime.md)交付時把 `JobRegistry` 做成了單個具體包：`@deepseek-ai/dsh-jobs` 既擁有每個生產方和控制器面向程式設計的 `ctx.jobs` 約定，也擁有行程內 Service Provider（記憶體儲存、結帳簿記、所有者清理 effect、拆除）。這種捆綁重新耦合了倉庫[能力 seam 規則](2026-06-13-capability-seams.md)本要分離的兩種變化速率：一旦替換登錄檔的儲存或生命週期後端，被攪動的就是同一個包，而生產方（`dsh-tool-bash`、`dsh-tool-terminal`、`dsh-tool-subagent`）、控制器（`dsh-tool-jobs`）和 `JobKindMap` 擴充方正是從這個包匯入類型與 `ctx.jobs` API。harness 中其餘每項可替換能力——bash、pty、fs、skill（技能）、subagent、web、工作階段持久化——都已具備 Service Definition / Service Provider / Consumer 三分；任務登錄檔曾是僅剩的 `core` 模式例外，僅由一條 `TODO(job-service-backend)` 註釋把守。

## 決策

`jobs/` 如今是一個 bash 三件套形態的三包能力家族：

- **`@deepseek-ai/dsh-jobs`（Service Definition）**——抽象的 `JobRegistry extends Service`，擁有 `ctx.jobs`、九個方法的約定（`start`、`list`、`get`、`read`、`kill`、`wait`、`onJobDone`、`onJobsChanged`、`attachController`）、全部詞彙類型（`JobId`、`JobKindMap`、`JobStart`、`JobHooks`、`JobOutcome`、`JobSnapshot`、`JobRead`、`JobDoneListener`），以及快照不變式配套外掛程式。類級 JSDoc 陳述了每個 Service Provider 都必須兌現的語義：註冊的存續期長於生產方與控制器的 fiber，有所有者的訪問以工作階段為界，結帳遵循首次結果優先且監聽器錯誤被隔離，並且當沒有任何已附加的任務控制器服務於 spec 的所有者時 `start` 拒絕啟動工作（控制器與監聽器按 scope 分層，因此一個行程級登錄檔能逐所有者地回答這兩個問題）。
- **`@deepseek-ai/dsh-jobs-local`（Service Provider）**——`LocalJobRegistry`，即行程內登錄檔：記憶體儲存、按 kind 劃分的 id 計數器、等待方簿記、`TASK_WAIT_TIMEOUT` deadline 程式碼、所有者清理 effect、強制失敗的拆除，以及預設值為 10 且可設定的准入策略。准入從同一組記錄中按確切 owner 派生 `running` 加 `stopping` 容量，並為無 owner 任務使用一個共享桶；它不新增公開計數或第二個狀態 owner。`dsh-timeout` 相依性與由 Schemastery 管理的 Service Provider 設定都位於此包；Service Definition 包不含任何提供方相依性。
- **`@deepseek-ai/dsh-tool-jobs`（Consumer）**——保持不變；它注入 `'jobs'`，從不匯入提供方類型。

各組合在原先載入 `dsh-jobs` 的位置改為載入 `dsh-jobs-local`：CLI（命令列介面）的 cordis.yml 設定項、`agent-spine-demo`、各測試 harness，以及工具目錄生成器的啟動流程。生產方的設定錯誤診斷資訊（「background jobs unavailable: load …」）點名 `dsh-jobs`——即聲明缺失的 `ctx.jobs` 服務的 Service Definition 包；Service Definition 包自身的 API（其 README 與直接掛載防線）會指向各 Service Provider，因此當另一個後端日後成為推薦默認時，生產方的訊息依舊正確。生產方、`JobKindMap` 聲明合併和控制器仍然只匯入 `@deepseek-ai/dsh-jobs`。

該 seam 保持行程內約定語義不變：`JobStart.run()` 仍然傳入回呼和確切的 `Agent` 對象，因此持久化或跨行程後端在能滿足此 Service Definition 之前仍有設計工作要做（身份、重新啟動、所有權、觀察）。這次拆分把該項未來工作移出了每個 Consumer 的相依性圖；它並不預先設計後端。

## 曾考慮的替代方案

**在第二個後端出現之前保持具體服務（維持現狀）。**這正是執行時期 Agent Note 當初的立場：在第二個 Service Provider 出現前抽取 Service Definition，可能固化錯誤的邊界。該方案落選，因為這條邊界已不再是臆測：九個服務方法及其語義自引入以來在每一次生產方整合中都保持穩定，它們正是 `dsh-tool-jobs` 與各生產方已經面向程式設計的那套介面，而且倉庫約定默認將可替換能力拆成三個包。剩餘風險（持久化後端可能需要變更約定）不因這次拆分而改變：無論拆分與否，這類變更都會落在 Service Definition 包裡；而若維持現狀，它們今天還會連帶攪動每個 Consumer 的提供方相依性。

**在單個包內僅抽取 Service Definition（在具體類旁匯出一個抽象類）。**否決，因為它在運作層面並未分離任何東西：Consumer 依然相依性攜帶 Service Provider 及其相依套件的那個包，而替換後端若不把本機 Service Provider 納入自身相依性圖，就仍然無法發布。在這裡，包邊界纔是獨立演進的單位。

**拆出 `types.ts` 但讓服務保持具體。**基於同樣的理由否決：類型並不是完整能力，`ctx.jobs` Service Definition 及其方法約定纔是。生產方需要的是服務鍵和語義，而不只是類型形狀。

## 後果

換來的是：任務登錄檔如今與全倉庫通行的 seam 形態一致；持久化、遠端或帶插樁的登錄檔將是一個實作九個抽象方法的同級 Service Provider，這樣的登錄檔落地時，任何生產方、控制器或 `JobKindMap` 擴充方都無需改動。Service Definition 的 README 陳述約定；生命週期簿記方面的事實歸 Service Provider 的 README 所有。登錄檔行為測試套件（所有者清理、結帳、等待、拆除）隨 `dsh-jobs-local` 存放；Service Definition 包保留一個樁子類（stub subclass）測試，固定 `ctx.jobs` 下的註冊行為與單一服務的重複註冊行為，外加基於探針的不變式測試套件。

代價是：多出一個包，即多一份 manifest（中繼資料清單）、tsconfig、README 與不變式配套外掛程式；同時各組合必須點名 Service Provider 包。`abstract` 在執行時期會被擦除，而這個包名過去正是可掛載的具體登錄檔，因此直接掛載 Service Definition 時，其構造函式會明確報錯——一條過時的組合設定行會在載入時得到「load a Service Provider such as @deepseek-ai/dsh-jobs-local」，而不是一個未完整註冊的 `ctx.jobs` 在遠離錯誤設定處才失敗。
