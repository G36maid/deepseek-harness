# examples/：開箱可執行的示範組合包

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

預先組合的外掛程式組合包，供輕量葉節點 `cordis.yml` 載入，無需手工組裝主幹和執行入口。這些是 **示範／參考** 包；npm 名稱的 `-demo` 後綴表明每個包都不屬於產品對外介面，直接查看包名即可辨認。倉庫根目錄 [`examples/`](../../examples/AGENTS.md) 下的可執行葉節點與 [Python SDK 執行時期](../../python/sdk-runtime/README.md) 是消費端；每個消費端都只包含可替換後端和一個組合包入口。

| 包 | npm 名稱 | 角色 |
|---|---|---|
| [`agent-spine-demo/`](agent-spine-demo/README.md) | `@deepseek-ai/dsh-agent-spine-demo` | 可複用的 agent-spine（代理主幹）組合包 |
| [`acp-demo/`](acp-demo/README.md) | `@deepseek-ai/dsh-acp-demo` | ACP（Agent Client Protocol）自動化應用組合包 |
| [`jsonrpc-demo/`](jsonrpc-demo/README.md) | `@deepseek-ai/dsh-sdk-jsonrpc-demo` | 外部設定 JSON-RPC 執行時期 |

`agent-spine-demo` 是共享組合包；`acp-demo` 新增自動化入口，`jsonrpc-demo` 則啟動由部署方擁有的外掛程式樹。產品單次執行由 `dsh --profile headless` 提供；本目錄沒有任何包提供該功能。

這些包不是產品 API。產品 seam 與產品入口仍位於各自的歸屬組；示範組合包選擇具體組合。

不要將此組與倉庫根目錄的 [`examples/`](../../examples/AGENTS.md) 混淆：該目錄存放可執行的 `cordis.yml` **葉節點**；此組存放這些葉節點載入的 **組合包**。
