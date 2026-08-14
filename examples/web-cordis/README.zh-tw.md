# web-cordis

[English](README.md) | 繁體中文

[`@deepseek-ai/dsh-tool-cordis`](../../packages/extensions/tool-cordis/README.md) 的自指示例。agent（代理）可以檢查當前 Cordis 行程，並在記憶體中掛載或解除安裝模型編寫的外掛程式。臨時外掛程式會在解除安裝或行程退出時消失，並可能影響同一行程中的其他工作階段。

## 執行

啟動瀏覽器介面：

```sh
pnpm run demo:cordis
```

改為啟動 ACP（Agent Client Protocol）自動化伺服器：

```sh
pnpm run demo:cordis acp
```

這兩條命令都需要 `DEEPSEEK_API_KEY`。[Cordis 工具參考](../../packages/extensions/tool-cordis/README.md)定義了四類約定：工具參數、存續時間、清理行為和安全性。
