# Agent Note：HMR 初始掃描使失敗的啟動死結為靜默的 exit 13

狀態：已實作

[English](2026-08-03-hmr-initial-scan-boot-deadlock.md) | 繁體中文

## 問題

當 `dsh` 啟動時設定樹校驗失敗，行程以 13 退出（未結帳的頂層 await），不輸出任何診斷，並把 TUI 的終端機狀態殘留在 shell 上——這正是 [fail-loud release](2026-07-31-fail-loud-releases-the-terminal.md) 修復過的症狀，在[交易化設定重載](2026-07-20-config-hot-reload-resilience.md)之後經由另一條機制重新出現。

兩個缺陷疊加：

1. **並行的 Include apply 破壞交易化的 group update。** HMR 主 watcher 的 chokidar 初始掃描會把每個已存在的文件重新宣告為 `add`。其中設定檔的 `add` 在 Include 的首次 apply 尚未結束時觸發了 `Include.refresh()`（內容去重鍵 `this.content` 只在 apply 完成後才提交）。同一 group 上兩個並行的 `EntryGroup.update` 會在相同條目上交錯執行 create 與回滾，導致 Include fiber 永遠無法結帳：`loader.create` 掛起，`boot()` 既不 resolve 也不 reject，事件迴圈排空後 Node 以 13 退出。
2. **僅序列化 apply 會讓失敗回滾死結。** 將 Include 的變更排入佇列後，首次 apply 失敗時的回滾會釋放每個已掛載條目——包括 `hmr`，而它的拆卸會等待自身的 refresh 任務排空。掃描觸發的 refresh 任務正排在 Include 佇列中、位於正在回滾的那次 apply 之後：回滾等 HMR，HMR 等 refresh，refresh 等 apply。

## 決定

兩處修復都落在 vendored 包中（記錄於 `vendor/README.md`）：

- `include/src/index.ts` 將每次子樹變更——首次 apply、refresh、`internal/update` 修補程式重應用——匯入每個 Include 一條的 promise 佇列。group 的交易化 `update` 不可重入，因此序列化是正確性要求，而不是吞吐取捨。`refresh()` 也在佇列內讀取文件，使其內容變更判斷與前一任務提交後的狀態比較。
- `hmr/src/index.ts` 給主 watcher 傳入 `ignoreInitial: true`。初始掃描只會重新宣告啟動剛剛消費過的文件；抑制它同時消除了啟動期 refresh 和對已載入模組的多餘 `add` 事件。`registerConfig()` 保留自己 `ignoreInitial: false` 的 watcher，因為註冊時已存在的個人設定必須恰好應用一次。

兩者齊備後，失敗的啟動走上預期路徑：唯一一次 apply 失敗，回滾並 dispose（資源釋放）整棵樹（執行 TUI 自身的 shutdown、復原終端機），`loader.create` reject，`boot()` 重新拋出帶標籤的診斷並以 1 退出。

## 曾考慮的替代方案

**只加 `ignoreInitial: true`。** 消除了觸發條件，但保留了破壞本身：任何真正並行的 refresh（設定編輯與緩慢的 apply 競爭）仍會交錯兩次 group update 並使 fiber 懸置。

**只做序列化。** 把破壞轉化為上述回滾死結；行程仍然靜默地以 13 退出。

**在 HMR 拆卸時取消排隊中的 refresh。** 需要在 `refreshConfig` 的任務迴圈和 Include 佇列中鋪設取消機制，而 `ignoreInitial` 已把該場景從每次啟動中移除；在真實觸發條件出現之前不值得引入這套機構。

## 後果

落在 watcher 啟動掃描視窗內的設定檔編輯，現在由下一個 `change` 事件而非掃描本身拾取；穩態的重載行為不變。

仍留有一個潛在缺口：在一次*失敗的*首次 apply 期間進行的設定編輯，仍可能排入一個被回滾的 HMR 拆卸所等待的 refresh——同樣的死結形態，但觸發視窗縮小到一次失敗啟動的人力尺度。若它真的發生，修復方向是在 HMR 拆卸時取消 refresh 任務。

## 測試

`apps/cli/tests/tui-keyless-smoke.e2e.ts` 中 `dsh` 無效 provider 的 PTY 用例釘住了端到端約定：以 1 退出、帶標籤的 `dsh: plugin tree failed to load:` 診斷指明 `$.providers`、以及證明整棵樹已被釋放的 bracketed-paste 復位序列。此修復之前，同一用例觀察到的是無診斷的 exit 13。重載行為仍由 `packages/boot/app-boot/tests/config-reload.spec.ts` 與 `packages/boot/app-boot/tests/hmr-config.spec.ts` 覆蓋。
