# 實作手冊：新增 LLM（大型語言模型）配接器

[English](adding-an-llm-adapter.md) | [简体中文](adding-an-llm-adapter.zh.md) | 繁體中文

如何接入一個新的模型提供方。參考實作：`packages/llm/llm-deepseek`（直接 HTTP，SSE（Server-Sent Events）由 `eventsource-parser` 分幀）與 `packages/llm/llm-pi-ai`（封裝 LLM 庫）。請先閱讀 `packages/llm/llm/src/types.ts` 中的 `StreamChunk` 文件——它記錄了兩個配接器都經過驗證的協議約定。

## 基本形態

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

註冊基於副作用，可安全支持 HMR（熱模組替換）；每個提供方路由僅對應一個配接器，重複註冊會拋出例外，多路由註冊要麼全部成功，要麼全部失敗。`options.provider` 用於選擇配接器，`options.model` 是提供方模型 ID，因此動態模型目錄配接器無需重新設定生命週期即可提供新模型。金鑰採用 Cordis 原生方式管理：schemastery Config 帶環境變數回退，透過 cordis.yml 的 `!!js process.env.MY_KEY` 注入。切勿在程式碼中讀取自行約定的金鑰文件。

## 協議義務（兩個實作共同驗證的約定）

- 在 `finish` **之前**寄出 `usage`；`finish` 之後**不再發出任何內容**。穩健做法：緩衝 finish/usage 直到提供方的流結束標記，再統一 flush（可處理提供方在末尾傳送僅含 usage 的區塊的情況）。
- 工具呼叫的 `arguments` 全程為原始 JSON 字串；流式片段以 `argumentsDelta` 傳送。如果你的提供方返回已解析的對象，請在 `block-end` 時重新 stringify。
- 按首次出現的流順序分配塊 `index`；同一個塊的每次 delta 複用該 index。
- 錯誤有且僅有兩條合法路徑：從 `stream()` **拋出**（傳輸與協議故障——使用帶穩定 code 的 `LlmError`），或以 `finish {kind: 'error' | 'aborted'}` 結束流（提供方帶內故障）。消費端兩者都處理；按故障類別選擇路徑並加以文件化。
- 遵守 `options.signal`（將其傳遞給 fetch 或你的 SDK）。
- 如果 `GenerateOptions` 中某個欄位你的提供方無法支持（例如提供方不支持 stop sequences 時收到 `stop` 清單）：拋出 `LlmError(..., 'UNSUPPORTED')`，而非靜默丟棄。
- 如果提供方在後續呼叫中需要回應 ID、簽名或其他原生元資料，請將其最小無損 JSON 投影作為 `finish.replayState` 寄出。重建歷史時驗證該狀態。只有歷史提供方路由和目標提供方路由當前由完全相同的配接器實例擁有時，`LlmRuntime` 才會傳遞該狀態；由配接器決定同模型、跨模型或跨提供方復原是否合法。狀態缺失時，切勿僅根據提供方/模型名稱推斷原生重播。

提供方特有的思考模式開關仍放在配接器的 Config 中。確切模型元資料使用一處提供方無關的能力 seam：實作 `resolveModel()`，返回提供方/模型身份以及選填的 `context` 和 `reasoning` 欄位；僅當存在設定指定的預設值時才聲明 `defaultEffort`；遵守解析模型時傳入的選填 `AbortSignal`。推理（reasoning）強度是由配接器對映到提供方請求的有序不透明 ID。請保留配接器給出的權威選填清單，包括配接器在支持時定義的 `off`；不得暴露最終協議值的具體拼寫，也不得自動調整不支持的值。ID 無需與其協議表示相同。

## 實作結構

讓協定格式（wire format）類型、請求序列化、傳輸解析、區塊轉換和配接器類分別承擔獨立職責；[`llm-deepseek`](../../packages/llm/llm-deepseek/README.md) 是參考版面配置。

## 驗證

遵循[倉庫測試策略](../testing.md)，該策略負責配接器覆蓋、真實提供方檢查和已發布入口要求。
