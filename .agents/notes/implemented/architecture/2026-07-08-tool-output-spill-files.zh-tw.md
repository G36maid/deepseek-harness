# Agent Note: 工具輸出 spill 策略

Status: implemented

[English](2026-07-08-tool-output-spill-files.md) | [简体中文](2026-07-08-tool-output-spill-files.zh.md) | 繁體中文

## 問題

工具輸出需要有界的模型可見預覽，但部分超大結果仍可能在之後有用。抓取的頁面正文或冗長的工具回應不應完整佔用下一次模型請求，但模型應能使用現有文件讀取工具，在之後查看經過格式化的完整結果。

這項改動之前的行為並不一致。`dsh-bash-local` 已經會在記憶體尾部溢位時，把完整 stdout／stderr 流寫入私有的臨時 spill 文件；普通文字工具結果則仍以內聯形式返回，除非工具自行實作上限。[工具結果保留庫](2026-07-06-tool-result-retention-library.md)負責預覽機制，但不負責儲存，也不負責把這些機制應用於最終工具結果的執行管線策略。

其形態與逾時策略設計一致：工具作者聲明規範值與 Native renderer（原生渲染器），由策略外掛程式在渲染後的內容上執行部署默認的上下文預算。工具仍可在提供方採集上限處提前 spill；由工具負責的展示 spill 可以保留已完整採集的規範值，而只替換展示內容。[規範工具輸出約定](2026-07-20-canonical-tool-output-contract.md)規定了這項區分。

## 決策

在新的 `packages/spill/` 分組下增加一層輕量 spill 儲存 seam 和一個默認 spill 策略外掛程式：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-spill` | 介面：`ctx.spillStore`、詞彙類型，不包含儲存實作。 |
| `@deepseek-ai/dsh-spill-local` | 本機後端：在宿主檔案系統中提供私有、工作階段作用域的文件儲存。 |
| `@deepseek-ai/dsh-spill-policy` | 工具結果策略外掛程式：包裝分發後的最終文字結果，並以保留預覽和 spill 定位符替換超大結果。 |

系統不增加專用的面向模型消費端包。消費端是現有 `ctx.tools` 執行管線：`dsh-spill-policy` 透過 `tools/post-execute` waterfall（瀑布式事件）使用最終工具結果，模型則按照後端隨定位符返回的檢索提示讀取內容。

### spill seam

儲存 seam 保持最小化：保存文字，並返回定位符與檢索提示。

```ts ignore-check
interface SpillStore {
  saveText(input: SaveTextSpill): Promise<SpillRef>
}

interface SpillSource {
  toolName: string
  callId: CallId
  label: string
}

interface SaveTextSpill {
  owner: { sessionId: SessionId }
  source: SpillSource
  suggestedName: string
  content: string
}

type SpillLocator = Branded<'SpillLocator'>

interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

`SpillLocator` 是一個[品牌化的](../../../../packages/util/brand)模型可見控制代碼，由後端返回。本機後端將其渲染為檔案系統路徑；遠端或資料庫後端可以渲染 URI、鍵或命令 token。消費端把它視為不透明值，並使用 `retrievalHint` 渲染，而不是假定 `read` 始終是正確的檢索機制。`SpillOwner.sessionId` 是保存時的儲存命名空間：fork 後的工作階段會從種子日誌繼承已有的 spill 定位符，無需複製它們或重新取得所有權；fork 後的新 spill 使用子工作階段 id。保留期清理可以連同其他舊工作階段產物一起使舊定位符失效；spill seam 不定義逐工作階段的清理策略。

`dsh-spill-local` 只負責儲存細節：選擇工作階段作用域的目錄、安全名稱、防止路徑遍歷、執行寫入，以及返回 `{ locator, bytes, retrievalHint }`。它不負責保留策略、工具結果替換、搜尋或文件檢查。文件寫入 `<root>/session-<hash>/<random>-<safeName>`：`root` 是設定路徑，或延遲建立的私有（0700）行程級臨時目錄；工作階段子目錄是 `sha256(sessionId)` 的短前綴；葉節點由隨機十六進位前綴與呼叫方的 `suggestedName` 組成，後者會被清理成單一路徑段（與 JSONL 後端的 `encodeSegment` 一致）。系統使用 `open(path, 'wx', 0o600)` 寫入，確保獨佔且僅所有者可訪問，因此預先植入的符號連結無法重定向寫入。定位符就是該路徑，檢索提示則告知模型可以在該路徑上使用 `read` 或 `grep`。

### spill 策略

`dsh-spill-policy` 是一個 `tools/post-execute` 結果轉接器，只提供一個設定項：

```ts ignore-check
interface Config {
  /** Omitted means no automatic spill policy. Present means apply to oversized plain text tool results. */
  maxInlineBytes?: number
}
```

省略 `maxInlineBytes` 時，外掛程式不會註冊任何內容，是真正的無操作。設定該值後，它會對最終的純文字工具結果應用默認策略：

1. 讓工具正常執行，透過 `next()` 委託，使下游監聽器先結帳結果。
2. 僅當已接受的最終 `ContentBlock[]` 全部是純文字時，才將其展平；含任何非文字塊的結果保持不變。
3. 如果 UTF-8 位元組大小不超過 `maxInlineBytes`，保持不變。
4. 如果超出上限，使用完整的最終文字呼叫 `ctx.spillStore.saveText()`。
5. 把模型可見結果替換為保留的首尾預覽和 spill 引用。

預覽屬於策略所有的實作預設值：以 `maxInlineBytes` 為上限，使用保留庫的 `TextRetainer` 進行首尾分割。只有第二個部署證明有此需求後，未來設定才會公開預覽大小。

替換文字刻意保持通用，因為策略只知道最終格式化的工具結果，不瞭解工具的內部資源：

```text
<retained preview>

(Omitted N bytes. Full formatted result stored at: /.../session-.../....txt. Use read with offset/limit, or grep this path to search within it.)
```

如果 `ctx.spillStore.saveText()` 失敗（權限、ENOSPC、後端不可用），或呼叫沒有工作階段所有者，或未載入後端，外掛程式會記錄原因並原樣返回結果。spill 失敗絕不會把成功的工具呼叫變為 `isError` 結果，也不會隱藏內聯結果。

策略跳過 `read`，以避免形成 `read -> spill file -> read again` 迴圈。額外的選擇退出設定要等確實出現第二個有此需求的工具後再引入。

## 示例：web_fetch

`web_fetch` 是首個示例，因為它天然會返回較大的文字結果，而且無需工具專用的 spill 程式碼。該工具本身無需特殊處理：

```ts ignore-check
ctx.tools.register(defineTool({
  name: 'web_fetch',
  output: {
    schema: WEB_FETCH_RESULT_SCHEMA,
    render: (_args, value) => [{ type: 'text', text: formatFetchOutput(value) }],
  },
  async execute(args, exec) {
    const result = await ctx.web.fetch({ url: args.url }, exec.signal ? { signal: exec.signal } : undefined)
    return result
  },
}))
```

設定 `dsh-spill-policy` 後，格式化後的大型 fetch 結果會自動保留並 spill。部署透過把提供方資源上限設得高於策略上限來展示此行為：

```yaml
- id: web-fetch-http
  name: '@deepseek-ai/dsh-web-fetch-http'
  config:
    maxBodyChars: 500000

- id: spill-local
  name: '@deepseek-ai/dsh-spill-local'

- id: spill-policy
  name: '@deepseek-ai/dsh-spill-policy'
  config:
    maxInlineBytes: 50000
```

這項分離很重要。`web-fetch-http` 仍負責資源上限（`maxResponseBytes`、`maxBodyChars`），用來保護網路、記憶體和解碼工作。`spill-policy` 只負責結果已經存在後針對模型上下文的上限。如果提供方已經返回 `truncated: true`，spill 文件包含的是工具返回的完整格式化結果，而不是原始網頁全文；策略不會做出其他承諾。

## 與保留和提前 spill 的關係

保留與 spill 儲存相互獨立：

- `@deepseek-ai/dsh-output-retention` 負責預覽機制（`TextRetainer`、`ItemRetainer` 和省略元資料）。
- `@deepseek-ai/dsh-spill` 負責保存最終文字，並返回定位符與檢索提示。
- `@deepseek-ai/dsh-spill-policy` 在工具管線中應用默認的最終結果策略，將前兩者組合起來。

最終結果策略不能取代由工具負責的提前 spill。部分有用內容並不存在於最終 `ToolExecutionResult.content` 中：

- `bash` 的最終輸出已經是尾部內容加臨時 spill 路徑；完整的 stdout／stderr 流位於執行器文件中。
- `subagent` 的最終輸出是 subagent 的最終回答，而不是 subagent 的執行軌跡。
- 未來的工具可能生成從未出現在最終 `ToolExecutionResult.content` 中的執行時期產物。

這些場景可以在後續工作中直接使用 `ctx.spillStore`，不屬於首個示例的範圍。

## 非目標

- v1 不增加面向模型的 `artifact_read` 或 `artifact_search` 工具。
- v1 不增加逐工具的保留設定。
- 不增加面向模型的逾時／截斷參數。
- 不把 `read` 輸出遷移到 spill 文件。
- 不取代 `web-fetch-http.maxBodyChars` 等提供方／資源上限。
- 第一版不統一 bash 暫存檔，也不採集 subagent 執行軌跡。

## 延後事項

- 用於現有執行器 spill 文件的 `saveFile()`／`linkOrCopy`，這是統一 bash 行為所必需的。
- 由工具負責的 subagent 執行軌跡 spill（`await run.result`，在 `run.dispose()` 前讀取行程內子工作階段，保存 JSONL）。
- 如果內建的 `read` 跳過規則不足，再增加逐工具選擇退出或逐工具策略聲明。
- 面向 ACP（Agent Client Protocol）或遠端環境的遠端／資料庫儲存後端，因為本機路徑在這些環境中沒有意義。
- 舊 spill 文件的清理和保留策略，很可能與工作階段清理綁定。

## 測試

- `dsh-spill` 單元測試鎖定 seam 約定：註冊為 `ctx.spillStore`、每個上下文只允許一種實作，並在 dispose（資源釋放）時釋放。
- `dsh-spill-local` 單元測試覆蓋 `saveText`、`encodeSegment` 清理（分隔符／波浪號／完整路徑段的點／空值）、工作階段雜湊目錄、僅所有者權限、每次保存生成不同路徑、設定根目錄／私有根目錄，以及儲存失敗時的拒絕。
- `dsh-spill-policy` 單元測試透過 `ctx.tools.execute` 驅動真實工具：停用模式下無操作、替換超大文字、小結果／非文字結果保持不變、跳過 `read`、盡力回退（保存失敗／無後端／無所有者），以及下游組合（限制已替換結果、保留 `additionalContexts`）。
- `dsh-tool-web` 整合測試驅動 `web_fetch`，其實際執行路徑經過 `ctx.tools.execute`，並使用真實的 `spill-local` 後端與策略；測試證明只有刻意加入的 spill 提示會改變模型可見文字，而 spill 文件保存完整的格式化結果。
- `tui-agent` 示例載入 `spill-local` 與 `spill-policy`，因此其無金鑰 Loader／PTY 冒煙測試會執行真實載入路徑（namespace-plugin 匯出形態與 `inject`）。

## 影響

默認策略只能看見最終格式化文字。它無法保留已經由提供方限制的內部內容，也無法保留從未成為結果一部分的執行時期產物。第一版聚焦最終結果 spill 而不是提前 spill，因此可以接受這一限制；由工具負責的提前 spill 仍屬於後續工作。

本機後端返回真實路徑，使 v1 保持簡單並符合已經驗證的 agent（代理）工具行為；seam 本身只承諾一個不透明定位符加檢索提示，所以遠端後端可以返回非文件定位符。

本機後端的價值取決於現有 `read`／`grep` 工具能否檢查返回的本機路徑，即使 spill 目錄位於工作階段 cwd 之外。目前這一條件成立，因為檔案系統策略會記錄觀察結果並設定寫保護，但不會把讀取限制在工作區內。未來的工作區限制策略必須顯式允許本機 spill 路徑，或改用檢索提示指向受支持讀取器的非文件 spill 後端。

**快照缺口。** 目前沒有 ACP 快照場景覆蓋 transcript（文字記錄）可見的 `web_fetch` spill 提示。ACP 快照 harness 在無金鑰環境中重播，無法訪問即時 web，而 `web_fetch` spill 需要一個真實的超上限 HTTP 正文；確定性場景需要一個預置的 loopback fetch 目標，但當前重播樹尚未接線（示例根本沒有載入 `tool-web`）。該行為改由 `dsh-tool-web` 針對 loopback server 的整合測試覆蓋。彌補該缺口屬於後續工作：把 `tool-web` 和預置 fetch 目標接入 ACP 示例，然後錄制 `web-fetch-spill` 場景。

如果策略開始負責工具專用語義，就會膨脹得過大。它的範圍保持狹窄：只處理純文字最終結果。由工具負責的提前 spill 仍留作未來工作。

## 考慮過的替代方案

**要求每個工具透過保留聲明選擇加入。** v1 不予採納，因為目標是實作類似 Claude Code 通用工具結果持久化的默認行為。只需一個 `maxInlineBytes` 部署設定項即可驗證該形態。

**把 `tool-results` 建成寬泛的工具結果平臺。** 不予採納：寬泛的包名會誘使系統把保留策略、結果替換、預覽措辭、搜尋和提前 spill 合併進一個 seam。可共享的儲存部分更小：保存文字，並返回定位符與檢索提示。

**使用 `ctx.fs.writeText` 或面向模型的 `write` 工具。** 不予採納：工作區檔案系統寫入帶有項目文件語義、寫入／編輯策略、觀察狀態和麵向使用者的副作用。spill 文件是執行時期產物，不是由模型編寫的工作區改動。現有 `read` 工具之後可以檢查它們，但建立操作屬於執行時期 spill seam。

**讓 `web-fetch-http` 不受限地抓取，只依靠 spill-policy。** 不予採納：spill-policy 在最終工具結果已經存在之後才執行，無法保護網路、記憶體或解碼資源。提供方資源上限仍然必須存在。

**把保留合併進 spill 機制。** 不予採納：保留與 spill 職責不同。`TextRetainer`／`ItemRetainer` 決定保留哪部分預覽、又省略了什麼；spill 儲存只負責保存策略要求的最終文字。
