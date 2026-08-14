# `@deepseek-ai/dsh-loader-smoke`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用於測試透過 Cordis Loader 啟動應用和 `cordis.yml` 的共享子行程 harness。`resolveExampleLaunch` 選擇本機 `src` mode（tsx 和根 tsconfig 路徑）或 CI `lib` mode（普通 Node 和包匯出）；選擇依據為顯式 mode 或 `DSH_EXAMPLE_MODE`。

`runLoaderSmoke` 接受可執行檔案路徑和設定路徑、選填的完整可執行文件參數、環境變數覆蓋、標準輸入、執行前準備和清理前檢查。它負責隔離工作目錄、DSH 主目錄、診斷、截止時間、終止、EOF 和清理；行程以零狀態退出後返回兩個流，失敗時則返回拒絕並附帶兩個流。

`runFixtureTurn` 透過恰好一個已設定的根 agent（代理）驅動一項任務，在該任務進入持久收件箱後轉發規範事件，刷寫工作階段，並返回最終 assistant 文字和累計用量。示例本機 driver 繼續負責設定、渲染和斷言。

這是支持層測試基礎設施，而非產品 API。

## 模型體驗

無，因為測試 harness 僅提交呼叫方測試的普通使用者任務，並將提示詞和工具組裝交由已載入的樹負責。

#### KV Cache 影響

除已載入樹本身的影響外，無其他影響；該 helper 既不更改請求前綴，也不跨執行保留狀態。

## 已知限制與暫緩事項

- **建置模式需要事先建置**：設定還必須能夠透過 `examples/node_modules` 向上解析每個命名包。
- **捕獲的 stdout 和 stderr 僅受 execa 默認 100 MB `maxBuffer` 約束**：失控子行程會在該上限處被終止，而不是在冒煙測試自選的預算處。
- **逾時只終止直接子行程**：有故障的 fixture（測試前置資料）spawn 的行程樹可能比冒煙測試存活更久，需要外部清理。
