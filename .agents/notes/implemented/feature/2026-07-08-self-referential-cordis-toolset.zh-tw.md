# Agent Note: 自引用 cordis 工具集

Status: implemented

[English](2026-07-08-self-referential-cordis-toolset.md) | [简体中文](2026-07-08-self-referential-cordis-toolset.zh.md) | 繁體中文

## 問題

本 harness 中的一切都是 cordis 外掛程式，但執行在該外掛程式執行時期內部的 agent（代理）既看不到也碰不到它：它無法枚舉周圍的服務和事件，無法在工作階段中途為自己新增新工具，也無法組合自己發明的能力。賦予模型這種能力值得探索——一個能審視並修改自身執行時期的自引用 agent——但這同時引發三個正確性問題，本設計的核心正是回答這些問題，而非單純的「讓模型執行程式碼」機制。

第一，模型編寫的註冊必須在註冊發生時就完成校驗：格式錯誤的工具 schema 必須在註冊時失敗，而不是等到後續請求嘗試將其組裝進提示詞時才報錯。第二，模型編寫的程式碼需要呼叫它從未見過原始碼的服務 API——靠猜測方法簽名、更糟糕的是猜測回傳值結構，會消耗大量盲目試探的步驟。第三，模型掛載的一切都必須完全可釋放：模型可以按需釋放，普通的外掛程式生命週期在宿主外掛程式重載時也會釋放，否則長工作階段會積累殘留的監聽器和工具。

## 決策

該工具集以 [`@deepseek-ai/dsh-tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) 發布，並由 `examples/web-cordis` 演示。它為模型提供三個工具，用於操作當前 DSH 行程中的活躍 Cordis 執行時期：檢查該執行時期、掛載一個僅存於記憶體的臨時外掛程式，再將該外掛程式解除安裝至完全靜止。

vm 隔離了意外的全域性汙染，上下文門面隱藏了框架內部細節。但二者都不限制已暴露服務的權限：臨時外掛程式可以呼叫 `ctx.shell` 以宿主執行器的權限執行命令，也能訪問真實的檔案系統和網路服務。它執行在共享 DSH 執行時期中，可能影響同一行程的其他工作階段。這是一個需要顯式啟用的開發工具，信任等級與 bash 相當，不是安全邊界，也不是產品預設配置。

### 三個工具

| 工具 | 約定 |
|---|---|
| `cordis_inspect` | 當前行程活躍執行時期的只讀報告，每個 `what` 值對應一個 Markdown 小節（省略 `what` 則輸出全部小節）。`plugins` 列出全部存活 fiber，`temporary` 只列 `cordis_mount` 建立的臨時外掛程式。精確 `name` 搭配 `what: "api"` 或 `what: "events"` 可收窄到一個帶原始碼文件的目標。 |
| `cordis_mount` | 立即在 `node:vm` 沙盒中把 `code` 作為非同步 JavaScript 函式體求值，且不保存到任何位置。返回的外掛程式掛在內部 `cordis-dynamic` 分組下，並用新的行程內 id（`dyn-1`、`dyn-2`……）跟蹤。 |
| `cordis_unmount` | 按 id 解除安裝一個 `cordis_mount` 臨時外掛程式，並只在其自有工具、監聽器、服務、定時器和其他 effect 完全靜止後返回。它不能刪除 Loader、已設定或已安裝的外掛程式。 |

`cordis_inspect` 的小節是 `services`（每個已提供的 ctx 服務及所屬 fiber）、`plugins`（全部存活外掛程式 fiber）、`tools`（模型可呼叫的工具）、`temporary`（`cordis_mount` 子集，包含 id、running／pending 狀態、提供與等待的服務和生命週期）、`api`（活躍服務簽名及其引用類型）和 `events`（harness 事件及分發模式和簽名）。臨時外掛程式可跨後續輪次保持活躍，並在 `cordis_unmount`、工具集解除安裝或 DSH 重新啟動後消失；系統絕不會自動復原它們。寬泛的 `api` 和 `events` 報告省略完整 JSDoc；精確 `name` 返回一個服務或事件及其原始 JSDoc。其他小節不能搭配 name，未知目標會失敗，而 API 目標必須處於活躍狀態。面向模型的工具描述包含呼叫時所需的操作規則；[生成的工具目錄](../../../../docs/tool-catalog.md)是這些規則的完整呈現。

### 沙盒語義

掛載程式碼以非同步函式體的形式在一個新的 vm realm 中執行。其文件化的 API 將文件、網路、行程和定時器訪問引導至 Cordis 服務，使掛載保持可審視和可釋放。宿主 realm 的輔助手段仍然使 Node 逃逸成為可能，這與信任姿態一致。`vmTimeoutMs` 僅約束同步執行部分。

沙盒全域性變數刻意精簡：一個帶標籤的直寫 `console`（在宿主 stdout/stderr 上輸出 `[cordis:<id>] …`，這樣在掛載呼叫之後很久才觸發的監聽器輸出仍能落到使用者可見的地方）、`harness.defineTool`／`harness.registerTool` 註冊對、新 vm 上下文缺少的編碼原語（`btoa`／`atob` 作為基於 `Buffer` 的宿主閉包——這是一個明確允許的例外，`Buffer` 本身從不暴露——加上 `TextEncoder`／`TextDecoder`），以及對未暴露的 Node API 設定的可呼叫陷阱（`require`、`setTimeout`／`setInterval`／`setImmediate`／`clearTimeout`／`clearInterval`、`fetch`），這些陷阱會拋出一條重定向訊息指明 cordis 替代方案。只有函式形態的全域性變數才設陷阱；`process` 和 `Buffer` 保持 `undefined`，這樣 `typeof` 特性探測仍然無害，而不會觸發會拋出例外的訪問器。

掛載程式碼透過三道控制跨越 vm 邊界。雙 realm `instanceof` 同時識別宿主和 vm 對象。`harness.defineTool` 在宿主 realm 中重建輸出 schema／投影器，將工具體回傳值快照為宿主自有的 JSON，並讓登錄檔在觀測前強制執行[規範工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)。掛載的外掛程式接收的是一個白名單上下文門面，而非原始或透傳的 `Context`；框架內部機制和以上下文為值的返回會被拒絕。服務讀取需要聲明 `inject`，保留 Cordis 的啟用與解除安裝語義。`ctx.tools.get` 僅暴露 schema 檢視表，因此掛載程式碼無法繞過 `ToolRuntime.execute` 直接呼叫定義。

邊界將無歧義的 JSON Schema 形式規範化為 `ParameterSchemaSpec`，同時保留 `integer`、原始對象開放性和 required 陣列。直接使用 DSL 的對象節點必須聲明 `additionalProperties`；無效詞彙會報錯並給出可接受的替代方案。解析錯誤、TypeScript 錯誤、缺少 return、Node API 誤用和重複工具名等錯誤資訊包含相關原始碼行或糾正性約定，不敘述實作內部細節。

### 內部分組與臨時外掛程式生命週期

每個臨時外掛程式都是工具外掛程式下方內部 `cordis-dynamic` 分組的子節點，因此普通的 fiber 釋放即可處理工具集重載和解除安裝。`cordis_mount` 會等待 settlement；啟動失敗時在返回錯誤前釋放 fiber。已 settle 但處於 pending 狀態的外掛程式仍然可見，並列出其缺失的注入。`cordis_unmount` 等待外掛程式 fiber 的釋放完成。

臨時 Plugin 只存在於行程記憶體中。它不會建立 Plugin 文件、安裝 package、修改 `cordis.yml` 或個人／項目設定、跨重新啟動存續，也不存在自動儲存、轉正式或安裝路徑。若要保留實驗結果，應讓 Agent 透過常規開發流程實作普通的項目 Plugin 或可安裝的 profile 組合包。

### 透過 provide／inject 實作跨掛載組合

掛載之間透過普通的 cordis 服務語義相互關聯，以各自的 id 作為生命週期控制代碼：掛載 A 呼叫 `ctx.provide('foo', value)`，掛載 B 聲明 `inject: ['foo']` 並在 `foo` 存在的瞬間啟用；如果 B 先掛載，它保持 pending 狀態並列出缺失的服務；解除安裝 A 使 B 回到 pending（其註冊被撤銷），之後重新 provide 會透過一個新的沙盒門面重新執行 B 的 `apply`；重複 provide 會明確報錯並指出擁有該服務的 fiber。一個 realm 注意事項：由掛載 provide 的服務值是 vm realm 對象——從任何地方呼叫其方法都能工作，但消費端不得假設它具有宿主原型。

### 生成的 API 目錄

`cordis_inspect` 從生成的目錄提供 API 和事件資料，而非維護一份重複的表格。生成器複用 Cordis 目錄的 AST 掃描，輸出服務摘要、簽名、原始服務方法與事件 JSDoc、事件模式、引用的類型聲明以及繼承的上下文 API。有歧義的類型名被省略，過大的聲明被標記為截斷。

新鮮度像所有生成產物一樣受閘門約束：`pnpm run verify-cordis-api`（在 `doc-sync` 中）在記憶體中重新生成並在有任何 diff 時失敗，因此 JSDoc 或公開簽名變更如果不重新生成模型讀取的目錄就無法合入。執行時期 inspect 工具將目錄與活躍執行時期取交集而非直接轉儲：寬泛報告把有目錄條目的活躍服務渲染為摘要 + 簽名，把沒有目錄條目的活躍服務（掛載提供的）渲染為名稱 + 所屬 fiber，簡要列出有目錄條目但無活躍提供方的服務，再附上引用的類型結構。精確名稱報告渲染一個活躍服務或事件，並把原始 JSDoc 緊靠在每個簽名之前；讓該細節按需出現，避免探索性清單承擔其 token 成本。

### 設定、渲染與可觀測性

該外掛程式暴露一個設定欄位，由 schemastery 校驗並記錄在[設定目錄](../../../../docs/config-catalog.md)中：`vmTimeoutMs`（默認 5000），程式碼同步求值部分的毫秒上限。當前面向模型的名稱是 `cordis_inspect`、`cordis_mount` 和 `cordis_unmount`；內部 `cordis-dynamic` 分組名和 `dyn-` id 前綴仍是結構性詞彙。三個工具均按[工具實作手冊](../../../../docs/cookbook/adding-a-tool.md)渲染為 `generic` 卡片：inspect 為 `read`，mount 為攜帶程式碼 `rawInput` 的 `execute`，unmount 為 `delete`。Web 對話行保留這些通用機制，同時為各工具設定操作標題 `Inspect`、`Mount temporary Plugin` 和 `Unmount temporary Plugin` 以及統一的 Cordis 強調色；mount 行仍使用共用的 JavaScript 展開檢視表和文法高亮。

「模型可見 ⟺ 已記錄」成立，且無需新的工作階段事件類型：mount 與 unmount 透過已記錄的 `tool/call`／`tool/result` 對可見，當步驟之間的 schema 發生變化時，系統寄出的完整 request header 會記錄工具集的任何變化。臨時外掛程式屬於行程記憶體，而非工作階段狀態：復原持久化工作階段只會重建對話歷史，絕不會重新建立它們。

## 曾考慮的替代方案

**用結構化的逐能力註冊工具替代 `cordis_mount`。** 最具吸引力的替代方案是一個帶有顯式 `name`／`description`／`parameters`／`code` 欄位的 `cordis_register_tool`（以及配套工具 `cordis_register_listener`、`cordis_register_service`……），而非單一的「掛載一個外掛程式」原語。否決原因：它唯一的真正優勢——對最常見的單一場景免去外掛程式樣板程式碼——不足以抵償其代價，而單一的 mount 原語能一次性覆蓋所有能力。

| 維度 | 結構化逐能力工具 | 單一 `cordis_mount` |
|---|---|---|
| schema 正確性 | `parameters` 仍然是模型編寫的 JSON，需要統一 schema 校驗，只是提前了一步 | 同樣的校驗在沙盒邊界執行，同樣的指導性錯誤資訊 |
| 程式碼欄位 | `execute` 函式體仍然是 vm 中模型編寫的 JS；realm 和服務呼叫的正確性問題不變 | 一個沙盒、一條規範化路徑、一處受保護的註冊 |
| 能力覆蓋面 | 僅限工具；監聽器、服務、`inject` 關係各需另一個結構化工具——API 無限成長 | 一套詞彙（cordis 外掛程式）覆蓋當前和未來的所有效果 |
| 跨掛載組合 | 在工具註冊載荷中無法表達 | 原生 `provide`／`inject`，普通的 cordis 語義 |
| 可審視性 | 註冊的東西無法在外掛程式清單中顯示為外掛程式 | 模型掛載的正是 `cordis_inspect` 渲染的 |
| 模型易用性 | 對最常見的單一場景有優勢（無外掛程式樣板） | 透過 mount 描述中的規範示例加邊界錯誤資訊教會正確呼叫來緩解 |

因此正確性投入放在能一次性為所有能力帶來回報的地方：透過 `cordis_inspect` 呈現的生成 API 目錄，以及沙盒邊界校驗（其錯誤資訊教會正確的呼叫方式）。結構化註冊工具日後仍可作為文法糖新增，由它合成 mount 程式碼；本設計不排斥這一可能。

**在工具中手工維護服務／事件參考。** inspect 工具的第一版攜帶了一份手寫的服務方法簽名錶。它被生成的 `api-catalog.ts` 取代，因為手寫表在簽名變化的瞬間就會與 JSDoc 脫節且沒有閘門約束這種漂移，而生成產物的新鮮度由文件使用的同一套 AST 檢查。

**新增 `cordis/mount` 工作階段事件。** 一個持久事件記錄每次掛載的原始碼和名稱，有明確先例（`hook/invoked`、`compaction/start`）。v1 中予以否決：掛載和解除安裝已經作為 `tool/call`／`tool/result` 對可見，工具集變化已經作為完整的變更 request header 被記錄，因此專用事件只會重複記錄。如果審計用例需要在工具呼叫之外取得掛載的原始碼和名稱，日後仍可新增。

**加固的／能力受限的沙盒。** 對 Node 內建模組設陷阱並向掛載程式碼提供白名單門面而非原始上下文，可能暗示意圖是為安全而沙盒化。這裡明確不是：陷阱和門面收窄的是掛載程式碼所見的 *API*——將其引導至 cordis 服務、遠離易洩漏的 Node 內建模組和框架內部——目的是正確性和封堵未受保護的上下文逃逸，但門面暴露的能力（`ctx.shell`、`ctx.fs`、`ctx.web`）觸及真實執行時期，因此它不是安全邊界。真正的安全邊界（獨立行程、權限提示）超出了一個開發／顯式啟用工具集的範圍，且會與其核心目的——將活躍執行時期交給模型——相衝突。

## 後果

該工具集是刻意的顯式啟用設計，具有完整權限的 `ctx`，因此部署方採用它的意識程度應與 bash 工具相當。以下幾個事實由工具描述直接告知模型：一個 waterfall（瀑布式事件）監聽器（如 `tools/pre-execute`）如果不呼叫 `next()` 就返回，會短路整條鏈，因此一個掛載的監聽器可以阻止 agent 自身的工具分發（[waterfall 語義](../../../../docs/cordis-primer.md#cordis-waterfall-semantics)）；掛載程式碼在當前輪次的工具呼叫內執行，因此 await 任何只在該輪次結束後才 resolve 的東西會導致死結；`vmTimeoutMs` 僅約束同步執行；掛載不會在工作階段復原後存活。
