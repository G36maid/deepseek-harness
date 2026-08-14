# Agent Note: 模型與使用者彼此獨立的 skill（技能）呼叫策略

Status: implemented

[English](2026-07-28-skill-invocation-policy.md) | [简体中文](2026-07-28-skill-invocation-policy.zh.md) | 繁體中文

## 問題

skill 登錄檔最初將發現操作視為模型目錄：`ctx.skills.list()` 會移除禁止模型呼叫的 skill，而 `ctx.skills.get()` 仍是不過濾內容的可信 loader。該設計足以支持由模型發起的載入，卻無法表示與 Claude 相容的四類 skill：僅向使用者公開、僅向模型公開、同時向兩者公開，或者兩者均不公開。TUI 從面向模型過濾後的清單中生成使用者自動補全，並允許透過 `get()` 載入任意精確名稱，這進一步放大了兩類呼叫策略不匹配的問題。

本機解析器還將一種內部駝峯式拼寫暴露為 frontmatter。若要支持既有的負向欄位 `disable-model-invocation` 和正向欄位 `user-invocable`，需要建立持久且對稱的領域表示，同時避免把所有可能出現的 YAML 鍵都變成跨包的無類型約定。

## 決策

`SkillSummary` 包含一個必填且類型明確的 `invocation: SkillInvocationPolicy` 對象，其 `modelInvocable: boolean` 和 `userInvocable: boolean` 欄位為正向且對稱。只有顯式輸入邊界可以省略它：未提供策略的執行時期 `SkillRegistration`，以及兩個呼叫鍵均未提供的本機 frontmatter，都會在生成候選項或定義前解析為 `{ modelInvocable: true, userInvocable: true }`。未來的 frontmatter 鍵只有在具備消費端和執行約定後，才會進入領域模型；本機提供方仍將 frontmatter 解析為開放的 `Record<string, unknown>`，然後只把已識別字段及其預設值投影到規範化的類型化策略中。

`ctx.skills.list()` 返回所有勝出的摘要，不再替任何呼叫介面選擇策略。`isModelInvocable(skill)` 和 `isUserInvocable(skill)` 分別直接讀取對應的正向欄位。`ctx.skills.get()` 保持策略無關，因為可信內部呼叫方可能需要任意定義；對外消費端則必須在展示或載入 skill 之前執行自身對應的判定函式。模型工具和 TUI 會在呼叫 `get()` 前檢查與呼叫策略無關的摘要，隨後再次檢查已載入的定義：被拒絕的名稱絕不會進入定義載入流程，發現與載入之間發生策略變更也無法暴露該 skill 的正文。

本機提供方只接受拼寫完全一致的 kebab-case frontmatter 鍵 `disable-model-invocation` 和 `user-invocable`。它接受 YAML 布林值，以及不區分大小寫的 `true`/`false`、`yes`/`no`、`on`/`off` 和 `1`/`0`，與 Claude skills 實際支持的布林寫法一致。它將 `disable-model-invocation` 對映為相反的正向欄位，即使兩個鍵都不存在，也會根據預設值填充兩個正向欄位。若使用外部駝峯式拼寫或提供非布林呼叫值，發現流程會丟棄整個 skill，並給出有針對性的警告；本倉庫尚處於發布前階段，因此不為磁碟格式保留相容別名。呼叫資料校驗遵循失敗時默認拒絕原則，因為忽略這類資料會默認授予權限，可能使 skill 暴露在已停用的介面上；與之不同，類型錯誤的選填 `whenToUse` 和 `metadata` 值會被省略，因為它們不參與呼叫判定。

面向模型的 `dsh-tool-skill` 目錄和 loader 執行 `isModelInvocable`。TUI 的 `/skill:` 自動補全與精確名稱 loader 在本機執行使用者欄位，因此僅允許使用者呼叫的 skill 即使不出現在模型發現結果中，仍會在此處顯示並可載入，同時不會將選填的 skill 對等相依性（peer dependency）變成執行時期匯入。由 launcher 預置、供引導式 `dsh migrate` 和 `dsh upgrade` 工作階段使用的初始 skill 沿用同一條 TUI 路徑，因此必須保持允許使用者呼叫。瀏覽器的 `skill.list` RPC 提供的是由使用者選擇、但仍要求模型載入的引用，因此只公開同時允許模型和使用者呼叫的 skill；本次改動不新增讓瀏覽器直接載入 skill 的 RPC。

這些規則允許以下四種組合：

| 策略 | 模型呼叫 | 使用者呼叫 |
|---|---|---|
| `{ modelInvocable: true, userInvocable: true }` | 包含 | 包含 |
| `{ modelInvocable: true, userInvocable: false }` | 包含 | 排除 |
| `{ modelInvocable: false, userInvocable: true }` | 排除 | 包含 |
| `{ modelInvocable: false, userInvocable: false }` | 排除 | 排除 |

該決策擴充了 [skill 系統](2026-07-05-skill-system.md)，並取代[已歸檔的 TUI skill 斜槓命令](../../archived/feature/2026-07-21-tui-skill-slash-command.md)中記錄的呼叫策略限制。

## 曾考慮的替代方案

**將所有 frontmatter 存入通用 `Map`，並在 `isModelInvocable` / `isUserInvocable` 中讀取字串鍵。** 不予採納，因為拼寫錯誤的鍵、非布林值以及各消費端自行採用的類型轉換都會越過包邊界，且無法獲得型別檢查。解析器邊界仍保持開放；領域模型則有意採用類型明確的窄介面。

**保持 `ctx.skills.list()` 僅返回允許模型呼叫的 skill，並另增一份使用者清單。** 不予採納，因為發現、重複項解析、快取和排序都是與呼叫介面無關的工作。採用一份完整目錄和顯式判定函式，可以避免這些機制逐漸分化，並在各消費端邊界清楚呈現其策略。

**在 `ctx.skills.get()` 內執行呼叫策略。** 不予採納，因為 `get()` 無法判斷呼叫方是模型工具、人類命令還是可信編排邏輯。在此處過濾還會使兩個介面均禁止呼叫的組合無法被檢查或管理。

**將駝峯式 frontmatter 作為別名處理。** 不予採納，因為外部格式遵循採用 kebab-case 的 Claude skills 約定，而本倉庫尚未發布，無需承擔相容義務。顯式失敗可以避免暗中保留不符合標準的拼寫。

**增加由瀏覽器端直接呼叫 skill 的 RPC。** 本次改動不予採納，因為現有瀏覽器流程插入的是模型引用，而非已經載入的指令正文。因此，該流程應當取模型與使用者呼叫策略的交集；直接由使用者載入的介面需要單獨設計協議與日誌記錄方式。

## 後果

提供方與執行時期註冊對外提供小而類型明確的呼叫約定，同時本機 YAML 仍可擴充。每個新的發現消費端都必須明確選擇模型判定函式、使用者判定函式、兩者的交集，或可信且不過濾的訪問方式；如果遺漏這項選擇，評審時可以直接看出問題，而不會再被登錄檔行為掩蓋。

無金鑰 ACP（Agent Client Protocol）快照固定了模型目錄的變更：其中包含僅允許模型呼叫的 skill，並排除僅允許使用者呼叫的 skill。組裝後的無金鑰 TUI 快照按精確名稱發現並載入一個僅允許使用者呼叫的 skill，隨後在載入正文前拒絕一個僅允許模型呼叫的 skill；真實 Loader/PTY 冒煙測試透過隨產品交付的終端機行程證明瞭同一條僅允許使用者呼叫的路徑。真實宿主上的 Chromium 快照固定了瀏覽器在全部四種策略組合下的交集行為。TUI 單元測試覆蓋這些組合以及 dispose（資源釋放）競態；登錄檔、本機解析器、模型工具和 API 代理測試則覆蓋預設值、支持的布林寫法、格式錯誤的值、舊鍵拒絕、精確名稱載入時的策略執行，以及瀏覽器側的策略交集。
