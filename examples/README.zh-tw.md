# 示例

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

展示 DeepSeek Harness 主要介面和擴充點的可執行演示。每個子目錄負責自己的設定、前置條件、命令和詳細行為。

## mcp-memory

透過通用 MCP 用戶端連線受支持第三方記憶伺服器的選填 overlay。詳見[記憶示例參考](mcp-memory/README.md)。

## headless-agent

非互動式 agent（代理）：接受一項任務並執行，然後以選定的機器可讀或人類可讀格式輸出結果。詳見[無頭示例參考](headless-agent/README.md)。

## jsonrpc-agent

由 Python SDK 和 JSON-RPC 驅動程式的無人值守編碼 agent。詳見 [JSON-RPC 示例參考](jsonrpc-agent/README.md)。

## web-cordis

能夠檢查並更改記憶體中 Cordis 外掛程式樹的自指 agent。詳見 [web-cordis 示例參考](web-cordis/README.md)。

## web-schedule

用於持久、僅限 Session 內提醒的選填 Web overlay。它透過 `schedule_create`、`schedule_list` 和 `schedule_delete` 支持正整數秒的 `after_seconds` 延時與絕對 `at` 目標；活動提醒保存在原 Session 中，該 Session 再次 live 時復原，而 cold 期間不會執行。使用 `dsh web --patch examples/web-schedule/cordis.yml` 啟動；絕對時間 authority 以及交付與復原邊界詳見 [web-schedule/README.md](web-schedule/README.md)。

## acp-agent

面向程序化用戶端的 ACP（Agent Client Protocol）自動化伺服器，支持工作階段、權限和取消操作。詳見 [ACP 示例參考](acp-agent/README.md)。
