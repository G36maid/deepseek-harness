# Agent Note: MCP 用戶端外掛程式——連線外部 MCP 伺服器並橋接其工具

Status: implemented

[English](2026-07-07-mcp-client-plugin.md) | [简体中文](2026-07-07-mcp-client-plugin.zh.md) | 繁體中文

## 問題

harness 此前無法消費 MCP（Model Context Protocol）生態中的工具。MCP 是工具伺服器的新興標準——GitHub、檔案系統、資料庫、程式碼搜尋以及數百個社區伺服器都透過 MCP 暴露工具。使用者希望將 harness 指向一個或多個 MCP 伺服器，讓其工具以原生的模型可見工具形式出現，而無需為每個伺服器編寫膠水程式碼。

`ToolRuntime` 已經接受原始 JSON Schema 工具定義（`dsh-tools` README 中有記錄：「Raw JSON-Schema tool definitions (from MCP servers) are still accepted by `ToolRuntime.register()` directly」），擴充實作手冊（cookbook）也勾勒了預期模式（「MCP | one plugin per server: discover tools → `ctx.tools.register()`」）。基礎設施已就緒，缺的是橋接外掛程式。

## 決策

### 包

單個包 `@deepseek-ai/dsh-mcp-client`，位於 `packages/mcp/mcp-client/`。不做能力 seam 的三包拆分——可預見範圍內不會有第二種 MCP 用戶端實作，且約定是「不要預防性拆分」（[能力 seam Agent Note](../architecture/2026-06-13-capability-seams.md)）。

### SDK

使用官方 [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)（`Client`、`StdioClientTransport`、`StreamableHTTPClientTransport`）。harness 不自行實作 JSON-RPC，與 ACP 委託給 `@agentclientprotocol/sdk` 的做法一致。

### 範圍

僅 MCP Client（不含 server 端——ACP 已承擔「將 harness 暴露為 agent」的角色）。僅橋接 **Tools**——Resources 和 Prompts 延後處理（它們需要 harness 側尚不存在的消費機制，且設計空間較大）。

### 外掛程式形態

命名空間外掛程式（具名匯出 `name`/`inject`/`Config`/`apply`，無 `export default`）。`inject: ['tools']`。每個 MCP 伺服器對應 `cordis.yml` 中的一個外掛程式實例——同一個包以不同設定載入 N 次，與 `dsh-tool-subagent` 相同。

### 設定

以 `transport` 欄位為判別的扁平聯合類型：

```typescript
interface StdioConfig {
  transport: 'stdio'
  serverName: string          // required namespace, ^[A-Za-z0-9_-]{1,32}$
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolCallTimeoutMs?: number  // default 60_000
}

interface StreamableHttpConfig {
  transport: 'streamable-http'
  serverName: string          // required namespace, ^[A-Za-z0-9_-]{1,32}$
  url: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number  // default 60_000
}

type Config = StdioConfig | StreamableHttpConfig
```

`serverName` 是穩定的本機標識，用於在模型可見名稱（見下文）中為該伺服器的工具提供命名空間。它有意設計為使用者設定，而非遠端的 `serverInfo.name`：遠端名稱是不可信輸入、跨部署不唯一（同一伺服器的生產和預發布實例報告相同名稱）、且可能在伺服器升級時變化——這些都不得靜默重新命名模型可見工具。多個活躍實例使用重複的 `serverName` 屬於設定錯誤：後加載的實例在啟動時以可操作的錯誤訊息失敗，絕不靜默覆蓋或跳過。短 `serverName`（如 `gh`）也是縮短公開名稱的設定手段。

`cordis.yml` 用法示例：

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js `Bearer ${process.env.MCP_TOKEN}`
```

模型看到的是 `mcp__github__create_issue`、`mcp__github__search_code`、`mcp__web__search`。

### 生命週期

啟動時從 `cordis.yml` 載入。HMR（熱模組替換）（`@cordisjs/plugin-hmr`）提供熱替換：編輯 yml 條目觸發舊實例的 dispose（資源釋放）（中斷連線連線、註銷工具），並建立新實例（連線、發現、註冊）。目前不提供執行時期動態 API。公開名稱是 `(serverName, rawName)` 的純函式，因此保持 `serverName` 不變的 HMR 替換會重建完全相同的模型可見名稱——工作階段歷史和權限規則保持有效——而新增或移除不相關的伺服器永遠不會重新命名已有工具。

### 工具發現與註冊

每個 MCP 工具有兩個名稱：

- `rawName`——MCP `Tool.name` 的原始值，僅用於協議通訊（`tools/call`）。
- `publicName`——在 `ToolRuntime` 中註冊的全域性唯一模型可見名稱：

      mcp__<serverName>__<rawName>

這種按伺服器限定的形式是多伺服器 agent 用戶端事實上的標準——所有被調研的終端機使用者產品都按伺服器限定 MCP 工具名（[Claude Code](https://code.claude.com/docs/en/agent-sdk/mcp#tool-naming-convention) `mcp__github__list_issues`、[Codex](https://openai.com/index/unrolling-the-codex-agent-loop/) `mcp__weather__get-forecast`、[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/#3-tool-naming-and-namespaces)、[VS Code](https://github.com/microsoft/vscode/blob/ab9ec62c6a61e429a9abd612ff220c3f4834c9ea/src/vs/workbench/contrib/mcp/common/mcpServer.ts#L217-L260)、[Cline](https://github.com/cline/cline/blob/52fdbb1d72f7324a28142a7ba7678d4b53c902f4/sdk/packages/core/src/extensions/mcp/name-transform.ts#L20-L35)、[Roo Code](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/utils/mcp-name.ts#L117-L140)、[Goose](https://github.com/block/goose/blob/b3a012cbdde854b0fe14f95b1c48543bf6517c0a/crates/goose/src/agents/extension_manager.rs#L1391-L1441)、[OpenCode](https://github.com/anomalyco/opencode/blob/d199b1bff90282a4f9cd6251b5fc7b16875a52f6/packages/opencode/src/mcp/catalog.ts#L117-L120)）；`mcp__<server>__<tool>` 的拼寫方式與 Claude Code 和 Codex 一致。`mcp__` 前綴將 MCP 註冊與原生工具的命名空間隔離，並為權限/遙測規則提供穩定的匹配模式（`mcp__*`、`mcp__github__*`）。

1. 連線時：遍歷 `client.listTools()` 的分頁結果，推導每個工具的 `publicName`，然後透過 `ctx.tools.register()` 將其註冊為原始 `ToolDefinition`。MCP 的 JSON Schema 和描述原樣透傳（不做 `defineTool` DSL 轉換）；僅替換模型可見的 `name`。
2. 監聽 `notifications/tools/list_changed` → 重新執行同步（dispose 上一代、註冊新一代）。確定性命名意味著未變化的工具在重新同步後保持原名。
3. 執行器閉包持有 `rawName`；公開名稱永遠不傳送給伺服器，也永遠不被解析以還原原始名稱。
4. 無 `presentCall`/`presentResult`——UI 消費端使用提供方無關的通用卡片兜底。
5. 工具在系統提示詞中是透明的——除名稱本身外不附加「[via MCP]」標注。

### 公開名稱規範化

MCP 允許工具名最長 128 字元且可包含 `.`；DeepSeek 的函式名約定允許 `[A-Za-z0-9_-]` 且最多 64 字元。公開名稱按確定性規則規範化：非法字元替換為 `_`，當替換或截斷改變了名稱時，追加 `(serverName, rawName)` 標識的 12 位十六進位 SHA-256 hash，確保不同的 MCP 標識永遠不會坍縮為同一個公開名稱：

```typescript
function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const hash = sha256(`${serverName}\0${rawName}`).slice(0, 12)
  return `${normalized.slice(0, 64 - 13)}_${hash}`
}
```

### 名稱衝突處理

MCP 僅保證工具名在[單個伺服器內](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-names)唯一；跨伺服器衝突是常態而非例外（一項[微軟研究院調查](https://www.microsoft.com/en-us/research/blog/tool-space-interference-in-the-mcp-era-designing-for-agent-compatibility-at-scale/#namespacing-issues-and-naming-ambiguity)覆蓋 1,470 個伺服器，發現 775 個衝突的工具名；僅 `search` 就出現在 32 個伺服器中，官方 GitHub 伺服器發布的是裸名 `create_issue`）。始終啟用的命名空間從結構上杜絕衝突，而非在衝突發生時再處理：

- 兩個伺服器都發布 `search` → 共存為 `mcp__github__search` 和 `mcp__web__search`。
- 名為 `search` 的原生 harness 工具不受影響。
- 重複的 `serverName` 設定使後加載的實例在啟動時失敗（見設定一節）。
- 伺服器列出重複的工具名屬於無效工具清單：同步拋出例外，上一代註冊保持不變。
- 替換期間的登錄檔衝突只可能意味著外部工具佔據了該伺服器的 `mcp__<serverName>__` 命名空間：部分代註冊被回滾（該伺服器零工具），並以醒目日誌記錄錯誤。

工具永遠不會被靜默跳過；哪些工具可用永遠不取決於外掛程式載入順序。

### 命名不變式

1. 每個 MCP 工具擁有穩定標識 `(serverName, rawName)`；每個活躍標識恰好對應一個公開名稱。
2. 公開名稱是確定性的、全域性唯一的，且滿足 DeepSeek 64 字元 `[A-Za-z0-9_-]` 約定。
3. MCP `tools/call` 始終接收原始的 raw name。
4. 連線、中斷連線或重新同步不相關的伺服器永遠不會重新命名已有工具。
5. 註冊順序永遠不決定哪個工具可用。

### 工具執行

為來自同一個 MCP 伺服器的所有工具提供統一的 `execute` 處理器：

1. 解析 `rawName`（執行器閉包持有它），以設定的逾時時間呼叫 `client.callTool({ name: rawName, arguments }, { signal: exec.signal })`——公開名稱永遠不傳送給伺服器。
2. 對映結果：
   - 多個 `text` 內容區塊 → 以 `'\n'` 連線為單個 `TextBlock`（之所以必須這樣做，是因為 `flattenText` 使用無分隔符的 `join('')`，多個內容區塊會丟失塊間邊界）。
   - `image` 內容區塊 → 丟棄並 `ctx.logger.warn`（harness 沒有圖片內容區塊類型；[刪除圖片 Agent Note](../simplification/2026-07-04-drop-image-content-block.md)）。
   - `isError: true` → 對映到 harness 的 `isError` 結果路徑（`{ content: [...], isError: true }`）。
3. 取消：`exec.signal`（來自 agent loop（代理循環）的取消）透傳給 MCP SDK 的 `callTool`，後者向伺服器傳送 `$/cancelRequest`。

### 子行程環境（stdio 傳輸）

以子行程服務邊界共享的 `scrubbedParentEnv()` 為基礎建置子行程環境；該基礎環境會移除環境中匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的名稱以及 `DSH_*` 名稱，然後在其上合併 `config.env`。顯式設定的 env 覆蓋在清洗後仍會保留。

### 斷連 / 崩潰

每個實例的連線監督器在連線丟失後以有界指數退避和單次故障嘗試預算自動重連，成功後重新執行發現流程；嘗試耗盡則註銷該伺服器的工具並停止，直到重新載入。[自動重連 Agent Note](2026-08-06-mcp-client-auto-reconnect.md) 擁有該決策，包括 `reconnect` 設定塊和復原手動 HMR/重新啟動復原的 `reconnect.enabled: false` opt-out。

## 曾考慮的替代方案

### MCP Server 端（將 harness 工具暴露給外部 MCP 用戶端）

延後。ACP 橋接已將 harness 暴露為 agent 伺服器。再加一層 MCP server 會以不同協議重複這一功能，而使用者的首要需求是消費外部工具，而非暴露自身工具。

### 能力 seam 三包拆分（介面 / 實作 / 消費端）

否決。可預見範圍內不會有替代的 MCP 用戶端實作——MCP 只有一個協議、一個 SDK。約定是「不要預防性拆分」，直到出現第二種實作。

### 指數退避自動重連

v1 否決：引入了部分可用狀態（工具已註冊但暫時不可用），且 stdio 崩潰往往表明設定問題，重試無法修復；HMR 曾是復原路徑。運營回饋扭轉了該延期決定——[自動重連 Agent Note](2026-08-06-mcp-client-auto-reconnect.md) 以有界的單次故障預算和 opt-out 實作了自動重連。

### 橋接 Resources 和 Prompts

延後。Resources 需要 harness 側的機制來決定何時注入內容（系統提示詞？按需？模型觸發？）。Prompts 需要 harness 尚不具備的「提示詞範本」概念。兩者都需要獨立設計；Tools 是高價值、低風險的起點。

### 原始模型可見工具名加選填 `toolPrefix`

否決。這是最初的提案，基於「大多數 MCP 伺服器已在工具名中使用語義前綴（如 `github_create_issue`）」這一前提。該前提不成立：官方 GitHub 伺服器發布的是 `create_issue`，參考檔案系統伺服器發布 `read_file`，Sentry 發布 `search_issues`——且上述微軟調查表明衝突在生態規模下很常見。衝突時再加前綴（或 warn-and-skip）還會使可用工具集取決於外掛程式載入順序，且新增不相關伺服器時工具可能被靜默重新命名——在對話中途使工作階段歷史和權限規則失效。所有被調研的多伺服器 agent 產品都不使用裸名。

### 僅伺服器命名空間（`github__create_issue`，無 `mcp__` 前綴）

v1 否決。它能防止跨伺服器衝突，但無法將 MCP 註冊與原生 harness 工具分離，也喪失了 MCP 全域性策略匹配模式（`mcp__*`）。前綴僅多花 5 個字元；`mcp__<server>__<tool>` 拼寫與 Claude Code 和 Codex 一致，最大化模型的熟悉度。如果 ToolRuntime 未來引入源感知命名空間，屆時可作為命名策略變更重新考慮去掉字面前綴。

### 從伺服器公告的 `serverInfo.name` 派生命名空間

否決。遠端名稱不可信、跨部署不唯一、升級時可變；工具標識和權限規則不得靜默跟隨它。命名空間是本機設定。

### 在工具結果中保留多個 TextBlock

否決。DeepSeek 序列化器中的 `flattenText()` 在將 `ContentBlock[]` 扁平化為協定格式（wire format）時使用 `join('')`（無分隔符）。多個 text 塊會靜默丟失塊間邊界——這是正確性缺陷。所有現有工具返回單個 TextBlock；MCP 橋接遵循同一做法。

## 測試

覆蓋範圍按層級列出；每項行為都放在能夠表達它的最低成本層級。

- **單元測試**（`tests/mcp-client.spec.ts`、`tests/apply.spec.ts`，mock MCP SDK）：`publicToolName` 演算法（乾淨名稱、規範化、截斷加 hash、確定性、不同標識的分離）、raw 與 public 的協議紀律、跨伺服器與原生工具共存、重複 `serverName` 載入失敗與預留釋放、無效工具清單拒絕、註冊代切換/回滾、重新同步失敗時保留上一代註冊、結果對映、取消、設定 schema 校驗。100% 逐文件覆蓋率閘門約束該包。
- **E2E**（`tests/mcp-client.e2e.ts`，無需金鑰）：使用真實 MCP 協議對接倉庫內的 fixture（測試前置資料）伺服器、`@modelcontextprotocol/server-everything` 和 `@modelcontextprotocol/server-filesystem`（stdio 傳輸），以及行程內 `StreamableHTTPServerTransport` 伺服器（Streamable HTTP 傳輸）——命名空間下的發現、帶點號名稱的端到端規範化、執行往返、重複 `serverName` 拒絕、dispose。
- **快照**：刻意不做。MCP 工具不引入新的展示形態——它們以原始 `ToolDefinition` 註冊，UI 消費端使用各自展示測試套件已固定的通用卡片兜底。將 MCP 伺服器新增到某個可執行的快照組合會改變其已固定的系統提示詞 fixture，且使每次重播相依性於 spawn 外部 MCP 伺服器行程，而新增行為為零。如果後續變更為 MCP 工具引入專屬渲染意圖，該變更屆時自行聲明快照覆蓋。

## 後果

- 每個 MCP 伺服器只需 `cordis.yml` 中的一條設定即完成整合：`serverName: filesystem` 加一條 stdio 命令（或一個 Streamable HTTP URL），就能將 `mcp__filesystem__read_file` 放入模型的工具清單，可呼叫，協議上使用原始的 `read_file`。
- 公開名稱是工作階段歷史和權限/設定 API 的一部分；命名演算法是由測試固定的 v1 約定，發布後變更即為破壞性變更。
- `mcp__<serverName>__` 限定符在每個名稱上消耗 token。已接受：描述和 JSON Schema 在工具定義 token 中佔主導，而限定符換來了穩定標識、衝突隔離和 MCP 全域性策略匹配模式（`mcp__*`、`mcp__github__*`）。
- **MCP SDK 穩定性**：`@modelcontextprotocol/sdk` 仍在演進中；破壞性變更需要更新橋接。版本已固定，且該 SDK 被廣泛採用（Claude Desktop、Cursor、VS Code），因此破壞性變更不太可能悄然發生。
- **工具 schema 質量**：MCP 伺服器可能暴露描述不佳的工具（模糊的描述、不完整的 JSON Schema）。harness 原樣透傳——垃圾進垃圾出；這是伺服器作者的責任，不是橋接的。
- **Stdio 行程管理**：行為例外的 MCP 伺服器如果忽略訊號，可能卡住 dispose。Cordis fiber 的 dispose 具有有界的完全靜止過程；卡住的傳輸層最終會在框架層面逾時。
- 當機復原在[重連預算](2026-08-06-mcp-client-auto-reconnect.md)內自動進行；耗盡後或設定 `reconnect.enabled: false` 時回退為手動重新載入。
