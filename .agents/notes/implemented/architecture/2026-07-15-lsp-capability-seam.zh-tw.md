# Agent Note: LSP 能力 seam 與面向模型的查詢工具

Status: implemented

[English](2026-07-15-lsp-capability-seam.md) | [简体中文](2026-07-15-lsp-capability-seam.zh.md) | 繁體中文

## 問題

harness 已具備文字搜尋與文件讀取能力，但二者都無法識別程序符號。文字匹配無法可靠地區分同名函式、跟蹤匯入別名、關聯介面與具體實作，也無法報告推斷類型。因此，agent（代理）在修改程式碼前缺少人類透過編輯器語言伺服器獲得的語義導覽能力。

語言伺服器協議（Language Server Protocol，LSP）支持分屬三個職責方：模型需要穩定的查詢 schema，harness 需要提供方選擇與規範化結果，本機實作則負責行程、JSON-RPC、工作區、同步與檔案系統行為。將三者合併會使模型約定綁定本機子行程，並阻礙遠端或沙盒原生提供方。

許多語言伺服器在查詢文件已按當前文字打開時表現最佳。相容的 agent 用戶端必須限制這項狀態、定義內部讀取是否算作模型觀察，並確保文件快照與伺服器工作區索引位於同一檔案系統命名空間。

## 決策

將 LSP 建成由三個包組成的能力 seam，其中包含一個只讀模型工具和一個通用本機提供方實作：

1. `packages/lsp/lsp` 下的 `@deepseek-ai/dsh-lsp` 負責 `ctx.lsp`、提供方註冊與選擇、標準化請求與結果、執行控制，以及結構化 LSP 錯誤。
2. `packages/lsp/lsp-stdio` 下的 `@deepseek-ai/dsh-lsp-stdio` 將設定的 stdio 語言伺服器適配到該 seam。一個外掛程式實例接收具名伺服器表，並為每組命令及擴充名到語言 id 的對映註冊一個隔離的提供方。
3. `packages/lsp/tool-lsp` 下的 `@deepseek-ai/dsh-tool-lsp` 負責面向模型的 `lsp` schema、提示詞指導、參數校驗、結果限制與格式化，以及與傳輸方式無關的 UI 展示。

`dsh-lsp-stdio` 是通用 host，不是語言伺服器目錄或安裝器。部署顯式設定命令與對映；未來 preset 屬於組合外掛程式或 `cordis.yml` overlay。

模型與 seam 僅公開 `goToDefinition`、`findReferences`、`goToImplementation` 和 `hover`；`ctx.lsp` 不提供任意 JSON-RPC 方法。這些操作字面量與 Claude Code 熟悉的 camelCase 命名一致，而工具名與 `file_path` 欄位仍由 harness 自行定義。

提示詞將 LSP 定位為精確查詢手段：`Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references.`

## 包與職責邊界

`dsh-lsp` 按帶品牌類型的 id 和擴充名到語言 id 的對映註冊提供方。`registerProvider()` 以原子方式佔用 id 與所有規範化擴充名：輸入無效或存在衝突時不發布任何狀態，dispose（資源釋放）函式釋放全部佔用。提供方外掛程式透過 `ctx.effect()` 註冊。系統按查詢且不受順序影響地選擇提供方；沒有匹配項時返回結構化不可用錯誤。第一版不提供 glob、language-id 或顯式路由選擇器，也不靜態聲明操作能力。

seam 只公開 `query(request, signal?)`，因為沒有欄位需要實作層填充預設值：`workspaceRoot` 是必填項，`languageId` 來自註冊對映，逾時與結果限制由消費端負責。`query()` 執行選擇與推導時不使用隱藏的 `??` 後備邏輯，因此沒有需要 resolve 的可執行 spec。`dsh-tool-lsp` 校驗模型參數，並只把 `exec.signal` 作為裸 `AbortSignal` 傳遞，與 web 一致，並使 `dsh-lsp` 不相依性 `dsh-tools`。提供方在選擇前被移除時按不可用失敗；之後的 dispose 遵循已選提供方的取消生命週期，不改路由。

約定如下：

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
type LspProviderId = Branded<'LspProviderId'>

interface LspPosition {
  readonly line: number
  readonly character: number
}

interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}

interface LspQueryRequest {
  readonly operation: LspOperation
  readonly filePath: string
  readonly position: LspPosition
  readonly workspaceRoot: string
}

interface LspProviderQuery extends LspQueryRequest {
  readonly languageId: string
}

type LspQueryResult =
  | { readonly kind: 'locations'; readonly locations: readonly { readonly uri: string; readonly range: LspRange }[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: 'hover'; readonly hover: { readonly contents: string; readonly range?: LspRange } | null }

interface LspProvider {
  readonly id: LspProviderId
  readonly extensionToLanguage: Readonly<Record<string, string>>
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
}

interface LspService {
  registerProvider(provider: LspProvider): () => void
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
}
```

對映鍵規範化為帶前導點的小寫擴充名，並按 `filePath` 的最後一個擴充名選擇；語言 id 僅用於文件同步。seam 中的位置和範圍從零開始按 UTF-16 計數。`findReferences` 始終包含聲明：提供方在內部執行該約束，本機對映設定 `context.includeDeclaration: true`，呼叫方不能設定。封閉結果聯合將導覽統一為位置，將 `hover` 統一為內容或 `null`；導覽結果攜帶提供方的規範工作區 URI，使消費端在執行世界的命名空間內相對化文件 URI。seam 不公開協議類型、行程或文件控制，也不提供通用請求逃生口。

`dsh-lsp-stdio` 負責伺服器設定、JSON-RPC、行程與臨時文件狀態和協議轉換。它透過 `ctx.fs` 讀取，透過 `ctx.subprocess` 啟動，只相依性二者的 Service Definition 包而非具體提供方；[可移植執行環境決策](2026-07-28-portable-execution-world-consumers.md)負責定義這種配對。伺服器表的鍵是提供方 id。外掛程式在註冊前解析每個伺服器的本機設定；如果後續對映無效或發生衝突，外掛程式會撤銷此前的註冊，並為每個提供方保留獨立行程池。`dsh-tool-lsp` 在執行時期只注入 `tools`、`lsp` 和 `systemPrompt`，透過包內的 `sessionCwd(exec)` 輔助函式從 `exec.agent?.session.header.cwd` 取得工作區，其取值方式與檔案系統工具一致，也不匯入提供方。

## 面向模型的約定

單一 `lsp` 工具接受以下參數：

```ts
interface LspToolInput {
  readonly operation: 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
  readonly file_path: string
  readonly line: number
  readonly character: number
}
```

`line` 和 `character` 是從 1 開始計數的正數 UTF-16 遊標坐標；工具將其轉換為 seam 中從零開始的 `LspPosition`，並將渲染位置轉回。`findReferences` 包含聲明，避免影響分析漏掉定義位置。提供方、語言 id、工作區根目錄、限制、逾時、初始化和可執行文件均不進入模型輸入。

工具必須從工作階段 `header.cwd` 取得 `workspaceRoot`，沒有後備值；缺失時在查詢或啟動前以 `LSP_WORKSPACE_REQUIRED` 失敗。本機提供方基於根目錄解析相對路徑並直接接受絕對路徑；兩種路徑都會進行規範化，如果目標位於規範工作區外，則在啟動前拒絕。

位置在不應用 harness 宿主路徑規則的情況下按文件穩定分組並渲染為 `path:line:character`。有效的 `file:` URI 落在提供方的規範工作區 URI 內時轉換為相對路徑，位於其外時轉換為從 URI 派生的絕對路徑；格式錯誤的 URI 與非 `file:` URI 保持原樣。`maxLocations` 預設值為 `100`，並報告省略的條目；`maxResultChars` 預設值為 `16_000`，並限制每個完整渲染結果，其中包括截斷元資料。空位置與 `null` hover 是成功的無結果回應；伺服器載荷缺失或格式錯誤時，以結構化 `LSP_MALFORMED_RESPONSE` 錯誤失敗。

與傳輸方式無關的展示器使用 `{ card: 'generic', kind: 'search', title, locations: [{ path: file_path, line }] }`，`title` 由參數推導並標明操作與遊標。由於 `FileLocation` 沒有 character，跟隨位置聚焦輸入行，標題保留完整遊標；展示保持純函式。

## 逾時歸屬

`dsh-tool-lsp` 將一個可設定的 `timeoutMs` 預算附加到工具定義，預設值為 `60_000`。`dsh-tool-call-timeout-policy` 執行預算並提供傳入 `ctx.lsp.query` 的 `exec.signal`；該預算覆蓋排隊、打開、查詢和關閉的完整生命週期，模型不可設定。

seam 和提供方不增加啟動或請求截止時間。非工具呼叫方不會獲得隱藏逾時，必須自行提供 `AbortSignal`，並在需要預算時使用 `deadline()`。

提供方 dispose 發生在工具執行之外，因此 `dsh-lsp-stdio` 保留 `shutdownTimeoutMs`（默認 `5_000`）限制 `shutdown`/`exit`，以及 `killGraceMs`（默認 `2_000`），同時用於限制請求取消寬限期和從 SIGTERM 升級到 SIGKILL 的寬限期；失敗實例的清理也使用相同邊界。定時器值超過 Node `2_147_483_647` ms 的調度範圍時，外掛程式載入失敗。提供方使用 `deadline()` 和 `timeoutOf()`，但仍負責請求取消、行程訊號和等待關閉，因為逾時通知不會終止工作。

## 工作區、檔案系統與文件同步

`dsh-lsp-stdio` 在語言伺服器的執行環境中透過 `ctx.fs` 規範化並讀取文件。它要求工作區目標是目錄，使用提供方自有的 containment 拒絕工作區外的原始檔，消費 `streamText`，並在區塊到達時執行 `maxDocumentBytes` 上限；普通文件校驗和 UTF-8 解碼仍由提供方負責，文件上限則由協議消費端負責。它會針對每項檔案系統操作合併呼叫方取消與提供方 dispose，跟蹤尚未進入佇列的工作區尋找，並在 dispose 期間等待這些尋找結帳。它不傳送 `fs/observed`：只有 LSP 結果對模型可見，因此查詢不滿足寫前讀取策略。

`read` 工具的輸出帶視窗與行號，進入 transcript（文字記錄）且已被觀察，不適合作為原始檔。在 `tool-lsp` 內讀取還會把提供方專用同步職責交給消費端，並排除非本機提供方。

本機提供方對每次查詢都採用相容優先的臨時打開流程。它接受舊式 `textDocumentSync` 的 `Full` 或 `Incremental`，也接受設定了 `openClose: true` 的選項；同步能力缺失、為 `None` 或明確不相容時，在 `didOpen` 前以不支持錯誤失敗。

1. 透過 `ctx.fs` 解析原始檔並檢查其位於工作區內，再透過同一提供方流式讀取當前文字，同時執行文件位元組上限。
2. 傳送 `textDocument/didOpen`，其中包含版本 `1`、完整文字和設定的語言 id。該寫入仍可取消；寫入失敗或遭取消會使實例失效，並等待有界行程終止完成，池才能複用它。
3. 傳送所請求的 `textDocument/definition`、`textDocument/references`、`textDocument/implementation` 或 `textDocument/hover` 請求。
4. 如果 `didOpen` 成功，則在請求完成或取消後於 `finally` 中嘗試傳送 `textDocument/didClose`。關閉寫入失敗不會覆蓋已經確定的結果或錯誤，但會使實例失效，並等待有界行程終止完成。

每次呼叫後都關閉文件，因此第一版不需要 `didChange`、`didSave`、內容快取、變更監聽器或文件 LRU。每個工作區的提供方佇列可取消，並序列執行原始檔讀取、打開、查詢和關閉的完整生命週期，因此等待中的查詢只在輪到它時才讀取當前位元組；實例也會序列執行協議生命週期。不同工作區可以平行。伺服器工作區索引仍負責從原始檔跳轉到的已關閉文件。

規範工作區目標必須是目錄。其目標鍵提供行程池 identity，行程路徑提供 cwd，歸提供方所有的 `file:` URI 則提供 `rootUri` 和唯一的 `workspaceFolders` 條目；檔案系統提供方將別名解析為同一鍵時，它們共享實例。結果位置可以在工作區外，但外部路徑不能成為查詢源。無法與掛載的子行程提供方共享路徑的檔案系統屬於組合錯誤，不是另建 LSP 包的理由。

## 本機伺服器生命週期與協議行為

`dsh-lsp-stdio` 按 `(provider id, canonical workspace target)` 懶啟動一個伺服器，並透過 single-flight 合併啟動。外掛程式載入時，它使用已設定的環境呼叫 `ctx.subprocess.resolveExecutable()`；命令不可用時在註冊前失敗。首次查詢透過原始協議管道啟動伺服器，不經過 shell，並收集有界的 stderr 尾部。`maxMessageBytes` 預設值為 `16_000_000`，`maxStderrBytes` 預設值為 `1_000_000`，`maxDocumentBytes` 預設值為 `4_000_000`。崩潰使當前查詢失敗且不重放；後續查詢可以替換行程。每次查詢最多啟動一個行程，因此 MVP 不設定跨請求重新啟動計數器。

初始化使用 `processId: null`，因為用戶端與伺服器可能位於不同的行程命名空間。它聲明 `general.positionEncodings: ['utf-16']`、`workspace: { workspaceFolders: true, configuration: true }`、`textDocument.hover.contentFormat: ['markdown', 'plaintext']`，以及 definition 與 implementation 的 `linkSupport: true`，但不支持動態註冊。伺服器返回的操作與同步能力均為真源。伺服器省略 `positionEncoding` 時預設為 `utf-16`；其他值均屬於協議錯誤。設定可以提供初始化選項和 `workspace/configuration` 回應，但用戶端拒絕 `workspace/applyEdit`，絕不執行命令或編輯。

導覽結果直接對映 `Location`，並將 `LocationLink` 的 `targetUri` 與 `targetSelectionRange` 對映為統一位置。位置必須是非負整數。`hover` 歸一化只接受有效的 `MarkupContent` 和 `MarkedString` 結構，保留字串值，把帶語言標籤的值渲染為圍欄程式碼區塊，並以一個空行連線陣列。面向模型的工具在渲染後應用 `maxResultChars`。

取消訊號傳遞到查詢的所有階段，請求 id 建立後還會發送 `$/cancelRequest`。無回應的伺服器會被終止並等待關閉；實例序列化保證沒有其他正在執行的工作被連帶中斷。dispose 會拒絕並取消工作、嘗試優雅關閉、透過有界終止流程升級處理，並等待完全靜止。

## 明確延後的 API

符號操作因需要不同 schema 且與讀取或搜尋重疊而延後；未來的工作區符號工具必須接收搜尋詞。呼叫層級因支持度不一而延後，`prepareCallHierarchy` 仍是內部準備步驟，不是模型操作。

診斷需要獨立的新鮮度、累積與 transcript 規則。重新命名、程式碼操作和格式化等變更能力需要單獨工具，並整合預覽、權限和寫入策略。

提供方信任設定的伺服器。其檔案系統可見性與行程隔離完全取決於掛載的執行環境；LSP 不增加獨立的沙盒策略。

## 備選方案

**照搬 Claude Code 的統一 schema。** 它的遊標操作驗證了核心場景，但符號與呼叫層級需要不同參數。照搬九種操作會固化尚未驗證的介面，因此該 seam 只對齊四種語義查詢。

**允許提供方註冊工具。** 已載入伺服器會控制模型 schema 和提示詞，無法在本機與遠端提供方之間維持統一約定。

**公開任意 LSP 方法。** JSON-RPC 逃生口會洩露協議載荷，並允許未經評審的變更或命令執行；操作聯合保持封閉。

**公開 `resolve(request)` / `query(spec)`。** 沒有需要填充預設值的欄位時，resolve 只會暴露提供方選擇，而公開 spec 可能持續到提供方 dispose 或替換之後。單一操作讓選擇與呼叫共用註冊生命週期。

**將訊號包裝為 LSP 執行上下文對象。** Web 傳遞裸 `AbortSignal`；僅包裝這一個欄位會造成無謂的不對稱。只有另一個欄位確有需要時，`query()` 才引入上下文對象。

**透過面向模型的 `read` 工具讀取。**拒絕，因為工具輸出帶視窗與行號，會進入 transcript 且已被觀察。提供方直接透過子行程所用的同一 `ctx.fs` 執行環境消費流式傳輸的完整文字。

**保持文件打開。** 映像檔編輯需要版本歸屬、覆蓋所有路徑的 `didChange`、HMR 復原、淘汰和過時狀態規則。臨時打開避免在 MVP 引入這套狀態機。

**設定分階段逾時。** 巢狀定時器會產生相互競爭的分類與新預算。一個由呼叫方負責的截止時間覆蓋查詢；只有呼叫外清理保留本機限制。

**不傳送 `didOpen`。** 協議雖允許，但支持不一致且可能使用過時伺服器狀態。臨時打開提供明確的當前快照。

**增加路由或選擇首個匹配項。** 註冊順序與 HMR 時機不是產品語義，路由表又會重複唯一擴充名所有權。因此，擴充名重疊時註冊失敗。

**在一個實例中並行查詢。** 取消失敗時，終止共享行程會殺死無關工作。實例內序列可限制影響範圍；不同實例仍可平行。

**內建 preset 或 PATH 發現。** 目錄會讓通用 host 承擔語言策略，而發現機制無法推斷參數、語言 id 或初始化設定。部署顯式設定提供方，組合外掛程式可以封裝 preset。

## 測試

- 包測試固定三個包的相依性方向、執行時期注入和僅透過 `ctx.lsp` 通訊的邊界。
- 工具測試固定四種操作、坐標校驗、設定限制與省略標記、提示詞和 UI 展示。
- 登錄檔測試固定原子佔用/釋放、不受順序影響的選擇，以及結構化的不可用、已釋放、衝突和不支持操作錯誤。
- 測試用 stdio server 固定精確的初始化能力、四種協議對映、`Location`/`LocationLink` 與 `hover` 歸一化，以及 `findReferences` 到 `references.includeDeclaration` 的對映。
- 同步測試固定 UTF-16 協商與轉換、受支持和被拒絕的 `textDocumentSync` 形式、打開寫入阻塞與失敗、配對的臨時打開/關閉、關閉寫入失敗和錯誤回應拒絕。
- 逾時測試固定一個 `TOOL_TIMEOUT` 預算、不對上游取消錯誤分類、LSP 無隱藏截止時間，以及受限且等待完成的清理。
- 生命週期測試固定啟動 single-flight、完整生命週期序列化及排隊查詢讀取最新原始檔、跨工作區平行、可取消佇列、崩潰後不重放的替換、stdin 失敗後的行程拆除，以及 dispose 後完全靜止。
- 檔案系統宿主測試固定 session cwd 要求、提供方自有的 containment 與 URI 渲染、有界文件讀取、無格式源文字和不傳送 `fs/observed`。
- 無金鑰且固定版本的 TypeScript 真實伺服器 e2e 覆蓋四種操作；可執行設定使用同一項顯式提供方對映。
- 快照覆蓋模型可見 schema、提示詞、結果和省略提示；建置產物冒煙測試覆蓋分幀與清理。
- 包與架構文件覆蓋設定、安全邊界和搜尋/讀取指導；同一改動中，新的 `packages/lsp/` 包組要加入 AGENTS.md 的倉庫版面配置塊、packages/README.md 的分組表和 architecture.md。

## 影響

各語言伺服器對方法支持、能力解釋和索引就緒時機的處理不同；LSP 沒有統一的“索引完成”訊號。不具備相容的臨時打開同步能力的伺服器不受支持，即使它能查詢已關閉文件。受支持的伺服器仍可能返回空結果或不完整結果，因此工具不承諾跨伺服器完整性。固定的 TypeScript e2e 只建立一條相容性基線，不代表跨語言承諾。

臨時打開會重複解析並產生通知。實例內序列會增加並行 agent 的延遲，長期執行的工作區行程則持續佔用記憶體直到 dispose。

同一執行時期內的擴充名所有權互斥。即使 language id 不同，兩個提供方也不能同時佔用 `.ts`；這是有意接受的 MVP 限制。預期擴充方式是在註冊之上增加由部署設定的 selector，允許放寬互斥佔用，同時不向模型輸入增加提供方選擇，也不改變 `LspProvider.query`。

UTF-16 遊標列與協議完全一致，但模型難以在包含非 BMP 字元的文字中準確計數。無效位置或不在符號上的位置可能返回空結果，因此錯誤文字和提示詞示例必須說明坐標約定，同時避免鼓勵模型廣泛使用 LSP。

配對的檔案系統／子行程提供方會對齊查詢快照與伺服器索引，但不會因此使受信任的語言伺服器變得安全。規範 containment 會在解析時拒絕工作區外的查詢源，但打開流不會在路徑並行替換期間額外保證穩定控制代碼身份；伺服器本身獲得執行環境所設定的權限，仍可讀取其他路徑或使用快取。
