# DeepSeek Harness Python SDK

[English](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md) | [简体中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.zh.md) | 繁體中文

透過 JSON-RPC stdio 驅動 DeepSeek Harness 的 Python 子行程 SDK。執行時期繼承常規的 DeepSeek Harness 環境變數（如 `DEEPSEEK_BASE_URL` 與 `DEEPSEEK_API_KEY`），呼叫方可以直接使用真實模型端點，也可以把這些變數指向本機代理。

請從 PyPI 安裝 `deepseek-harness-sdk` 分發包；匯入模組仍為 `deepseek_harness`：

```sh
python -m pip install deepseek-harness-sdk
```

安裝 `deepseek-harness-sdk` 會同時安裝版本完全相同的 `deepseek-harness-runtime-bin` 平臺 wheel 套件。因此常規入口不需要傳可執行文件參數：

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    result = harness.run("Say hi.")
```

`DeepSeekHarness` 會保留其按需啟動的執行時期子行程，以便在多次呼叫之間複用。請像上例一樣將其用作上下文管理器，或在使用完畢後顯式呼叫 `close()`。

預設情況下，SDK 會啟動 `deepseek-harness-runtime-bin` 包內建的單文件可執行程序 `dsh-jsonrpc-agent`，並透過 `DSH_CORDIS_CONFIG` 注入該包的預設配置，其中包括 stdio JSON-RPC 伺服器、agent core（代理核心）、預載的 DeepSeek 配接器、採用顯式組合語義檢查點策略的 JSONL 工作階段持久化，以及本機 bash。要執行自己的外掛程式組合，請在設定中保留 `@deepseek-ai/dsh-sdk-jsonrpc-server` 設定項，並傳入 Cordis 設定檔路徑。

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`provider` 選擇指定 Cordis 組合所註冊的提供方路由；`model` 是該配接器解析出的模型 ID。`max_tokens` 是一個選填的正整數，用於限制根 agent 及其行程內後代在每次請求中輸出的 token 數量；省略該參數時，由提供方的默認行為決定輸出上限。壓縮摘要繼續使用壓縮外掛程式單獨設定的上限。內建默認組合註冊 `deepseek-official`。自訂組合可以掛載 `llm-pi-ai`，在其中設定各提供方專屬的憑據和端點，並選擇 pi-ai 已安裝 catalog 中存在的任意提供方/模型組合。

[Python SDK 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)提供一套無需使用 Web UI、按步驟完成安裝和首次執行的流程。該教程所用的完整獨立 Cordis 設定檔位於 [`jsonrpc-agent` 示例](https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/jsonrpc-agent/README.md)中。

`Session.run()` 的活動區間從其提示詞被持久 inbox 接收時開始，到整個 agent 下一次進入空閒狀態時結束，並返回 `RunResult(session_id, final_response, finish_reason, events, notifications, session_root)`。`final_response` 是該區間內根工作階段最後提交的助手文字。`finish_reason` 是該區間內根工作階段最後一個 `turn/end` 的 `kind`，例如 `completed`、`max-tokens` 或 `error`；沒有輪次結束時為 `None`。缺少字串 `data.reason.kind` 的 `turn/end` 違反執行時期協議，並會拋出 `SdkProtocolError`。這兩個結果欄位描述的是 `Session.run()` 所界定的活動區間，並不表示某項輸出或結束原因在因果上歸屬於該提示詞。steering（中途引導）、注入的上下文和其他排隊工作，也可能在 agent 進入空閒狀態前參與這段活動。

`HarnessClient` 會在執行時期行程的整個生命週期內保留已發現的 subagent 譜系。每次執行 `Session.run()` 時，`RunResult.notifications` 與 `on_notification` 會按協議傳輸順序收到根工作階段及所有已知後代的通知，其中包括巢狀 subagent 的生命週期事件與工作階段事件。`RunResult.events` 只包含根工作階段事件，因此後代訊息不會覆蓋根工作階段回覆。底層 `session_prompt()` 會立即返回已排隊訊息的 `MessageId`；繞過 `Session.run()` 的呼叫方必須自行負責後續的活動邊界。

也可以透過 `DSH_CORDIS_CONFIG` 為執行時期子行程指定設定。注入邏輯位於 `HarnessClient.start()`，因此底層用戶端按默認方式啟動時也具有該行為：如果啟動方式最終解析為內建執行時期，且既沒有設定 `cordis`，也沒有設定非空的 `DSH_CORDIS_CONFIG`（執行時期將空值視為未設定，注入檢查也是如此），系統就會使用內建預設配置；顯式指定 `runtime_bin`、`bridge_bin` 或 `launch_args_override` 時，則會完全停用該注入。執行時期載體（生產用 exe 與僅限開發的 `node` 閉包）及其取得方式見 [sdk-runtime README](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.md)。

`cwd` 與 `runtime_cwd` 會在啟動子行程、注入環境變數和協議握手前解析為絕對路徑。公開 API 只暴露由 SDK 直接應用的選項：部署 persona 和持久化設定應在 `cordis.yml` 中定義；`session_root` 則保留為設定 `DSH_SESSION_ROOT` 的高層便捷參數。
