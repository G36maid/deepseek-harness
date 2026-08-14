# `@deepseek-ai/dsh-headless`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

dsh 一次性任務組合包。[`cordis.patch.yml`](cordis.patch.yml) 直接疊加在 [`dsh-base`](../base/README.md) 之上：提供編碼 persona 和工具模式、停用 HMR（熱模組替換）、將 Code Mode 的 worker 作為核心執行能力掛載，並插入本包的 `headless-runner` 外掛程式（設定為 `{task}`，從注入的 `headlessStartup` 提供方解析）。它不掛載任何 Host、HTTP server、Web runtime 或瀏覽器外掛程式。

Loader 結帳後，runner 讀取共享的 [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md)，透過 `ctx.agents` 建立一個全新的持久化 Agent（代理），將任務作為普通使用者訊息提交，並等待完全靜止。它對 Session 執行 flush 後再彙總自身持有的持久化事件區間，將最後一條非空 assistant 文字寫入 stdout，再經啟動器提供的 `ctx.appExit` 宿主掛鉤（[`dsh-cmdline`](../../boot/cmdline/README.md)）請求退出（最終 `turn/end` 完成 → 0，否則為 1）。最終結束原因為 `error` 時，還會將 code 與 message 寫入 stderr；成功執行時期 stderr 保持為空。行程不會打開監聽埠。任務文字就是這個應用的命令列：普通 `headless-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），讀取 `dsh --profile headless "task"` 的位置參數、列印應用自己的 `--help`，並提供 `headlessStartup`；runner 注入該服務，再從惰性設定中讀取任務。缺失或只有空白的任務會在 runner 啟用前被拒絕。

## 模型體驗

無影響，因為 runner 把任務作為普通使用者訊息提交；提示詞與工具由 base 和 headless 組合包中的相應條目提供。

#### KV Cache 影響

無；runner 不向請求前綴新增任何內容。

## 已知限制與暫緩事項

- **只提交一個任務**：runner 沒有用於互動式後續輸入的 surface；它會等待 Agent 在返回 idle 前完成的所有工作，並列印該區間內最後一條非空 assistant 訊息。
- **`ctx.appExit` 由啟動器持有**：在 `dsh` 啟動器之外啟動 headless profile 會在啟用時明確報錯，直到宿主提供該退出請求。
