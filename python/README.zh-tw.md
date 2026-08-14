# DeepSeek Harness Python SDK

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用於以子行程方式驅動 DeepSeek Harness 的 Python 包。用戶端 SDK 透過 stdio 使用按行分隔的 JSON-RPC 與內建執行時期通訊。

## 包

| 目錄 | 分發名／模組 | 職責 |
|---|---|---|
| [sdk](sdk/README.md) | `deepseek-harness-sdk` / `deepseek_harness` | 高層輪次 API 與低層 JSON-RPC 用戶端 |
| [sdk-runtime](sdk-runtime/README.md) | `deepseek-harness-runtime-bin` / `deepseek_harness_runtime` | 內建執行時期二進位與默認 agent（代理）設定 |

## 行為

除非呼叫方選擇顯式通道，否則 SDK 會啟動匹配的內建執行時期。用戶端選擇通道並提供預設配置；執行時期本身始終要求顯式設定。[SDK 參考](sdk/README.md)和[執行時期載體參考](sdk-runtime/README.md)定義完整的執行時期選擇與設定約定。

## 貢獻者工作流程

[Python 貢獻者工作流程](development.md)介紹執行時期產物建置、包驗證、原始碼模式開發和分發。
