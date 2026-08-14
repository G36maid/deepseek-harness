# 事後檢討（postmortem） 0004：Landlock 部分強制執行通知導致子行程失敗被誤歸類

[English](0004-landlock-partial-notice-misclassified-child-failures.md) | [简体中文](0004-landlock-partial-notice-misclassified-child-failures.zh.md) | 繁體中文

Status: resolved

## 摘要

在 Landlock ABI 較舊的核心上，launcher 會在執行每個子行程前列印一條無害的部分強制執行通知。harness 把共享的 `landlock-run:` 前綴與任意非零子行程結束組合起來，判定為 launcher 失敗，因此 ripgrep 在沒有匹配項時以 1 結束等普通結果會呈現為 `SANDBOX_UNAVAILABLE`；當時仍由 bash 支撐的檔案系統搜尋還會用 `SEARCH_FAILED` 遮蔽這個結構化錯誤。過於寬泛的簽名規則，以及缺少較舊 ABI 下部分強制執行的組合測試覆蓋，讓該缺陷得以流入。runner 分類現在會先精確排除資訊性行，再要求由結束狀態門控的致命證據，並由一個組裝後的無金鑰場景固定仍然存在的 bash 路徑。檔案系統搜尋透過 subprocess seam 執行打包的 ripgrep，不經過沙盒化 bash。

## 概述

原生 launcher 約定區分兩類 stderr 行。核心只能部分強制執行時，會精確列印 `landlock-run: partial enforcement (older Landlock ABI)`，然後繼續執行子行程。launcher 失敗則列印另一行 `landlock-run:` 診斷，在不執行子行程的情況下以 125 結束。

harness 用一個不區分大小寫的 `landlock-run: ` 子串表示這兩種情況。消費端只要發現非零結束同時攜帶該子串，就會歸類為 runner 失敗。因此，子行程的結束狀態被錯誤地關聯到 launcher 的資訊性行：`false`、ripgrep 無匹配時的結束碼 1、無效 pattern 的結束碼 2，乃至由子行程自行選擇的結束碼 125，都可能在約束與執行均成功的情況下被錯誤歸因為沙盒故障。

事故發生時，檔案系統搜尋又造成第二處歸因錯誤。當時由 bash 支撐的 `runRipgrep()` 會捕獲 bash 執行器除中止外拋出的所有錯誤，並將其替換為關於 cwd 或 shell 啟動的通用 `SEARCH_FAILED`，其中也包括沙盒執行器產生的結構化 `SandboxUnavailableError`。

## 影響

在 Landlock ABI 只能部分強制執行的主機上，合法的非零子行程結果可能表現為沙盒基礎設施故障。`glob` 和 `grep` 尤其容易暴露該問題，因為 ripgrep 把結束碼 1 用作成功的空搜尋。當檔案系統搜尋中確實發生沙盒故障時，呼叫方也會丟失其 `SANDBOX_UNAVAILABLE` 錯誤碼，轉而收到錯誤的啟動診斷。

該缺陷沒有削弱約束，也沒有讓命令在無約束狀態下執行。其安全影響在於可用性與診斷完整性：有效的受限結果會被拒絕或錯誤標記。

## 時間線

- 原生 launcher 約定規定：launcher 失敗使用結束碼 125，每次此類失敗都會列印一行致命的 `landlock-run:` 診斷；成功執行子行程時則列印精確的部分強制執行通知。
- 沙盒提供方把該約定簡化為 `runnerFailureSignatures: ['landlock-run: ']`；bash 消費端將此前綴與任意非零結束組合，並報告 stderr 的第一行。
- 單元測試覆蓋了無診斷的成功、拒絕診斷和致命 runner 前綴。真實 runner 測試在沒有可用核心時會自行跳過，也沒有強制構造「部分強制執行通知後跟非零子行程結束」的情況。
- 一個最小 POSIX 包裝指令碼會列印該通知並 `exec` 其負載；它透過 `false` 與 ripgrep 無匹配場景復現了故障。
- 結構化規則、前臺與後臺共享的分類邏輯和組裝後的重播覆蓋共同彌補了仍然存在的沙盒歸因缺口。檔案系統搜尋透過 `ctx.subprocess` 執行打包的 ripgrep；本修復讓該路徑繼續位於沙盒化 bash 之外。

## 根因

公開的沙盒結果類型只能表達一組子字串。它無法表示 Landlock 失敗必須使用結束碼 125、證據必須出現在一行致命診斷內，或同一前綴下有一行精確文字屬於資訊性通知。消費端的布林判定邏輯因此把來自不同行程且互不相關的事實組合在一起；即便致命證據位於後續行，它仍選用 stderr 的第一行作為詳細資訊。

測試矩陣與這種表示方式一致。模擬提供方要麼不輸出 runner 行，要麼輸出含義明確的致命前綴，從不在由子行程控制的非零結束前輸出無害 runner 行。真實 Landlock 覆蓋相依性主機 ABI，因此使用完整 ABI 的主機無法覆蓋該通知。在事故發生時的搜尋實作中，檔案系統搜尋測試模擬了原始 spawn 錯誤，卻沒有覆蓋真實沙盒化 bash 組合拋出的結構化錯誤。

stderr 仍是帶內歸因通道。受限子行程可以故意復現 runner 的門控致命診斷行與結束狀態，造成可用性或診斷誤歸因。更嚴格的多項證據合取可以避免本次事故中的意外衝突，但無法驗證寫入者身份；帶外狀態協定仍屬於獨立的加固工作，而非沙盒繞過修復。

## 已新增的防護措施

- [`RunnerFailureRule`](../subsystems/sandbox.md#wrapped-argv-and-classification-dialects) 攜帶選填的允許結束碼、不區分大小寫的逐行致命簽名，以及按不區分大小寫的整行精確匹配排除的資訊性行。
- [`dsh-sandbox-local`](../../packages/sandbox/sandbox-local/) 把 Landlock 對映為結束碼 125 加一行非通知的 `landlock-run:` 診斷，而 bwrap、Seatbelt 和自訂 runner 仍僅依據簽名。
- [`dsh-bash-sandbox`](../../packages/shell/bash-sandbox/) 直接 spawn 提供方 argv，因此啟動前遭拒時使用 spawn 錯誤通道，而非本機化的 shell 診斷。已結帳的前臺與後臺執行共用一個返回證據的分類器；致命證據優先於拒絕，前臺錯誤會報告匹配到的致命行，同時保持捕獲的 stderr 不變。
- [`dsh-tool-fs-search`](../../packages/fs/tool-fs-search/) 透過 `ctx.subprocess` 執行打包的 ripgrep，並繼續位於沙盒化 bash seam 之外。
- 原生邊界回歸用例位於 [`partial-landlock.spec.ts`](../../packages/shell/bash-sandbox/tests/partial-landlock.spec.ts)，包括資訊性通知、致命證據和前臺／後臺分類。
- 組裝後的產品路徑由 [`partial-landlock` 快照組合](../../examples/acp-agent/partial-landlock.cordis.snapshot.yml)固定，獨立於檔案系統搜尋的實作選擇。

## 教訓

- 行程歸因需要多項獨立證據同時成立；共享前綴不是協定。
- 資訊性診斷與致命診斷可以共享同一命名空間，因此排除規則必須精確且範圍狹窄，同時對未知的致命行保持失敗關閉。
- 配接器必須保留下層 seam 所擁有的結構化失敗，而不能用自身最接近的通用類別將其替換。
- 平臺相關行為需要在原生邊界放置確定性的模擬實作，並覆蓋一條組裝後的產品路徑；會自行跳過的真實核心測試無法獨自固定該回歸。
