# Agent Note: 搜尋渲染意圖——grep 與 glob 產出結構化搜尋卡片

Status: implemented

[English](2026-07-30-search-render-card.md) | [简体中文](2026-07-30-search-render-card.zh.md) | 繁體中文

## 問題

`grep` 與 `glob` 返回結構化的 canonical 值——`grep` 是扁平的 `{ matches: [{ path, lineNumber, line }] }`，`glob` 是 `{ paths: string[] }`——但每個 UI 只見過它們面向模型的渲染文字：`grep` 把匹配按文件頭分組、每行 `Line N:`，`glob` 列印換行連線的路徑清單，兩者在內聯上限（`grepMaxMatches`，默認 250；`globMaxResults`，默認 100）把後續結果落到 spill 文件時都追加一個 spill 腳註。想把搜尋結果渲染成可展開的按文件匹配組、或選填擇的路徑清單的 Web 前端，只能去重新解析那段文字。兩個工具都已聲明呼叫時的[渲染意圖](../architecture/2026-07-02-tool-render-intent-union.md)（`GenericCallView`，`kind: 'search'`），但沒有結果階段檢視表，所以已完成的呼叫回退到渲染原始文字的 generic 卡片。

結構化 canonical 值不透過協議傳輸：只有面向模型的渲染文字、以及當工具聲明瞭 `output.presentationMeta` 時的一份 JSON 元資料，會經 `tool/result` 事件到達用戶端（[canonical-output 約定](../architecture/2026-07-20-canonical-tool-output-contract.md)）。因此攜帶結構化資料的結果時檢視表必須把資料投影進 `presentationMeta`，再在 `presentResult` 裡讀回——與 `write`/`edit` 的 diff 卡片走同一條路。

## 決定

`packages/core/tools/src/presentation.ts` 把 `card: 'search'` 作為 `SearchResultView` 加入 `ToolResultView` 聯合，這是一個以 `shape` 判別的檢視表，表達兩個工具的形狀：`SearchMatchesResultView`（`shape: 'matches'`）以 `files: { path, matches: { lineNumber, line }[] }[]` 承載 `grep` 按文件分組的匹配，`SearchPathsResultView`（`shape: 'paths'`）承載 `glob` 的扁平 `paths: string[]`。兩者都帶 `truncated: boolean` 與 `total: number`。

判別子是 `shape` 而非 `kind`，是刻意為之：同一個 presentation 模組已經給 `GenericCallView` 一個 `kind: ToolCallKind` 欄位，其取值恰好包含 `'search'`（圖示類別）。持有 `ToolCallView | ToolResultView` 的橋接層會看到兩個含義不同的 `kind` 欄位；結果變體用 `shape` 把兩者分開。

用一個帶兩種形狀的檢視表而非兩張卡片，因為兩個工具是同一個視覺對象——一個搜尋結果——Web 消費端先在一個 `card` 值上分支，再在 `shape` 上分支決定行版面配置。判別式 `shape` 讓每個變體的欄位保持非選填（matches 檢視表總有 `files`，paths 檢視表總有 `paths`），而不是一個所有形狀相關欄位都選填的單一介面。

該檢視表**不**攜帶結果文字。把面向模型的 `result.content` 附到檢視表上不會產生效果——消費端的回退路徑本就讀取原始 `tool/result` 內容——卻會把整段搜尋文字又序列化進持久化檢視表一遍。檢視表只承載結構化形狀；無 search 卡片的 UI 回退到原始結果內容。

卡片標籤只在結果時存在。搜尋呼叫保持為 `GenericCallView`（`kind: 'search'`）：pending 狀態沒有匹配或路徑可展示，所以 `SearchCallView` 能攜帶的東西不會比 generic 標題更多。這是與 terminal 卡片的不對稱之處——terminal 的呼叫檢視表攜帶執行前就存在的命令、cwd、description；搜尋的結構化內容只在 `execute` 之後才存在。

`packages/fs/tool-fs-search/src/presentation.ts` 擁有投影與收窄。`grepSearchMeta`/`globSearchMeta` 把 canonical 值投影為每個工具聲明為 `output.presentationMeta` 的 `SearchMeta` 載荷；`presentGrepResult`/`presentGlobResult` 經 `searchViewFromMeta` 把 `result.meta` 讀回。它們消費與面向模型渲染相同的已保留結果——`search-core.ts` 裡的 `retainGrepMatches`/`retainGlobPaths` 只跑一次內聯上限與每行預覽預算，渲染與投影都取這份產出——所以文字與卡片對哪些結果倖存永不分歧，也沒有第二次保留計算。`total` 是搜尋找到的全部結果（截斷前）；`truncated` 在上限丟棄了結果時置位。這是截斷誠實點：模型看到的是被截斷的內聯結果加一個 spill 腳註，所以卡片不能把保留頁當作完整結果——UI 讀 `truncated`/`total` 顯示截斷指示，而非宣稱模型從未有過的完整性。

**meta 有自己的位元組預算。** 內聯上限約束的是條目數，但一次寬泛搜尋保留下來的匹配（數百條長行）仍可序列化到數百 KB，而 `meta` 會隨工作階段日誌持久化並在每次請求時重發。部署的最終輸出預算（`dsh-spill-policy` 的 `maxInlineBytes`）只縮減結果的 `content`——`PostToolDecision` 沒有 `meta` 通道——所以投影自己負責把 `meta` 約束住。`capMetaBytes` 丟棄末尾的文件組／路徑，直到序列化 meta 裝進 `searchMetaMaxBytes`（設定，默認 64 KiB），並把結果標記 `truncated`。單個大到自身都裝不下的條目會被保留：不變數是可丟棄處一律有界，絕不產出隱藏了真實結果的空卡片。

`searchViewFromMeta` 防禦性地收窄不透明的 `meta`，對任何畸形或缺失載荷返回 `undefined`，使在較舊或手工編輯的重播日誌上執行的 presenter 回退到 generic 卡片而非拋錯。它確實接受零結果載荷（`files: []` / `paths: []`）為合法的空卡片——這是對作為參照的 `diffsFromMeta` 的刻意偏離（後者拒絕空 `diffs`），因為零匹配的 grep 是 UI 展示為「no matches」的合法結果，而非缺失的投影。`presentResult` 對失敗結果、對缺失 meta（巢狀 `run_code` 分發不計算 `presentationMeta`）、以及對另一工具的 meta 形狀（每個 presenter 收窄到自己的 `shape`）返回 `undefined`。

`SearchMeta` 的成員形狀是對象字面量 `type` 別名，而非檢視表暴露的 `SearchFileMatches`/`SearchLineMatch` 介面，因為只有 type 別名可賦給 `presentationMeta` 返回的 `JsonValue` 索引簽名；兩者結構等價，所以投影值仍讀回為 `SearchResultView`。

沒有專用 `search` 分支的消費端會回退到同一個 generic body，並從原始結果中讀取面向模型的文字。因為搜尋檢視表不帶自己的 `content`，而 grep/glob 此前返回的是 generic 卡片，所以該回退與引入 search 卡片之前的路徑逐位元組一致。渲染結構化 `files`/`paths` 形狀的前端獨立於這個後端約定及其兩個生產者。

## 考慮過的備選

**一個扁平的 `SearchResultView` 介面，帶選填 `files?` 與 `paths?`。** 否決：它讓兩個形狀相關欄位在每個值上都選填，並允許畸形檢視表同時帶兩者或都不帶。`shape` 判別式讓每個變體的欄位保持必需，並讓消費端窮盡分支。

**複用 `kind` 作形狀判別子。** 否決：同一模組裡呼叫檢視表上的 `kind` 已經表示 `ToolCallKind`（圖示類別，取值含 `'search'`）。結果檢視表上再有一個含義不同的 `kind`，對任何同時持有兩者的橋接層都會衝突。

**把面向模型的文字作為檢視表的 `content` 附上。** 否決：對每個當前消費端是 no-op，且把整段搜尋文字第二次序列化進持久化檢視表。檢視表是結構化形狀；文字回退讀原始結果內容。

**在 `PostToolDecision` 上加 meta 通道，讓 `dsh-spill-policy` 像約束 `content` 那樣約束 `meta`。** 此處否決：它為一個工具的載荷改動核心工具決策約定與 spill-policy 外掛程式。投影按設定的位元組上限約束自己的 `meta` 是自包含的，且保持 seam 不變。

**映像檔 terminal 卡片雙側對稱的呼叫時 `SearchCallView`。** 否決：搜尋呼叫在 `execute` 前沒有匹配或路徑，檢視表只會攜帶 `GenericCallView` 已有的標題。

## 後果

`grep` 與 `glob` 現在在每次非巢狀的成功呼叫上計算 `presentationMeta`，這是對已保留匹配或路徑的一次有界投影——與 render 消費的是同一份保留產出，所以沒有第二次保留計算，傳輸中也沒有雙份搜尋文字。序列化 meta 受 `searchMetaMaxBytes` 約束，所以寬泛搜尋不再把無界的結構化副本持久化進工作階段日誌。

無 search 卡片的 UI 渲染原始 `tool/result` 內容，所以不會導致任何消費端出現回歸。渲染結構化形狀的消費端讀 `truncated`/`total` 與按文件分組；因為檢視表只攜帶保留的、位元組有界的頁，想要完整結果的 UI 跟隨面向模型文字裡的 spill 定位符，與模型的做法完全一致。

## 測試

`packages/fs/tool-fs-search/tests/presentation.spec.ts` 釘住純層：`groupMatchesByFile` 的首見文件順序；`grepSearchMeta`/`globSearchMeta` 在共享保留產出上的投影，`total` 報告截斷前計數、`truncated` 被帶過；保留過程施加的每行預覽預算；序列化 meta 位元組上限丟棄末尾組／路徑同時保留單個超大條目；以及 `searchViewFromMeta` 對兩種良好形狀、零結果空卡片、以及每種畸形情形（非對象／陣列 meta、缺失或誤型的 `truncated`/`total`、未知 `shape`、畸形 `files` 條目、非字串 `paths`）的收窄。`packages/fs/tool-fs-search/tests/tools.spec.ts` 釘住經真實工具登錄檔的接線：被截斷的 `grep`/`glob` execute 在 `result.meta` 上產出 `SearchMeta`，`presentResult` 建置搜尋檢視表（無 `content`），巢狀 `run_code` 分發不計算 meta 故 `presentResult` 回退，失敗或跨形狀或畸形結果回退到 generic 卡片。搜尋包 `src` 上保持 per-file 100% 覆蓋。

## 相關

- [工具呼叫呈現的帶標籤渲染意圖聯合](../architecture/2026-07-02-tool-render-intent-union.md)——本變更用 `search` 結果標籤擴充的 `card` 標籤詞彙。
- [Canonical 工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)——本投影所依託的 value/render/`presentationMeta` 劃分；結構化值留在執行本機，卡片透過 `meta` 傳遞。
- [Web terminal 卡片](2026-07-28-web-terminal-card.md)——本變更在後端所仿照的先例：工具把結果投影進 `presentationMeta` 與一個 `presentResult` 檢視表；搜尋卡片的 Web 消費端是與之類比的後續。
