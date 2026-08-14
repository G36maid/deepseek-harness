# Agent Note: 宿主退出時同步清理受管子行程

Status: implemented

[English](2026-08-11-synchronous-subprocess-exit-cleanup.md) | [简体中文](2026-08-11-synchronous-subprocess-exit-cleanup.zh.md) | 繁體中文

## Problem

本機 subprocess provider擁有普通 detached行程樹和 terminal session，但此前只能透過非同步 Cordis dispose觸及它們。致命 launcher可能在 dispose完成前呼叫 `process.exit()`：[fail-loud release](2026-07-31-fail-loud-releases-the-terminal.md)最多等待兩秒，而本機行程可以擁有更長的終止寬限期。Node進入同步退出階段後，待處理的 Promise與升級 timer不會繼續執行，因此忽略 TERM的子行程可能比宿主存活更久，繼續佔用 CPU、記憶體或埠。部分 ACP、JSON-RPC和 SDK入口也沒有 root release回呼。

公共 subprocess seam在正常 dispose期間承諾等待完全靜止，這項承諾是正確的。缺陷屬於 seam之下另一條最終宿主退出路徑，不應削弱正常生命週期，也不應讓每個 launcher重複保存行程所有權。

## Decision

`LocalSubprocessRuntime`在自身 Cordis effect中安裝一個同步 Node `exit` listener。只有正常 dispose結帳後，同一 effect才移除該 listener。非同步清理仍在等待時，普通和 terminal handle繼續保留在服務已有的存活集合中，因此更短的外層退出上限仍能看到並強制終止它們。等待中的 dispose報告清理失敗時，服務會在清空集合併移除 listener前呼叫同一組同步最終操作。

該 listener使用本機實作私有的最終操作；公共 `SubprocessHandle`和 `SubprocessTerminalHandle`介面不包含這些操作：

- 普通 handle立即向 detached POSIX行程組傳送 SIGKILL，或在 Windows同步執行 `taskkill /PID <pid> /T /F`。
- Terminal handle同步向全部已捕獲及當前可觀察的後代傳送 SIGKILL，終止 PTY root，然後再掃描一次並終止在該邊界期間變得可觀察的成員。
- 服務分別包含每個目標的失敗並繼續處理其餘 handle。回呼不會建立 Promise或 timer，不寫診斷，也不改變原始退出碼或錯誤。

正常 dispose繼續使用[subprocess seam](../architecture/2026-07-26-subprocess-seam.md)的先終止再等待退出路徑：普通行程樹先接收 TERM，經過設定的寬限期後再接收 KILL，並等待每個普通或 terminal清理達到完全靜止。同步路徑只請求最終終止，不發布完成結果，也不聲稱回呼返回時 OS行程樹已經消失。遠端 provider繼續由其 sandbox獨立擁有，不繼承本機 Node listener。

| 宿主路徑 | 本機 provider動作 | 完成證據 |
| --- | --- | --- |
| 正常 Cordis dispose | 協作式終止、有界升級，並等待普通／terminal清理 | dispose結帳前，每個自有 handle均達到完全靜止 |
| `process.exit()`、默認未捕獲例外或默認未處理 rejection | 對服務當前存活集合發送同步最終訊號 | 宿主退出後的外部觀察 |
| 未安裝 handler 時由 `SIGTERM`、`SIGINT` 或 `SIGHUP` 默認終止；`SIGKILL`；fatal OOM；`process.abort()`；native crash；或斷電 | 行程內操作無法執行 | 必須由外部 supervisor、容器或 OS 所有權負責；應用安裝執行 dispose 或呼叫 `process.exit()` 的訊號 handler 時除外 |

## Verification

父測試透過倉庫 source launcher啟動隔離的 TypeScript宿主，等待精確 root與後代行程身份可觀察後，再允許宿主進入各條致命路徑。直接退出、默認未捕獲例外和默認未處理 rejection覆蓋忽略 TERM的普通行程樹；直接退出還覆蓋真實 terminal root與後代。父測試斷言原始宿主退出類別，並等待所有已記錄行程消失；失敗清理只針對已記錄身份或已記錄的 Windows行程樹。

單元證據固定同步 POSIX行程組與 Windows taskkill投遞、PTY root終止前後的 terminal掃描、重複最終清理、逐目標失敗包含、正常 TERM到 KILL dispose、dispose等待期間保留存活集合，以及 dispose後移除 listener。

## Alternatives considered

**只相依性 launcher release回呼。** 拒絕，因為不是每個入口都會提供該回調，而且有界 release仍可能在 subprocess provider的寬限期與 timer完成前結束。

**在 `exit` listener中呼叫現有非同步 `terminate()`。** 拒絕，因為 Node不會等待 exit listener；回呼返回後，Promise、timer、輸出排空與停穩輪詢都無法完成。

**向公共 subprocess handle增加 raw `forceKill()`操作。** 拒絕，因為消費端只需要一項協作式終止約定。立即最終終止屬於實作職責，只由本機服務的宿主退出 owner使用。

**把所有故障模式交給外部 supervisor。** 不接受將其作為唯一方案，因為 Node為幾條常見致命路徑提供可靠的同步回呼，而 provider已經擁有精確目標。JavaScript無法執行時期仍必須相依性外部所有權。

## Consequences

每個有效的本機 subprocess service都會貢獻一個行程全域性 exit listener，並隨服務 effect移除。致命退出放棄寬限、輸出排空與行程內停穩證明，以換取宿主消失前寄出本機可用的最強終止操作。正常 dispose的保證與成本保持不變。

listener無法覆蓋不執行 JavaScript的故障，也無法發現 provider首次觀察前已經逃逸的 terminal後代；該獨立所有權缺口仍由 Issue #1726跟蹤。
