# @deepseek-ai/dsh-agent-instructions

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為每個工作階段載入與 `AGENTS.md` 相容的工作區指令文件。該外掛程式會將初始的使用者全域性指令與項目指令鏈注入持久歷史，隨後發現巢狀文件，並在成功的檔案系統工具呼叫後報告後續變更或移除。

## 生命週期

每個即時工作階段第一次符合條件的 `agent/pre-step` 會組合基線。當下游決策讓非空的第一步批次進入時，外掛程式會將基線折入最終批次、緊隨已領取的直接提示詞之後，使直接提示詞與持久基線一同進入步驟 1，並共同抵達第一次請求。被拒絕或為空的第一步決策會將基線留在 agent（代理）的 `next-step` inbox，等待後續喚醒。loader 先讀取 `$DSH_HOME/AGENTS.md`，隨後針對項目根目錄到 `agent.session.header.cwd` 的每個目錄，先讀取每個現有基礎候選文件，再讀取每個現有本機 overlay 候選文件。同一目錄中，如果候選文件在去除首尾空白後位元組完全一致，就會按已設定順序摺疊到最早候選文件，因此 `CLAUDE.md` 若只是複製同級 `AGENTS.md`，只會算繪一次。若之前排隊的 workspace 上下文仍在等待，外掛程式會刪除並替換該確切 inbox 條目，而不會不斷累積副本。復原後的工作階段會保留一條相容的可見基線，並只追加當前文件的轉換；如果發現、優先級、項目根目錄或預算標識發生變化，則會將一條明確取代舊基線的完整基線折入進入步驟的批次。

該外掛程式還會觀察第一方 `read`、`write` 和 `edit` 呼叫成功後產生的不可變 `tools/result`。每個已接受的 touch 都會檢查新達到的後代 scope 以及之前載入的每個 scope。每個已設定候選名稱都是所在目錄中的獨立 scope：新出現的文件會在 agent inbox 中排入一項新增；已改變文件會排入一項替換；文件消失或成為同一目錄中較早候選文件的重複項時，會排入一則移除通知。原生呼叫與 Code Mode 子分派共享該路徑：巢狀 touch 會沿不透明的父級執行 token 逐層上浮，直到頂層結果落定；在 agent loop（代理循環）步驟內產生的 touch，須等持久 `step/end` 後才開始非同步投影。打開的步驟之外直接執行工具時，則立即投影。這樣無需相依性檔案系統時序，也能保持工具呼叫／結果／步驟的相鄰關係。這種發現跟隨結構化檔案系統活動，而不是 shell `cd`，因為每次本機 bash 呼叫都啟動新 shell，解析任意 shell 文法也不可靠。

指令讀取使用選填 `ctx.fs` 提供方。該外掛程式不會靜態注入 `fs`，因此沒有提供方的產品樹仍可啟動，指令載入在提供方出現前不執行任何操作。它會解析每個候選文件並對解析結果執行 stat，因此會跟隨路徑最後一段的 symlink 到其目標：指向常規文件的連結會載入目標內容，缺失路徑或非文件目標（包括指向目錄的連結）則已確認不存在。resolve 或 stat 例外會改為將該候選文件的 scope 標記為暫時不可用。前綴取消與動態工具取消會傳播到解析、中繼資料探測與流式讀取。文件載入後的提供方失敗會視為暫時不可用，而非文件已刪除的證據。

## 提示詞結構

基線指令是持久的 user 角色訊息，使用熟悉的 system-reminder 模式框定：

```md
<system-reminder>
The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Instructions from: ~/.dsh/AGENTS.md

...

Instructions from: AGENTS.md

...
</system-reminder>
```

新達到的 scope 使用持久的帶來源 `user/message`：

```md
<system-reminder>
Additional instructions from: packages/app/AGENTS.md

These instructions apply to work under `packages/app`. Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.

...
</system-reminder>
```

同一文件的編輯以 `Updated instructions from: <path>` 開頭，並說明使用新內容替代之前載入的內容。候選文件消失或成為同一目錄中較早候選文件的重複項時，訊息是 `Instructions removed: <path>`，後跟 `The previously loaded instructions from this file no longer apply.`。指令內容或模型可見的路徑、scope 與預算中繼資料中出現的字面 `</system-reminder>` 文字都會轉義，因此倉庫控制的文字無法關閉外掛程式控制的框架。

該外掛程式控制完整的 `<system-reminder>` 框架，每個注入的 `user/message` 都不經核心包裝便原樣傳給模型。

## 狀態與刷新

模型可見文字不含隱藏狀態標記。每個基線或動態上下文事件改為攜帶帶類型的 `agent-instructions` 來源，其中包含 `{ action, scope, path, digest? }` 變更清單；完整基線還會攜帶 `baseline: true`，以及從規範化的發現、優先級、項目根目錄和預算設定派生的 `baselineIdentity`。匹配的持久 `user/message` 會確認已排隊基線及其候選版本。進入步驟的 pre-step 會等待所有已排隊投影完成，再把新組合的上下文折入最終批次，位置緊隨已領取的訊息，並移除 inbox 中仍待處理的副本；若被拒絕，當前上下文則繼續排隊。若監聽器改寫掉已領取的 workspace 訊息，又沒有讓替代訊息進入，後續邊界會重新組合當前上下文。即使後續複合結果被攔截，成功的巢狀文件 touch 也會聚合到父級執行 token 下；頂層結果會將這些 touch 交給當前打開的工作階段步驟，或直接交給逐 agent 投影佇列。`step/end` 只會在自身邊界進入持久歷史後釋放其暫存的 touch；序列投影會根據可見工作階段事件和當前 inbox 協調狀態，再替換唯一一條待處理工作區上下文。

路徑與 SHA-1 內容 digest 都未變時，不會重複注入。每工作階段、每 scope 提供方 cache 只儲存 `{ path, version, digest, trimmedDigest }`：當提供方的不透明 `FsVersion` 與有效可見狀態都匹配時，對帳會跳過內容讀取；版本改變會在任何模型可見更新之前觸發有界讀取與 SHA-1 確認。`trimmedDigest` 是針對去除空白後內容的 SHA-1，也是每目錄重複 key，因此較早候選文件與某個未更改文件的內容收斂後，後者仍可被移除。復原可行，因為 SHA-1 狀態持久化在帶類型的來源中，而空的記憶體版本 cache 只會導致一次確認讀取。壓縮（compaction）會在 scope 的上下文事件離開可見表層後重新啟用它，即使快取版本未變。移除是 tombstone，因此候選文件之後重新出現時會重新載入。模型可見變更只有在對應文件專屬段落保留至少一個內容位元組，或原始內容確實為空時，才會進入來源、pending 狀態和版本 cache。只要任一內容位元組保留下來，部分截斷就會記錄完整內容的 digest；截斷到零位元組則仍可在後續 touch 處理，而相同 digest 的版本刷新只更新提供方 cache。基線即使帶空變更清單，仍可發布位元組預算診斷。動態批次若沒有可提交變更，則完全不注入，並在後續 touch 時重試。

初始基線事件自身不會被改寫。其帶類型的變更僅在該事件仍位於可見工作階段表層時纔是權威狀態。當壓縮遮蔽該事件時，下一次進入步驟的 pre-step 會組合當前基線，並在同一請求中記錄它；也可以改由一次成功的檔案系統 touch 重新新增未變的基線 scope，或追加其替換或移除。記憶體中的 scope 標記和提供方版本 cache 只負責選擇探測對象並加速探測。復原或外掛程式熱重掛後的第一次 pre-step 會保留相容的可見基線，並將它與當前完整算繪所保留的文件進行比較。未變化和被預算省略的文件不追加任何內容；agent 離線期間新增、編輯、移除或不再屬於預算保留集的文件會追加 `set`、`replace` 或 `remove` 轉換。不相容的可見基線會被一條完整的當前基線取代；如果沒有候選文件，這條當前基線會是顯式空基線。沒有文件 watcher，因此磁碟變更會在下一次成功 `read`、`write` 或 `edit` touch 時可見，也會在復原後的工作階段對帳其基線時，或進入步驟的 pre-step 復原被遮蔽的基線時可見。

## 設定

```ts
export interface Config {
  dshHome?: string
  projectRootMarkers?: string[]
  maxBytes: number
  maxSourceBytes?: number
  instructionFileCandidates?: string[]
  localInstructionFileCandidates?: string[]
}
```

`maxBytes` 必填，因此每個部署都必須顯式選擇提示詞預算。`maxSourceBytes` 在算繪前限制每個源指令文件，預設為 1 MiB。`projectRootMarkers` 預設為 `['.git']`，`instructionFileCandidates` 預設為 `['AGENTS.md', 'CLAUDE.md']`。每個項目目錄中的所有現有候選文件都會載入，在去除周圍空白後與較早候選文件內容匹配的文件會被丟棄。因此，使用預設設定時，內容相同的 `AGENTS.md` 與 `CLAUDE.md` 只算繪一次（作為 `AGENTS.md`），真正不同的同級文件則同時應用。`localInstructionFileCandidates` 預設為 `['AGENTS.local.md', 'CLAUDE.local.md']`，會與同一目錄的基礎文件一起載入其現有 overlay（算繪在它們之後），並應用同一個每目錄去重；空清單會停用 overlay。兩個清單中的候選項都必須是同一目錄下的檔名，因此會忽略空項、`.`／`..` 以及包含 `/` 或 `\` 的項。

使用者全域性文件始終是 `$DSH_HOME/AGENTS.md`，沒有本機 overlay；兩個候選清單只控制項目 scope。`$DSH_HOME` 預設為 `~/.dsh`，已設定的 `~`、`~/...` 與 Windows 風格 `~\...` 前綴會基於作業系統 home 目錄展開。非正數或非有限算繪預算會同時停用基線與動態載入；已設定 `maxSourceBytes` 必須是正整數。

## 預算與有界讀取

算繪會優先保留最具體的指令文件。它會先丟棄完整的較寬泛文件，再截斷最具體文件，並行出可見 `Workspace instruction budget ...` 通知，其中指名已省略與已截斷路徑。算繪後位元組數絕不超過 `maxBytes`。

即使提供方中繼資料省略大小，或文件在中繼資料探測後成長，指令內容仍會透過 `streamText()` 在 `maxSourceBytes` 下讀取。超大文件會被忽略；在動態對帳期間，它會暫時不可用，而不是被移除。該外掛程式不保留行程級 cache，絕不快取指令文字。其工作階段本機 scope cache 只將提供方版本用作快速失效訊號；失效後，對有界讀取計算的 SHA-1 仍是儲存在結構化訊息來源中的跨提供方內容標識。

## 模型體驗

### 基線上下文

#### 模型看到的內容

第一次請求的派生歷史中包含一條持久 user 角色訊息，其中按從寬泛到具體的順序包含有界使用者全域性指令與項目指令鏈。可見基線相容時，復原會複用該訊息。

##### 基線指令樣板

```markdown
<system-reminder>
The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Instructions from: ~/.dsh/AGENTS.md

<user-global-instructions>

Instructions from: AGENTS.md

<project-instructions>
</system-reminder>
```

#### Token 影響

算繪後基線只追加一次，並保留在派生歷史中直到壓縮。`maxBytes` 會限制完整訊息，較寬泛文件在最具體文件截斷之前被省略，空指令鏈不產生 token。

#### KV Cache 影響

僅附加，位於現有可複用前綴之後。可見基線標識相容時，復原會保持複用；不相容的標識會追加一條完整的替代基線，因此發現、優先級、項目根目錄或預算變更只會從該歷史位置起影響複用。

### 新發現的 scope 上下文

#### 模型看到的內容

成功的第一方檔案系統呼叫達到更深目錄後，下一個請求會包含一條保留的帶來源 `user/message`，其中包含新適用的指令文件。

##### 附加指令樣板

```markdown
<system-reminder>
Additional instructions from: packages/app/AGENTS.md

These instructions apply to work under `packages/app`. Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.

<nested-instructions>
</system-reminder>
```

#### Token 影響

每個已發現 scope 都會新增有界歷史 token，直到壓縮。可見工作階段狀態與版本／digest 比較會抑制未更改內容，Code Mode 將同一訊息延遲至外層 `run_code` 結果及其所屬持久步驟之後。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV-cache 條目失效。

### 已改變或移除的指令上下文

#### 模型看到的內容

已改變文件會產生 `Updated instructions from: <path>` 加替換內容。消失或成為同一目錄中較早候選文件重複項的候選文件會產生下方移除通知。

##### 移除通知

```markdown
<system-reminder>
Instructions removed: packages/app/AGENTS.md

The previously loaded instructions from this file no longer apply.
</system-reminder>
```

#### Token 影響

每項已確認變更或移除都是一條受 `maxBytes` 限制的保留歷史訊息。提供方失敗不新增訊息，預算省略的更新仍可在後續檔案系統 touch 中處理。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV-cache 條目失效。

## 已知限制與暫緩事項

- **發現跟隨結構化 fs 工具，而非 shell 導覽**：更改目錄的 `bash` 命令不會觸發巢狀指令發現，因為 shell 文法與每次呼叫 shell 狀態不是可靠的檔案系統 seam。
- **刷新由 touch 驅動**：沒有 watcher；外部編輯會在下一次成功的第一方 `read`、`write` 或 `edit` 時、復原程序對帳可見基線時，或進入步驟的 pre-step 復原被遮蔽的基線時可見。
- **候選語義有意保持簡單**：不解釋小寫名稱、`.claude/rules/` 與 `@path` import；項目 scope 預設載入 `AGENTS.local.md`／`CLAUDE.local.md` overlay，但使用者全域性 `$DSH_HOME` scope 沒有本機 overlay，其他自訂名稱需要顯式候選設定。
- **每目錄去重基於內容**：只有在去除首尾空白後位元組完全一致時，才摺疊同級候選文件。`CLAUDE.md` 若 symlink 到同級 `AGENTS.md`，會解析為相同內容，並像任何重複項一樣摺疊；從 `AGENTS.md` 漂移的獨立實體副本則會與它一起完整載入。
- **Symlink 指令文件會跨越信任邊界跟隨**：最終元件是 symlink 的候選文件會被解析並載入其目標，因此克隆倉庫可以將樹外文件內容呈現為較低優先級的工作區指引（它絕不會覆蓋 system、developer 或使用者直接下達的指令）。載入不受信任倉庫時，請用檔案系統策略閘門或 OS 沙盒限制 `ctx.fs`。
- **指令內容受限但不會被摘要**：超出預算的寬泛文件會被省略，最具體文件可能被截斷；該外掛程式絕不請求模型壓縮指令文字。
