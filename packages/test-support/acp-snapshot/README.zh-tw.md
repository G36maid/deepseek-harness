# `@deepseek-ai/dsh-acp-snapshot`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

ACP（Agent Client Protocol）快照套件工具包：無金鑰快照層（`pnpm run test:snapshot`，見[測試策略](../../../docs/testing.md)）背後的共享機制。示例只需場景表和 fixture（測試前置資料）目錄就能獲得完整快照套件；每項比較/保護機制都位於此處，受每文件覆蓋率閘門約束，而不是在每個示例中複製。

四層可單獨匯入：

- **`launchAcpTestAgent`（啟動器）**：從指定 cwd 在 tsx 下啟動源 agent（代理），或在普通 Node 下啟動已建置 `lib` agent；透過原始位元組 stdout tee 連線 SDK 用戶端，收集工作階段更新和 stderr，在啟動階段報告非同步 spawn 失敗，默認拒絕未處理的權限請求，並負責優雅或帶訊號關閉。關閉會等待行程退出、繼承 stdio 關閉和 ACP parser 耗盡，然後才完成關閉或傳播子級錯誤，使捕獲內容完整，且呼叫方可在任一結果後移除自有路徑。當 Windows 接受強制終止但非同步發布退出標記時，關閉會給該標記有界寬限，然後才將回退拒絕視為第二次失敗。快照和普通 e2e 套件共享該行程邊界；測試只需提供 agent 路徑、cwd、環境覆蓋和任何權限策略。
- **`runScenario`（harness）**：透過啟動器從確定性 `input.json` 指令碼驅動 ACP JSON-RPC stdio，將原始 stdout tee 給預期輸出和純度檢查，並在優雅 stdin EOF 後收集每個持久化原始 JSONL 工作階段日誌（父工作階段和 subagent 子工作階段，主工作階段優先）。`AgentUnderTest` 提供絕對 `binScript`、選填 `libBinScript`、`configPath` 和 `tsconfigPath` 路徑，因為子行程 cwd 位於倉庫外。當生成子級 cwd 的授權本身是測試對象時，`workspaceParent` 可以將它從平臺臨時目錄移出。啟動失敗會在拒絕診斷中保留已捕獲 agent stderr。
- **規範化器**：將已捕獲內容轉換為穩定文字或可移植 fixture 的純函式：`normalizeStdout`（JSON-RPC id → 首次出現序列；UUID 以及生成 cwd 的每種原生／JavaScript 檔案系統寫法 → token，按最長優先；根據 cwd 的分隔符選擇規範 `/` 或宿主原生形式；同時作為 stdout 純度檢查）、`normalizeSessionLog`（時間歸零、保留 `seq`、使用同一 cwd 路徑策略）、`tokenizeSessionFixtureCwd`（生成的 workspace 及其檔案系統別名，包括已進行 token 化的 macOS `/private` 別名 → 單一規範 `{{cwd}}`；手工編寫的臨時路徑保持不變）、`scrubSystemPrompts`（提示詞文字 → `{{system}}`）、`scrubToolSchemas`（schema bulk → `{{tools}}`）、`scrubRequestHeaders`（每個 pin 之外的所有 header bulk → `{{system}}`/`{{tools}}`/`{{messagePrefix}}`，保留結構；見[header 固定 Agent Note](../../../.agents/notes/archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)）和 `stabilizeFixtureMessageIds`（針對任意錄制器已準備寫入 fixture 的父級/子級日誌，透過結構化方式僅改寫 surface 和持久 inbox 中完整訊息的 ID 欄位，將已提交 UUID 帶入未變化且雙向唯一匹配的訊息）。
- **`defineAcpSnapshotSuite`（工廠）**：為場景表註冊完整 describe/it 樹：每場景預期輸出與重新持久化日誌比較、錄制/刷新 fixture 回寫、拒絕結構化 `UNKNOWN_TOOL` 結果、每個 header 類別一個 token 化 pin（由可獨立共享的 `system-prompt.expected.md` 和 `tool-schemas.expected.json` 伴隨檔案組合而成），以及即時一致性保護。其 fixture 保護會拒絕殘留場景目錄、缺失文件、一個類別包含多個 pin、重複的伴隨檔案內容、帶非規範 macOS 前綴的 cwd token、未擦除的 JSONL header，以及格式錯誤的 pin header。在錄制或刷新模式寫入 fixture 前，僅當一條未變化完整訊息的 ID 及其去除身份後的指紋在場景可寫入 fixture 的父級/子級日誌中均唯一時，該訊息才會保留已提交的 UUID；工作階段包的權威 surface 類型謂詞負責選擇 surface 載體，與其關聯的 `agent/inbox/spliced` 副本也納入同一對映，且僅改寫這些載體中透過驗證的 `id` 欄位。新增、發生變化、格式錯誤以及圖關係存在歧義的訊息保留本次生成的 UUID。刷新會使用收集所得本次執行的 id、cwd 及全部 cwd 別名評估本次生成的葉值；只有完整邏輯記錄版面配置對齊且易變字串替換形成雙射時，才會複用歸一化後等價的葉值；surface 或 inbox 載體中的完整訊息 ID 不參與此路徑，因為後續結構化處理負責這些 ID；有歧義的日誌保留本次生成的字串，而本次生成的語義值仍為權威資料。它還會在對齊事件時間前展開打包時序 envelope，因此切換打包/非打包版面配置無法移動後續記錄。新插入的 `session/title` 使用前一個事件的時間，因此功能驅動的插入不會擾動 fixture 餘下部分。每個場景目錄的 `session.jsonl` 和連續 `session.<n>.jsonl` 同級文件構成有序的主工作階段／子工作階段清單；場景表不重複其數量。必須在 vitest 收集時呼叫。

簽入倉庫的工作階段 fixture 使用規範打包行；[臨時倉庫遷移器](../../../scripts/migrate-packed-session-fixtures.ts)（`pnpm run migrate:packed-session-fixtures`）會改寫較舊的 fixture 版面配置，由其[移除提案](../../../.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md)負責刪除該遷移器。

消費端 `*.snapshot.ts` 就是場景表加一次工廠呼叫：

```ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defineAcpSnapshotSuite,
  type Scenario,
  type SnapshotSuiteOptions,
} from '@deepseek-ai/dsh-acp-snapshot'

function snapshotMode(value: string | undefined): SnapshotSuiteOptions['mode'] {
  switch (value) {
    case undefined:
    case '':
    case 'replay': return 'replay'
    case 'record': return 'record'
    case 'refresh': return 'refresh'
    default: throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const SCENARIOS: Scenario[] = [
  { name: 'text-turn', hasModelTurn: true, recorded: true, pinsHeader: true },
]

defineAcpSnapshotSuite({
  agent: { // absolute paths, resolved from the suite's own location
    binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
    configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  },
  snapshotsDir: join(dirname(fileURLToPath(import.meta.url)), 'snapshots'),
  scenarios: SCENARIOS, // exactly one entry per header class sets pinsHeader
  mode: snapshotMode(process.env.DSH_SNAPSHOT),
})
```

啟動不同組合樹的場景會設定自己的 `configPath`（一個 basename 仍以 `cordis.yml` 結尾的 overlay，使 bin 的重播交換可找到同級 `*cordis.snapshot.yml`）；當該組合改變請求 header 時，還會設定自己的 `headerClass` 和 pin 場景，acp-agent 示例的 Code Mode 與檔案系統場景是範本。默認生成的 workspace 在工作階段 fixture 中儲存為 `{{cwd}}`，使平臺臨時根目錄和隨機 basename 不影響錄制結果；當臨時目錄授權自身待測時，`workspaceParent` 將生成 cwd 移出平臺臨時區域，在 fixture 中保留該顯式路徑，並仍歸父級所有，而 harness 只移除生成的子級。場景簽入的 `workspace/` 會先複製到該子級，隨後 `prepareWorkspace` 在 agent 啟動前針對生成 cwd 執行。此 hook 僅用於 Git 無法跨平臺表示的 fixture；普通種子應留在 `workspace/` 中，而生成路徑在 Windows 上無效時還必須搭配 `posixOnly`。

每個 pin 默認擁有其生成的 `system-prompt.expected.md` 或 `tool-schemas.expected.json`；當完整的對應序列相同時，`systemPromptSource` 和 `toolSchemasSource` 指定另一個 pin 作為來源，因此每個不同版本只提交一次。該 pin 的 `session.jsonl` 儲存 `"system":"{{system}}","tools":"{{tools}}"`，同時保留設定、原因和任何模型可見前綴。具有合法執行中 header 變更的 pin 聲明 `expectedHeaderChanges`；共享來源必須聲明相同的 header 變更數量，錄制/刷新會拒絕生成不同位元組的共享引用方。

自身作用域組合出不同請求的 child 工作階段按 fixture 索引單獨聲明：`pinsChildToolSchemas` 把該 child 的工具序列移入 `tool-schemas.<n>.expected.json`，`pinsChildSystemPrompts` 把其提示詞移入 `system-prompt.<n>.expected.md`。兩者都指名自己描述的 `session.<n>.jsonl` fixture，其餘請求 header 欄位仍歸類別 pin 所有，並要求 sidecar 恰好在聲明時存在。child 提示詞 sidecar 還必須與其類別 pin 不同，因此冗餘副本會直接失敗，而不會悄悄漂移。攜帶作用域區域性 `report` 工具及其指引 section 的可繼續 child 是兩者的隨附用例。

每個場景都比較 `stdout.expected.jsonl`，其中以 cwd 為根的分隔符規範化為 `/`。在 Windows 上，`pinsNativeWindowsStdout` 還會在共享預期輸出之後比較完整 `stdout.expected.windows.jsonl`，並且僅在啟用時要求存在該伴隨檔案。需要非 Windows 主機的場景聲明 `posixOnly`，在 Windows 上跳過執行測試，但 fixture 保護仍在所有平臺覆蓋其已提交文件；示例包括 POSIX 行程語義（例如取消正在執行的 bash 呼叫會終止一個已脫離的行程組）和 Windows 無法表示的生成路徑。組合需要可用 `pwsh` 的場景聲明 `pwshOnly`；呼叫方提供的 `hasPwsh` 探測（隨附的 acp-agent 套件遵循執行器自身的解析，因此 Program Files 安裝也計入）在解析不到可用 `pwsh` 時跳過執行測試，而 fixture 保護仍處處覆蓋其已提交文件。

示例還發布 `cordis.snapshot.yml` 重播 overlay，位於 `cordis.yml` 旁邊（bin 在 `DSH_SNAPSHOT=replay` 下交換它們，見[單源重播設定 Agent Note](../../../.agents/notes/archived/testing/2026-07-04-single-source-acp-replay-config.md)）；重播 fixture 由 [`dsh-llm-replay`](../llm-replay/README.md) 提供，本包透過為子行程設定的 `DSH_SNAPSHOT_*` env var 指向它。`pnpm run test:snapshot:record` 呼叫線上 LLM（大型語言模型），並重寫已記錄場景的模型 fixture；`pnpm run test:snapshot:refresh` 保持無金鑰，執行重播 overlay，並從已提交模型指令碼重寫 stdout、可比較工作階段日誌預期輸出，以及各 pin 自有的提示詞與工具 schema 伴隨檔案。Fixture 角色、錄制/重播/刷新語義和場景表欄位記錄在 `Scenario` 以及[快照 Agent Note](../../../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md) 中。

約束：`suite.ts` 與 `harness.ts` 匯入 vitest（harness 透過 `vi.waitFor` 輪詢其持久邊界等待），因此包入口只能在 vitest 執行中匯入（啟動器和規範化器沒有此相依性，但從同一入口發布）。啟動器和套件工廠按設計專用於 ACP，啟動器使用 SDK 的 `ClientSideConnection`；規範化器是與傳輸無關的工作階段日誌/文字輔助工具，還由 JSON-RPC 和 Web 快照錄制器消費。輸入指令碼覆蓋初始化、新建工作階段、文字提示、取消、預期 RPC 失敗和持久輪次邊界等待。權限往返是選項類別選擇（`allow_once`、`reject_once` 等）的 FIFO 佇列，對映到 agent 寄出的 `optionId`；缺少或耗盡的佇列回答 `cancelled`，未提供類別會拒絕執行。

## 模型體驗

無。該測試專用 harness 記錄、規範化並比較 ACP transcript（文字記錄），不會改變 agent 組裝的模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **工作階段收集需要原始 JSONL mode**：`runScenario` 收集持久化 `.jsonl` 日誌，因此快照設定使用 `persistenceCompression: 'none'`；壓縮 JSONL 和 SQLite 組合沒有快照收集路徑。
- **建置 mode 需要當前產物**：先執行 `pnpm run build`，再選擇 `DSH_EXAMPLE_MODE=lib`；源 mode 仍是零建置路徑。
- **後端覆蓋仍使用 ACP 驅動器**：保留場景為何使用該傳輸，見[僅自動化 ACP 決策](../../../.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md#snapshot-boundary)。
