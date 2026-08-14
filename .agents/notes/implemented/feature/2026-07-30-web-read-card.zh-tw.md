# Agent Note: Read card — the read tool's structured line window reaches the client

Status: implemented

[English](2026-07-30-web-read-card.md) | [简体中文](2026-07-30-web-read-card.zh.md) | 繁體中文

## 問題

`read` 工具返回規範化輸出對象 `{ path, offset, lines: [{ number, text }], totalLines }`，但它的展示層把這個結構壓平了。`presentCall` 聲明為 `GenericCallView`（`kind: 'read'`，一個跟隨定位），`presentResult` 返回 `GenericResultView`，其唯一內容是剝掉 `<path>…</path><type>file</type><content>…</content>` 信封後的面向模型文字。收到該檢視表的 UI 只看到一個壓平的文字塊：行號以 `N: ` 前綴烘焙進文字、文件語言未知、`totalLines` 丟失。有相應能力的用戶端無法像渲染 diff 那樣渲染一次 read——即帶行號、文法高亮、行號欄與內容分離的程式碼檢視表。

結構化資料在下游無法復原。線上（wire）的工具結果只攜帶面向模型的 `ContentBlock[]`（已渲染文字）加上一個不透明的 `meta`；規範化輸出對象留在工具內，從不到達用戶端或工作階段日誌。因此想要行陣列、總數和語言提示的用戶端無法從 `N: text` 文字裡解析回它們——工具必須把它們投影到一個會持久化的通道上。

## 決策

給[渲染意圖 union](../architecture/2026-07-02-tool-render-intent-union.md) 新增第四個 `card` 標籤 `read`——僅在結果側。`ToolResultView` 增加 `ReadResultView { card: 'read'; title?; path; lines: ReadFileLine[]; totalLines; lang?; content? }`；`ReadFileLine { number; text }` 是共享的行單元。`ToolCallView` 不動：待定狀態仍是 `GenericCallView`（`kind: 'read'`），因為一次呼叫在 `execute` 返回前不攜帶文件內容，呼叫時沒有可展示的結構。這與 bash 終端機 card 不同——終端機 card 兩側都打標籤，因為終端機呼叫在呼叫時已攜帶命令和 cwd，而 read 呼叫既無內容也無總數，給呼叫側打標籤只會新增一個空變體。

read 工具透過 `output.presentationMeta` 投影結構化視窗，這與 write/edit 用來投影其應用 diff hunk 的持久化通道相同（[規範化工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)）。`presentationMeta` 對一次頂層 surface 呼叫執行一次，返回 `{ path, offset, lines, totalLines, lang? }` 作為工作階段校驗並存儲在結果 `meta` 上的 JSON，`presentResult` 在即時和重播路徑上都把該 meta 收窄回 `ReadResultView`。`offset`（視窗請求的 1-based 起始行）一並攜帶，是因為當位元組上限低於首個選中行時，視窗會返回空的 `lines` 陣列而 `totalLines` 為正；沒有持久化的 `offset`，這類視窗的重播 card 就無法報告它從哪行開始、或續讀應從哪行繼續，而末行推斷與文字重解析兩種兜底都有損。沒有這個通道，行陣列和總數就無法觸及：原始輸出對象不線上上，而重新解析 `N: text` 文字既有損又對截斷尾註脆弱。

`presentResult` 在以下情況返回 `undefined`——即 generic 回退：meta 缺失或畸形（`readMetaFromMeta` 防禦性收窄它，因此重播舊的已記錄結果永不拋錯）、結果是錯誤、以及單個文字塊不是 read 信封。本 card 出現之前記錄的結果——信封合法但無持久化 `meta`——有意走同一條 `undefined` 路徑：用戶端回退到原始 `result.content`，因此顯示帶 `<path>/<type>/<content>` 信封的原文，而非舊展示器返回的剝信封 generic card。這是 [pre-release 立場](../../../../AGENTS.md#pre-release-stance-foundation-over-blast-radius)下接受的降級：拒絕舊的磁碟格式，而非加一個剝信封的相容分支——本變更已重錄全部已發布 fixture（測試前置資料），且工作階段格式不承諾向後相容。在成功路徑上，`presentResult` 在結構化欄位之外攜帶 `content`（剝信封後的文字），因此不具備 read 能力的 UI 會透過自己的 generic/default card 分支渲染文件文字。原 TUI 證明瞭這條回退的必要性：它的非窮盡結果 switch 讀取 `view.content`，而另一道 dim-Markdown 門控也必須接納 `card: 'read'`。該前端隨後被移除，但對任何沒有結構化 read 卡片的消費端而言，content 回退仍是檢視表約定的一部分。

### 語言提示推導

`langFromPath`（在 `read-render.ts` 中）透過一張固定小表（`LANG_BY_EXTENSION`，覆蓋常見原始碼、設定、標記擴充名）把文件擴充名對映到文法高亮語言 id。它讀取最後一個路徑段與最後一個點之後的擴充名，大小寫不敏感，並對以下情況返回 `undefined`：dotfile（`.gitignore`）、無擴充名（`/etc/hosts`）、結尾的點、以及任何未知擴充名——此時 card 省略 `lang`，UI 渲染純文字。該表不是可調項（tunable）：它是 UI 可忽略的展示提示，而非隨部署變化的選擇，未知擴充名降級為純文字而非失敗。它有意保持小規模而非窮盡的語言登錄檔；擴充它只需新增一行表項。

## 考慮過的替代方案

**在 `presentResult` 中重新解析 `N: text` 面向模型文字。** 已否決：結構化行陣列將不得不透過按第一個 `: ` 切分每行來重建，這既有歧義（某行文字自身含 `: `），又丟失精確的 `totalLines`（腳註只在部分分支中陳述它），並在渲染格式變化時立即失效。`presentationMeta` 攜帶已經結構化的資料，無需重新解析。

**呼叫側也打標籤（`ReadCallView`），映像檔終端機 card 的兩側對稱。** 已否決：read 呼叫在執行前沒有內容、沒有行陣列、沒有總數——呼叫側 read card 會是一個空變體，重複 `GenericCallView`（`kind: 'read'`，跟隨定位）已經表達的東西。終端機 card 兩側都打標籤是因為終端機呼叫確實攜帶呼叫時資料（命令、cwd）；read 呼叫沒有。

**把結構化視窗放進新服務或旁路通道而非 `meta`。** 已否決：`meta` 是既有的持久化展示通道（write/edit 的應用 diff 也經由該通道傳遞），它隨工作階段日誌免費重播，無需新接線。服務會重新發明事件日誌已提供的持久化與重播。

**用 merge-extensible union 而非封閉標籤。** 出於[渲染意圖 union](../architecture/2026-07-02-tool-render-intent-union.md) 封閉的相同理由否決：新 card 需要消費程式碼來渲染它，因此被消費端靜默丟棄的變體比編譯錯誤更糟。把 `read` 加入封閉 union 是擴充它的許可方式——每個在 `card` 上 switch 的消費端都繼續編譯，因為新成員落入其 generic default，而想要富檢視表的消費端新增自己的分支。

## 影響

`ToolResultView` 多了第四個成員。消費端可以渲染結構化的 `lines`/`lang`/`totalLines` 形狀，也可以將不支持的 card 路由到 generic 路徑；read card 攜帶 `content`，所以後者仍會顯示文件文字。本次生產者變更是讓結構化資料可觸及的後端，無需每個消費端同時實作更豐富的檢視表。

read 工具現在為每次頂層 read 計算 `presentationMeta`，這是對已有資料的一次小投影（一次 `lines.map` 和一次 `langFromPath` 呼叫）。meta 隨工作階段日誌持久化，因此 read 結果在磁碟上略大——它已渲染為文字的行陣列，現在也以結構化形式存在。

## 測試

`packages/fs/tool-fs/tests/read-render.spec.ts` 單測 `langFromPath`（已知擴充名的大小寫不敏感、擴充名在最後一段與最後一個點之後讀取、以及 `undefined` 各情況：dotfile、無擴充名、結尾的點、未知）與 `readMetaFromMeta`（含與不含 `lang` 的良構收窄，以及每種拒絕：非對象、陣列、缺失或類型錯誤的 `path`/`totalLines`/`lines`、畸形行項、非字串 `lang`，以及——因為該函式收窄不透明的持久化 `meta` 邊界——類型正確的重播 JSON 仍可能攜帶的語義無效路徑：不是 1-based 整數的 `offset`、小於 `offset` 的首行 `number`、不是 1-based 整數的行 `number`（`0`、`1.5`、`NaN`、`Infinity`）、不是非負整數的 `totalLines`（`-1`、`1.5`、`NaN`）、以及行號重複、遞減或超過 `totalLines` 的情況；並且收窄正 `offset` 處的空視窗（位元組上限低於首個選中行））。`packages/fs/tool-fs/tests/tools.spec.ts` 固定工具接線：`execute` 把結構化視窗（含與不含 `lang` 提示）作為 `meta` 附上、`presentResult` 把它收窄為攜帶剝信封 `content` 的 `card: 'read'` 檢視表、以及各拒絕路徑（錯誤結果、非單文字內容、meta 有效但信封畸形、信封有效但 meta 缺失或畸形）都回退到 `undefined`。兩個改動的原始檔保持逐文件 100% 覆蓋率。本變更攜帶的是持久化 meta 與擴充後聯合類型的快照證據，而非新渲染檢視表的證據：重錄的 ACP（Agent Client Protocol）工作階段 fixture（`fs-read`、`fs-read-window`、`fs-edit`、`fs-policy-reject`、`fs-write-overwrite`、`parallel-tool-calls`、`agent-instructions`、`workspace-edit`）釘住持久化的讀取 `meta`（含 `{{cwd}}` 權杖化路徑），`cordis-inspect-jsdoc` 釘住四成員的 `ToolResultView` 聯合類型。當時的終端機快照還釘住了消費端的 generic dim-Markdown 回退保持逐位元組一致；結構化卡片自身的組裝應用 transcript（文字記錄）則屬於消費它的前端變更。

## 相關文件

- [工具呼叫展示的帶標籤渲染意圖 union](../architecture/2026-07-02-tool-render-intent-union.md) —— 本 Note 以 `read` 結果分支擴充的 `card` 標籤詞彙。
- [規範化工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md) —— 擁有本 Note 用來投影 read 視窗的 `presentationMeta` 持久化通道。
- [Web 終端機 card](2026-07-28-web-terminal-card.md) —— 用戶端消費結構化 card 的先例；read card 遵循相同的生產者模式，僅結果側。
