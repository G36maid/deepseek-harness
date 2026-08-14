# Agent Note: Code Mode 語言分發與 Python SDK 渲染器

Status: implemented

[English](2026-07-31-code-mode-language-dispatch.md) | [简体中文](2026-07-31-code-mode-language-dispatch.zh.md) | 繁體中文

## 問題

Code Mode 只生成一種 SDK 形態：TypeScript。`ToolRuntime` 為 `tools:sdk` 段硬編碼了 `renderToolsSdk`，且 `requireCodeRuntime` 會拒絕任何 `ctx.codeRuntime.language !== 'typescript'`。引入 CPython 後端後，程序的源語言不再固定：同一個可見工具登錄檔在載入 Python 執行時期時必須投射出 Python SDK，而面向模型的 `run_code` schema 字串（"Execute a Python program …"）也必須與 SDK 段的語言一致，模型纔不會在 Python 執行時期下看到 TypeScript 指令。

這是多語言 Code Mode 拆分中面向工具的那一半；[程式碼執行時期 seam](../../../../packages/code-runtime/code-runtime/README.md) 已經攜帶 `CodeRuntime.language`。本 Note 只負責 `dsh-tools` 如何在該欄位上分發。實作 `language: 'python'` 的後端由它自己的 Note 負責，單獨交付。

## 決策

語言選擇就是對 `ctx.codeRuntime.language` 的查表，在提示詞裝配時惰性解析，查 `dsh-tools` 裡兩張平行的表：

- `SDK_RENDERERS`（index.ts）把語言對映到它的 `tools:sdk` 渲染器——`typescript → renderToolsSdk`、`python → renderToolsSdkPy`。`tools:sdk` 段讀取所載入執行時期的語言並選出渲染器；`requireCodeRuntime` 拒絕其語言不在表中的 `mode: code`/`both` 執行時期，並列出已知語言。
- `RUN_CODE_FLAVORS`（code-mode.ts）把語言對映到它那兩條面向模型的 `run_code` 字串（工具 `description` 與 `code` 參數描述），使一種語言的 SDK 段與它的傳輸 schema 始終一致。

兩張表在使用前都以 `Object.hasOwn` 讀取，這樣名為 `toString`/`constructor` 的語言不會把繼承自 `Object.prototype` 的成員解析成渲染器。兩個守衛的可達性不同：`SDK_RENDERERS` 的回呼內守衛不可達，因為 `requireCodeRuntime` 已在同一回呼更早處校驗過同一張 `const` 表（它帶 `/* v8 ignore */`）；而 `RUN_CODE_FLAVORS` 的守衛是主要的、可公開到達的拒絕路徑——任何缺席 flavor 表的語言都經 `run_code` 的語言感知 getter 到達它，而公共 `schemas()` 抵達那些 getter 時並未先過 `requireCodeRuntime`；測試直讀 definition 上的其中一個 getter，用的是對兩張表都缺席的語言。「在 `SDK_RENDERERS` 裡卻不在 `RUN_CODE_FLAVORS` 裡」這種漂移已由共享的 `CodeSdkLanguage` `satisfies` 在 `typecheck` 處拒絕，兩個守衛都看不到這種輸入；它們如今負責的是所掛載執行時期報告了一門兩張表都缺席的語言。schema 發射透過 `peekRuntime()` 而非 `requireRuntime()` 讀取執行時期：`undefined`（無執行時期，由直讀 definition 的讀者與 `schemas()` 到達，其中 doc-catalog 採集是唯一已交付的一個，而它們都不會喂給模型，因為組裝路徑先過 `requireCodeRuntime`）降級到 TypeScript flavor，而掛載了未知語言則 fail loud——這不是下方被否決的靜默回退，那指的是為真實執行時期寄出錯誤語言的 SDK。新增一門後端語言是三處並列編輯——一個 `CodeSdkLanguage` 成員加兩條表項——再加它的渲染器，以及點名已知值而非從中派生的散文（seam 側的 `dsh-code-runtime` README 雙語對、它的 `CodeRuntime.language` JSDoc 與 `docs/subsystems/code-runtime.md` 雙語對；本包自己的 README 雙語對與它的 `Config.mode` JSDoc，無任何 gate 檢查其中任何一處），不動 `agent-loop`，也不動登錄檔結構。

`code-mode.ts` 只相依性執行時期 Service Definition（`@deepseek-ai/dsh-code-runtime`），絕不相依性具體後端；分發在執行時期按 `runtime.language` 進行。因此工具層獨立於 Python 協議和後端——它只需要服務的 `language` 欄位。

### Python SDK 渲染器

`py-types.ts` 渲染 `jsonSchemaToTs` 所覆蓋的同一套統一工具 schema 詞彙，目標為 Python：`jsonSchemaToPy` 為每個 JSON-schema 節點寄出一個類型表達式，`renderToolsSdkPy` 為每個可見工具的參數與規範輸出裝配具名 `TypedDict`，再加一個帶用法說明的 `tools` 對象，與 TypeScript 形態等價。不支持的原始構造在裝配時降級而非拋錯，與 TypeScript 渲染器的約定一致。輸出是確定性的——工具按字典序排列，工具集不變時文字逐位元組相同——因此提示詞保持 prefix-cache 友好。字典序意味著單一有序的成員流：名字不是合法屬性的工具以 `tools[name]` 註釋出現在它排序後的位置上，而不是被分揀到末尾，與 TypeScript 形態就地為例外鍵加引號的做法一致。這個成員流直接決定了一件事：註釋行不是語句，所以一個不寄出任何方法的工具集仍需顯式 `pass`。另有三條規則並非源自排序，而是 Python 特有。其一，用法約定聲明這些聲明只是靜態存根、參數為普通 `dict`/`list` 值：`TypedDict` 讀起來像一個可構造的類，模型若寫 `FooArgs(field=1)` 會得到 `NameError`——TypeScript 的 `interface` 一眼就是類型，且 TS 形態的「runs type-stripped」一句已經覆蓋了它。其二，描述會成為方法的 docstring，且必須作為方法體的**第一條語句**寄出：放在 `async def` 之上，第一條會變成 `Tools` 的類文件、其餘都是無效果表達式，導致每個方法都沒有文件。其三，`list[…]` 鏈超過 `MAX_LIST_NESTING` 後降級為 `Any`，因為 CPython 的 tokenizer 拒絕一行中超過 200 個同時未閉合的括號，而這個塊必須是可解析的 Python——與 `docLines` 轉義引號和反斜槓是同一個理由。`ts-types` 兩者都不需要：TypeScript 會把前置的 `/** … */` 附著到其後的成員上，其文法也不對巢狀設限。

該上限服務的標準是**文法合法性**，這條邊界是有意劃定的：長的 `A | B | …` union 在任何長度下都是合法 Python，故不設上限——儘管 CPython 的 `compile()` 在沿左巢狀 `BinOp` 脊柱下降時會耗盡 C 遞迴（在 3.9 上實測：1,000 個分支可編譯，5,000 個拋 `RecursionError`）。沒有任何東西會編譯這個塊——它是提示詞文字——所以那條限制在這裡沒有代價；而給 union 長度封頂會作廢那幾個釘住 walk 線性時間與類名傳播上限的深鏈測試。將來若有渲染器確實需要可編譯的輸出，應當把 union 拍平，而不是截斷。

`renderType` 先用 `assertSupportedJsonSchema` 整樹校驗一次、隨後信任它，用單個 `try/catch` 把整個遍歷兜住並降級為 `Any`——與姊妹渲染器 `ts-types` 在這個 typed 同進程邊界上採取的「校驗後信任」姿態一致（[Trust TypeScript at typed same-process boundaries](../../../../AGENTS.md)）。它有意不設任何針對「訪問器在多次讀取間變值」的防禦（校驗後成環、`const`/`enum` 的 TOCTOU、自引用函式）：輸入是第一方註冊（`defineTool` 字面量或 raw 註冊）或從 wire 橋接而來的純 JSON schema——前者按 AGENTS.md 受信任，後者是 `JSON.parse` 產物、物理上不可能攜帶訪問器，且每次呼叫 `renderType` 都會整樹重新校驗——這類輸入不可達，而在此加逐形態守衛會為靜態介面所禁止的值破壞與 `ts-types`（沒有這類守衛）的對稱。`jsonSchemaToPy(schema: unknown)` 接受 `unknown` 並對畸形 schema 返回 `Any`——TypeScript 形態 `unknown` 的對應物——但它的約定是「降級不支持的 schema」，而非「扛住對抗性的可變 schema」。

## 考慮過的替代方案

- **在 `ToolRuntime` 上加一個 `language` 設定欄位。** 那樣部署方就會有兩處命名語言（所載入的執行時期與 tools 設定）且可能相互矛盾；所載入的執行時期是唯一真源，故登錄檔讀取它而不複製它。
- **把 Python 後端 import 進 `code-mode.ts` 來偵測它。** 那會把工具層耦合到具體後端，並迫使協議/後端 PR（Pull Request）先落地。按 `language` 執行時期分發使該層保持後端無關、可獨立發布。
- **為未知語言提供默認渲染器。** 靜默回退會在比如 Ruby 執行時期上寄出 TypeScript SDK——模型會看到錯誤語言的指令。在裝配處 fail loud 是本倉庫對錯誤設定的立場。

## 後果

新增一門後端語言是三處並列編輯——一個 `CodeSdkLanguage` 成員、一個 `SDK_RENDERERS` 表項、一個 `RUN_CODE_FLAVORS` 表項——再加第二處所指向的渲染器函式，不動 `agent-loop`，也不動登錄檔結構。兩張表（`SDK_RENDERERS`、`RUN_CODE_FLAVORS`）必須同步，且這條不變式由靜態檢查把關，而非交給 review：兩張表都以 `satisfies` 對上述同一個 union 校驗，因此只加其一而漏掉另一會在 `typecheck` 處失敗。這正是該漂移風險應有的機械形式——執行時期的 `Object.hasOwn` 守衛同樣能捕獲，但要等到有後端報告該語言之後：觸發點在消費端的整合處而非漂移引入處——而只要不存在第二個後端，就永遠不會觸發。兩張表的聲明類型仍是 `Record<string, …>`，因為 `CodeRuntime.language` 是不受約束的 `string`：union 釘住 harness 交付了什麼，守衛拒絕執行時期報告了什麼。落在這條檢查之外的是點名已知值而非從中派生的散文：seam 側的 `dsh-code-runtime` README 雙語對、它的 `CodeRuntime.language` JSDoc 與 `docs/subsystems/code-runtime.md` 雙語對，再加本包自己的 README 雙語對與它的 `Config.mode` JSDoc。更早的 note 點名這些值時記的是當時的狀態，不在此列。讓它無 gate 的是兩條獨立理由。其一，散文根本不受型別檢查，union 放在哪裡都一樣。其二，類型級替代在這裡也不可用：Service Definition 包不得 import 其消費端的表，而 `CodeRuntime.language` 按設計保持不受約束的 `string`，即便把 union 遷進 Service Definition 也不會作用到它。用一個斷言兩張表鍵集相等的 unit test 的方案被否決：它買到的是同一條檢查，代價卻是把兩張私有表做測試專用匯出，且執行時期機晚於編譯器。對兩張表都缺席的語言，兩種執行時期失敗中報出哪一條隨入口而異：組裝路徑報缺渲染器，因為 `wireSchemas` 在投影前先調 `requireCodeRuntime`；而公共 `schemas()` 先經過 `run_code` 的語言感知 getter，報的是缺 flavor 表項。工具層不相依性任何具體後端，因此它能先於 Python 協議和後端交付並可測。

代價是兩張表的 Python 分支在已交付的程式碼樹中不可達：`CodeRuntime.language` 由所載入的後端設定，已發布的後端只有 `dsh-code-runtime-worker-thread`（`'typescript'`），而登錄檔讀取的是所載入的執行時期而非某個設定欄位，因此沒有任何一份組裝好的應用能選中 `renderToolsSdkPy` 或 `PYTHON_FLAVOR`。也就是說，在報告 `'python'` 的後端發布之前，本 note 的工作不改變模型可見表面，本變更的覆蓋因此是 unit 級——渲染器輸出加分發與拒絕路徑。Python 模型介面的 keyless 快照歸屬於發布該後端的那個變更，因為只有在那裡，一份基於已發布外掛程式的真實 `cordis.yml` 才會產出 Python 組裝；在此處掛載 fixture（測試前置資料）執行時期的快照示例斷言的是測試替身，而 [docs/testing.md](../../../../docs/testing.md) 明確拒絕以此替代組裝好的應用 transcript（文字記錄）。

Python SDK 文字斷言的兩條執行時期約定同樣歸屬那個後端 PR。其一，說明文字告訴模型執行時期恰好綁定 `tools` 與 `ToolCallError` 兩個名字、所聲明的 `TypedDict` 類不綁定，因此後端必須注入這兩個名字（並按 seam 的 `errorClass` 約定填充 `ToolCallError.toolName`），且**不得**把所聲明的類名綁行程序全域性——「好心」注入會使這段 SDK 文字變成假話。其二，語言必須綁定到請求上：`requireCodeRuntime` 在組裝時與 `run_code` 執行時分別解析 `ctx.codeRuntime`，若在這兩點之間發生重載並換掉執行時期，就會把針對一種形態寫成的程序交給另一種形態執行。分裂比這兩點更細——`run_code` 的 `description` 與 `parameters` 兩個 getter 各自呼叫 `resolveFlavor(peekRuntime())`，而 `schemaOf` 會解構這兩個欄位，因此一次投影讀兩次執行時期；兩次都屬於 `run_code` 自己的 schema，因為這兩個 getter 只裝在那一個 definition 上，其餘 definition 攜帶的都是普通資料屬性。在這兩次讀取之間重載會產出單個 schema 的兩半分屬不同語言。兩者在此處都不可達——只有一個已發布後端意味著兩次讀取返回同一形態，且沒有任何程序會針對本渲染器的輸出執行——而跨語言拒絕在第二門語言存在之前也無法測試。

其三，那個 PR 擁有 CPython 版本下限，連帶擁有本渲染器的 Unicode 表偏斜。有四處表達式讀所執行引擎的表（Node 22.23.1：Unicode 17.0），而解釋器用它自己的表（CPython 3.9.6：13.0.0）：`isBareIdentifier` 的 `IDENTIFIER`，以及 `camelCase` 的切分集、頭部測試與 `toUpperCase()`。解釋器舊於引擎是會失敗的那個方向——引擎寄出的字元被其 tokenizer 拒收，整個塊隨之不可解析——而它經三條獨立路徑抵達。經判據抵達的是不加引號寄出的方法名或欄位名，其中帶有一個在兩個版本之間新增的字元——首位加進 `XID_Start`，或尾部任意位置（含名字中部）加進 `XID_Continue`。經 `camelCase` 的 XID 讀取抵達的是類名：只要工具 schema 中有任一對象形態聲明 `TypedDict`，該類名就進入寄出的文字，且判據對工具名的裁決並不對它設閘——工具名 `zz-` 加 U+1E4D0 因 `-` 被判據直接拒絕、從不觸及那裡的偏斜，卻照樣聲明 `class Zz𞓐xArgs`。經大寫對映抵達的是由判據已接受的工具派生出的類名——這是另一張表，視窗也比 XID 歸屬更寬：U+019B 既是 XID_Start 又 NFKC 穩定，故 `async def ƛ` 在 3.9.6 上可編譯，但 Node 將其大寫為 U+A7DC（在那裡未分配；CPython 自己的 `.upper()` 在此是恆等），於是 `class ꟜArgs` 以 `invalid non-printable character U+A7DC` 失敗。暴露視窗是兩個版本之間發生變化的那些字元與對映，所以宣佈支持某個 CPython 範圍的那個 PR 必須在「接受該暴露」與「按該下限的表釘住全部四個讀取點」之間顯式作出決定——只釘判據會同時留下兩條類名路徑。此處無法決定：下限尚不存在，而按猜測釘死一張表會成為一個隨部署而變、卻沒有可設定性支撐的常數。還有第二條軸隨該下限一同確定，且不屬於那四個讀取點：本塊在定義期會被求值的那些名字與文法。`TypedDict` 需要 3.8，PEP 585 的內建泛型 `dict[str, Any]` 與 `list[…]` 需要 3.9，`A | B` 形式的註解需要 3.10，`NotRequired` 需要 3.11。這些不是解析失敗——本塊在任何版本上都能解析，這正是 `MAX_LIST_NESTING` 上限所服務的標準——而是定義期求值失敗，且產品中沒有任何東西會求值這段文字。把它們與那四個讀取點記在一起，可避免把「在所支持範圍上可解析」讀成「在其上可執行」。
