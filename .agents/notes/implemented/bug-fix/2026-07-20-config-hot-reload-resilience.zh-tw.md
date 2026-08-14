# Agent Note: 設定熱重新載入不得殺死或降級正在執行的應用

Status: implemented

[English](2026-07-20-config-hot-reload-resilience.md) | [简体中文](2026-07-20-config-hot-reload-resilience.zh.md) | 繁體中文

## Problem

無效的 `cordis.yml` 編輯不得殺死執行中的 agent（代理）；但若一次看似有效的更新先部分替換 Loader 樹，後續設定項才失敗，僅僅保住行程仍不夠。呼叫方還需要能觀察到被拒絕的即時更新，同時不能讓同一個錯誤被當作未處理的啟動失敗。個人設定還帶來第二項要求：HMR（熱模組替換）必須觀察其模組根目錄之外的一個確切文件，即使該文件或其父目錄在啟動後才建立也不例外。

## Decision

vendor 中的 Cordis 生命週期和 Loader 外掛程式提供可等待、帶補償的設定交易，並在 [vendor/README.md](../../../../vendor/README.md) 中記錄為本機修改第 6、8、9 條。

`Fiber.update()` 返回其 `internal/update` waterfall（瀑布式事件）的結果。設定校驗保持同步，而默認 continuation 返回重新啟動 promise。因此，Loader 設定項更新可以區分校驗、匯入、應用和回滾失敗，以及生命週期成功完成。`EntryTree.await()` 會在 Loader 任務排空後重新檢查受服務門控的 fiber，並在 fiber 已結帳為失敗時 reject；等待缺失服務的 fiber 仍是有效的 pending 設定項，不會讓結帳掛起。

Loader 會先匯入變化後的模組名，再 dispose（資源釋放）活動 fiber。它會 await 候選項的應用；若失敗，則 dispose 候選項的 effect，並復原先前的外掛程式或設定。組內對帳會並行啟動各候選項，等待每項結果，並會在拒絕前復原已變更的設定項、新增項、移除項和移動項。只有程序化變更成功後才會持久化。這是一種補償交易：生命週期 effect 可能短暫可見；回滾失敗會報告為 `AggregateError`，而不會被誤稱為樹已保留。

Include 讀取並校驗尚未提交的候選內容，把修補程式應用到其副本，對帳 Loader 樹，然後才提交快取內容和解析資料。解析、校驗、應用或回滾失敗後，`refresh()` 會向呼叫方 reject。初始載入仍會明確報錯；只有文件不存在時纔可以使用 `initial`。YAML/JSON 結果若不是陣列即為無效；文件刷新和 Include 設定更新都會重新應用修補程式，且不修改快取的解析結果。

HMR 收容即時刷新 rejection。其 `registerConfig(filename, refresh)` 方法從最近的現有祖先目錄開始監聽一個確切路徑，序列化並合併刷新，並返回一個非同步 disposer；該 disposer 會關閉 watcher 並排空活躍工作。確切路徑和普通設定檔的刷新都使用此佇列。失敗會被規範化為 `Error`、記入日誌，並透過平行事件 `hmr/config-update-failed(filename, error)` 廣播；發生 rejection 的觀察者會被記錄，但不會阻止後續刷新。建立、變更和移除均會被觀察。

## Alternatives considered

**在 `Include.refresh()` 內收容失敗。** 已否決，因為這會使 HMR 宿主無法廣播失敗，卻仍允許 Loader 對帳掩蓋部分應用。Include 負責候選內容的解析與提交；HMR 負責收容和觀察。

**每次編輯設定都重新啟動行程。** 已否決，因為 Cordis effect 已經提供可逆的外掛程式生命週期，而文法錯誤或選填外掛程式失敗不應只為復原先前的組合就丟棄正在進行的工作階段。

**承諾不可見的原子替換。** 已否決，因為任意外掛程式 effect 無法製作快照。等待應用完成並顯式補償可以得到穩定的最終結果，同時不會聲稱觀察者看不到中間生命週期轉換。

## Consequences

- 即時刷新失敗會在內部 reject；補償成功時會保留或復原上一份完好的樹，並廣播一次類型化失敗，而不會成為未處理的 rejection。
- 回滾失敗可見，並可能使一個設定項不可用；事件和日誌不會誤稱其已復原。
- 等待已聲明相依性的 fiber 仍是有效的 pending 設定項：生命週期完成只表示當前工作均未失敗，而不表示每項相依性都存在。
- 確切設定 watcher 只為已註冊路徑增加檔案系統資源，並隨其所屬 HMR fiber 一起釋放。
- vendor 中的 Loader、Include、HMR 與核心事件類型定義進一步偏離上游；全部分叉均維護在 vendor manifest（中繼資料清單）中。

## Testing

`packages/boot/app-boot/tests/config-reload.spec.ts` 啟動真實的臨時 Loader/Include 樹，並覆蓋對解析和形狀錯誤的拒絕、先匯入再 dispose、外掛程式/設定復原、多設定項回滾、祖先停用、overlay 收斂、option 對象身份、失敗的直接更新不持久化以及失敗的程序化移動。`packages/boot/app-boot/tests/hmr-config.spec.ts` 覆蓋現有和缺失的確切路徑、新增/變更/移除、序列化合併、dispose 排空、非 `Error` 值的規範化、失敗廣播以及對發生 rejection 的觀察者的收容。`packages/host/webserver/tests/webserver.spec.ts` 證明受服務門控的啟動失敗會讓 Loader 組合以其 bind 診斷 reject；`packages/typert/loader/tests/loader.spec.ts` 則透過真實 Loader 消費端演練可等待的程序化移除；ACP（Agent Client Protocol）的 `pty-tools` 快照會防止並行組合改變同優先級提示詞段的順序。
