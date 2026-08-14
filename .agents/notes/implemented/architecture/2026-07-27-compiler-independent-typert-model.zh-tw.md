# Agent Note: 編譯器無關的 Typert 類型模型

Status: implemented

[English](2026-07-27-compiler-independent-typert-model.md) | [简体中文](2026-07-27-compiler-independent-typert-model.zh.md) | 繁體中文

## Problem

直接從 TypeScript AST 拼接 Zod 和反射文字，會把類型分析、業務語義識別與單個生成目標綁在一起。這樣的生成器只能回答“這段文法能否生成”，無法提供包、face、公開匯出、service、event、對象及其類型關係的標準表示，也無法供靜態檢查和後續生成目標複用。

host 與 client 屬於獨立 TypeScript project；把兩者放進同一個 `ts.Program` 會合並衝突的 Cordis `Context` 與 `Events` 聲明。與此同時，client 類型仍需顯式引用 host 類型，因此完全隔離或在兩邊複製類型都不能表達真實相依性。

## Decision

[`dsh-typert-generator`](../../../../packages/typert/generator/README.md) 分別從 host 和 client project 建立 `ts.Program`，只把 compiler node、symbol 和 checker 當作提取工具。分析結束後，所有生成器和掃描器只消費 Typert 自有的 `WorkspaceModel`、`FaceModel` 與 `TypeGraph`，模型中不保留 AST 或 checker 對象。生成器不相依性 `@deepseek-ai/dsh-typert-registry`。

TypeGraph 保存開發者寫下的計算前類型結構，包括泛型參數與應用、顯式繼承、conditional、mapped、遞迴引用和 JSDoc。無法無損表示的可達類型使分析失敗；某個 emitter 無法處理已經建模的節點時由該 emitter 失敗，而不是把類型展平或降級為 `unknown`。

每個 face 獨立擁有 PackageModel 和 TypeGraph。`tsconfig.host.json` 與 `tsconfig.client.json` 的直接 project references 決定 package 的 face 歸屬，`package.json#exports` 決定公開邊界。跨 face 關係只來自原始碼中的顯式 import 或 re-export，並作為獨立 link 保留；外部 npm 類型記錄為 External，不讀取或複製其聲明。

PackageModel 識別 Cordis service、event、`@typert object` 引用對象和 `@typert schema` 資料根。service 與 object 只暴露 public instance member，排除 constructor、static、private 和 protected；繼承邊保留在 TypeGraph 中，不複製為扁平成員。缺少 public property、parameter 或 return 類型標注時，`check` 模式報錯，`write` 模式寫入 checker 推斷結果後重建 project 並再次以嚴格模式分析。

[`dsh-typert-registry`](../../../../packages/typert/registry/README.md) 提供 `ctx.typert`，且只負責執行時期註冊：一個 contribution 原子攜帶 package-face reflection 與選填 Zod schema，並隨 Cordis effect 撤銷。登錄檔不分析 TypeScript，也不合併兩個 face。JSON Schema 是對已註冊 Zod schema 的按需投影。

包產物發布仍透過 package exports 採用顯式 opt-in。`WorkspaceTypertGenerator` 僅在被呼叫時校驗所請求 face 的根目錄產物協議：host face 必須透過面向使用者的 subpath `package/typert` 暴露 `package/lib/typert.host.{js,d.ts}`，client face 必須透過 `package/client/typert` 暴露 `package/lib/typert.client.{js,d.ts}`；它不會修改這些 exports。後續的 [Typert Remote 設計](2026-08-02-typert-remote-method-calls.md) 為根目錄 build、typecheck、lint 與文件型別檢查增加了全倉 Host 約定 pass。對於已 opt-in 的 Host 包，該 pass 會在消費端解析兩者之前生成本機反射產物與嚴格的 Host-for-Client `/remote` 約定。生成的本機聲明將 `TYPERT` 類型保持為 `unknown`，因此業務包不相依性登錄檔。

建置期的 `CordisCatalogProjector` 一次消費分析後的 `FaceModel` 與 `TypeGraph`，生成 `docs/cordis-catalog/events.md`、`docs/cordis-catalog/services.md`，以及為 `tool-cordis` 提交的靜態 `SERVICE_API`、`EVENT_API` 和 `TYPE_API` catalog。`tool-cordis` 讀取該靜態 catalog，執行時期不相依性 `ctx.typert`。[`dsh-typert-loader`](../../../../packages/typert/loader/README.md) 與登錄檔仍是獨立的執行時期路徑：loader 監聽 Cordis Loader 設定項生命週期事件，匯入顯式發布的 `./typert` host 產物，並透過 `ctx.typert` 註冊；兩者都不是當前 `cordis_inspect` catalog 的資料源。

## Verification contract

提交內的小型雙 face project 對完整類型模型及其原始碼聲明索引做 snapshot。全倉分批分析與直接聚焦分析必須為相同 face 生成模型等價的 `FaceModel` 與 `TypeGraph`。類型級全集和執行時期集合比較保證每種 node、target、declaration 與 member discriminant 都來自真實 TypeScript syntax；欄位語義矩陣覆蓋所有 keyword、type operator、literal value 類目，以及泛型、參數、tuple、mapped modifier、import attributes、abstract、predicate 和 enum initializer 的各個狀態。

`SyntaxZoo` 中每個 property 的原始碼類型經 TypeScript printer 標準化後，必須與 TypeGraph 渲染結果逐項相等，隨後所有渲染 declaration 再交給 TypeScript 編譯。這一層檢查節點內部資訊是否無損，包括無插值 template literal、帶 type argument 的 type query 和受約束 `infer`，不以 discriminant 覆蓋或程式碼覆蓋率代替結構等價。

邊界用例固定同 face 與跨 face 的顯式包匯入、跨 face 命名 re-export、精確 export alias、qualified `import()` link 和全域性 `@types` External 歸屬，並拒絕 package 自有 TypeScript 診斷、相對路徑越界、`package.json#exports` 之外的引用，以及尚無模型 target 的跨 face namespace re-export。interface declaration merging 顯式保留每個 authored part，無法無損表示的其他 merge 失敗。

Zod emitter 對支持的節點和各類 literal 逐類執行成功與失敗 parse，對不支持的節點逐類斷言明確的 `TypertEmitError`。Emitter fixture 對生成的 Zod JavaScript 與 `.d.ts` 文字做快照，執行 JavaScript，並對聲明做型別檢查。`dsh-typert-registry` 測試固定原子註冊、查詢、JSON Schema 和 effect 撤銷，`dsh-typert-loader` 測試還證明延遲掛載、解除安裝及未完成 dynamic import 的釋放行為。真實 `dsh-tools` 縱切從模型生成 contribution，經執行時期登錄檔載入後，將其服務、事件與關聯類型記錄同已提交的靜態 `SERVICE_API`、`EVENT_API` 和 `TYPE_API` 對照。全倉 projector 測試重新生成兩份 Cordis catalog 文件與 `tool-cordis` API catalog，並要求三份文字同已提交產物逐位元組一致。

## Alternatives considered

**直接保存 TypeScript AST。** AST 能保留原始碼寫法，但會讓每個消費者相依性 compiler 生命週期、node identity 和 checker 上下文，無法形成穩定的架構邊界，因此只在提取階段使用。

**基於 checker 的最終類型生成。** 展平後的 `ts.Type` 便於直接遍歷，卻丟失泛型、conditional、mapped 和 alias application 的開發者表達，無法滿足反射與後續生成需要。

**合併 host/client project 或複製 host 類型。** 合併會汙染 Cordis declaration merging；複製會產生第二份類型事實源。獨立 face 加顯式 cross-face link 保留了 project 隔離與真實引用關係。

**讓 `dsh-typert-registry` 承擔類型解析和跨包合成。** 這會把 TypeScript compiler、Cordis 生命週期和具體 schema 策略重新耦合。登錄檔保持為生成 artifact 的生命週期容器，複雜分析留在建置期模型。

## Consequences

新增生成目標或靜態檢查可複用同一 TypeGraph，業務類目也可在 PackageModel 上擴充，而無需再次解析 AST。保留計算前類型和獨立 face 的代價是模型比打平後的 schema 更複雜，emitter 必須顯式聲明支持範圍並對缺失能力失敗。

包級顯式 opt-in 使產物發布與 exports 由各包自行管理。倉庫編排仍可為每個已 opt-in 的包執行全倉 Host 約定 pass；該 pass 仍由後續 Remote Gateway Agent Note 負責說明。靜態 Cordis catalog 可從標準模型復現，同時不把 `tool-cordis` 與執行時期登錄檔狀態耦合。`ctx.typert` 只反映當前執行時期中已掛載的產物；對於消費端直接匯入後仍持有的 Zod 實例，解除安裝流程無法控制。
