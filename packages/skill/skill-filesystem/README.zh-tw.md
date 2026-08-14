# @deepseek-ai/dsh-skill-filesystem

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`ctx.skills` 登錄檔的本機檔案系統提供方。

該包實作一個 skill（技能）來源。它掃描本機項目、自訂和使用者 skill 根目錄，解析 `SKILL.md` 或平鋪 Markdown skill 文件，並將提供方註冊到 `ctx.skills`。登錄檔仍位於 `@deepseek-ai/dsh-skill`；持久化工作階段目錄和麵向模型的 loader 工具仍位於 `@deepseek-ai/dsh-tool-skill`。

## 外掛程式

需要 `ctx.skills`（`inject: ['skills']`）。

### 設定

| 欄位 | 預設值 | 含義 |
|---|---|---|
| `providerName` | `filesystem` | 在 `ctx.skills` 上註冊該提供方時使用的唯一名稱。 |
| `includeDefaultRoots` | `true` | 在 `customSkillDirs` 周圍包含項目根和使用者根；設為 false 時僅使用隔離的自訂根。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 由 [`@deepseek-ai/dsh-home-paths`](../../util/home-paths/README.md) 解析的 DeepSeek Harness 設定根目錄；掃描該目錄下的 `skills`。 |
| `agentsHome` | `$DSH_AGENTS_HOME` 或 `~/.agents` | 為相容 skill 掃描的共享 agent（代理）設定根目錄。 |
| `customSkillDirs` | `[]` | 在項目根目錄之後、使用者根目錄之前掃描的其他本機 skill 根目錄。 |
| `watch` | `true` | 監視宿主本機根，並在目錄成員或 frontmatter 可能發生變化時使本機提供方失效。 |
| `watchUsePolling` | `false` | 對現有 skill 根使用 Chokidar 輪詢，而不是原生事件。 |
| `watchStabilityThresholdMs` | `200` | Chokidar `add` 和 `change` 事件的穩定寫入視窗。 |
| `watchPollIntervalMs` | `100` | Chokidar 輪詢／穩定性間隔和缺失路徑探測間隔。 |
| `watchMaxProjects` | `128` | watcher LRU 中保留的不同項目根數量上限。 |
| `watchFollowSymlinks` | `true` | 監視現有根時跟隨符號連結。 |

## 發現

默認根按該提供方的 rank 順序解析：

| Rank | 來源 | 路徑 |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |

項目根目錄是包含 `.git` 的最近祖先目錄；如果不存在，則使用當前 cwd。使用者 DSH 根目錄會跳過其 `.system` 子目錄，因此歸系統所有的目錄不會被當作普通使用者 skill。`includeDefaultRoots: false` 會省略項目根、使用者根以及 `$DSH_BUNDLED_SKILL_DIR` 環境預設值，同時保留顯式設定的自訂根與 bundled 根，因此可以掛載多個只看到自身根的唯一命名隔離提供方。該提供方提供項目和使用者 skill；其他提供方可提供內建系統 skill。

當 `ctx.fs` 可用時，發現透過 `ctx.fs.listDir` 列出根，透過 `ctx.fs.readText` 讀取 skill 文件，並透過檔案系統服務探測 `.git`。完整 skill 載入會將尋找中止訊號轉發給檔案系統元資料和內容讀取。如果沒有檔案系統服務，提供方回退到可中止的 Node 檔案系統 I/O，使最小本機上下文仍能載入 skill。已確認缺失的路徑屬於有效空狀態；遇到格式錯誤或非文字條目時，提供方會發出警告並跳過；意外的發現或讀取失敗會使登錄檔快照不完整，系統不會因此用看似發生刪除的結果替換上一份可用模型目錄。

## 目錄變更偵測

現有 skill 根由 Chokidar 監視。打開原生 watcher 前，提供方會對現有根或祖先執行 realpath 解析，並拼回下一個缺失路徑段；當 `watchFollowSymlinks` 為 false 且根本身是符號連結時，提供方不會展開最後這一級連結，使 Chokidar 能夠強制執行設定邊界。發現與診斷仍保留設定路徑，從而避免 Windows 在 libuv 內部混用 8.3 別名與長格式事件路徑。提供方會觀察直屬 bundle 目錄的新增／移除、平鋪 Markdown 文件的新增／移除，以及直接 `SKILL.md` 的新增／移除／變更；`change` 事件用於重新發現 `name`、`description` 等目錄 frontmatter。`references`、`scripts`、`assets` 或其他 bundle 資源下的變更不會使目錄失效。同一微任務批次內送達的事件會合並為一次提供方失效。

不存在的根會從最近的現有祖先開始，每次沿一個缺失路徑段跟蹤。系統使用 `fs.watchFile` 探測下一段；當 `.agents`、`skills` 或已設定的根出現後，觀察會逐級推進，直至 Chokidar 可以附加到真實根。根刪除時，該過程反向執行，因此刪除再重建整個 skills 目錄仍可被觀察到。按項目劃分的 watcher 數量受 `watchMaxProjects` 限制；再次訪問已被驅逐的項目時，發現階段會重新附加觀察。

如果第一方檔案系統 `write` 和 `edit` 工具的目標可能影響受監視的 skill 條目，它們還會透過 `fs/observed` 同步使提供方失效。這條快速路徑讓模型的下一個步驟無需等待宿主 watcher，即可觀察到自身的檔案系統變更。外部 IDE、Git、shell 和行程產生的變更相依性 Chokidar 或缺失路徑探測。現有根的 watcher 會保持持久狀態直至 effect 釋放，使 Chokidar 能夠接管非同步原生錯誤事件；watcher 啟動或執行時期失敗會被記錄並觸發重試。發現過程仍會掃描可讀根目錄，並返回其候選項供直接載入，但會將觀測標記為不完整，因此不會快取，也不會作為權威模型目錄發布。effect 釋放會關閉所有 watcher，並收束延遲回呼。

## skill 格式

skill 可以是單層目錄 bundle（`<name>/SKILL.md`），也可以是平鋪 Markdown 文件（`<name>.md`）。刻意不支持發現巢狀的 `**/SKILL.md`。Frontmatter 使用 `yaml` 包解析為開放的 YAML 對象；該提供方解析必填的 `name` 和 `description`，以及選填的 `whenToUse`、`metadata`、`disable-model-invocation` 和 `user-invocable`。名稱必須使用 kebab-case。

這兩個呼叫欄位接受 YAML 布林值，以及不區分大小寫的 `true`/`false`、`yes`/`no`、`on`/`off` 和 `1`/`0`。`disable-model-invocation: true` 會從面向模型的目錄和 loader 中排除該 skill；`user-invocable: false` 會從面向使用者的命令中排除該 skill。每個省略的欄位都預設為允許對應介面呼叫；提供方始終輸出兩個正向內部策略值，即使兩個鍵都不存在也不例外。若使用駝峯拼寫或提供非布林呼叫值，系統會記錄警告並從發現結果中排除整個 skill，而不是隻丟棄該欄位或回退到寬鬆的預設值。呼叫策略校驗遵循失敗時默認拒絕原則，因為忽略無效資料可能會在已停用的介面上暴露 skill；類型錯誤的選填 `whenToUse` 和 `metadata` 值則會被省略，因為這兩個欄位目前都不授予呼叫權限。

目錄與正文具有獨立的生命週期。發現階段解析 frontmatter 以生成概述。每次 `skill(name)` 載入都會重新讀取並解析當前文件，因此正文編輯不需要 hash、修訂號、快取失效或主動通知模型。若在發現與載入之間更改 frontmatter 中的名稱，系統會拒絕過時名稱並使提供方失效；下一次目錄觀察會發布新名稱。

## 模型體驗

透過 `dsh-tool-skill` 間接影響模型。它將該提供方的可呼叫名稱和有長度上限的描述渲染到初始目錄或替換目錄中，並將所選的當前指令正文與資源基底指引渲染到保留的工具歷史中；路徑、提供方 rank 和已停用 skill 仍被隱藏。

#### KV Cache 影響

watcher 觸發的失效可促使上述消費端在現有請求歷史中追加替換目錄。僅涉及正文的編輯不會改變目錄 digest。

## 已知限制與暫緩事項

- **發現深度為一層**：只識別 `<root>/<name>/SKILL.md` 和 `<root>/<name>.md`；忽略巢狀 skill 樹和包 manifest（中繼資料清單）。
- **項目範圍為最近 `.git` 祖先**：沒有該標記的工作區回退到提供的 cwd，不支持其他項目根標記或 monorepo 子項目選擇。
- **格式錯誤的條目會隨警告消失**：模型目錄不會收到每個 skill 的診斷，無法區分缺失的 skill 與無效的 skill；意外 I/O 失敗則會保留最後一份可用目錄。
- **缺失根觀察每次輪詢一個路徑段**：啟動時不存在的根會使用 `fs.watchFile` 按 `watchPollIntervalMs` 輪詢，直至 Chokidar 可以附加；這以有界偵測延遲換取跨 IDE、Git 和 shell 工作流程的可靠建立偵測。
- **無正文修訂協議**：已載入的正文是普通的已保留工具歷史；後續文件編輯會影響後續呼叫，但既不會改寫舊結果，也不會通知正文已發生變化。
