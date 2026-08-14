# @deepseek-ai/dsh-typert-generator

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

TypeScript 項目分析器和模型驅動程式的 Typert 生成器。在生成任何產物之前，它會先將開發者編寫的源類型樹轉換為獨立於編譯器的 `FaceModel` 和 `TypeGraph` 資料。靜態分析無需 Cordis 即可消費該模型；各產物生成元件均不會接收 TypeScript 抽象文法樹（AST）或型別檢查器對象。

分析器可以分別使用由 `tsconfig.host.json` 或 `tsconfig.client.json` 初始化的獨立 `ts.Program`。直接項目引用確定編譯器 face 的成員歸屬，而包子路徑確定 Typert 執行時期 face 的貢獻：聲明 `dsh.client` 的普通單項目包可以同時貢獻 Host 與 Client 執行時期模型；只有透過 `tsconfig.host.json` 或 `tsconfig.client.json` 顯式引用的拆分項目，才會被限制在相應 face。`package.json#exports` 確定所有跨包公開邊界，跨 face 的邊只能來自原始碼匯入或重新匯出。NPM 相依性擁有的類型（包括 `@types` 包中的全域性聲明）繼續以 `external` 引用表示，不會被展開。

## 分析模型

每個 face 包含包匯出、Cordis 服務與事件、顯式標記的對象與 schema，以及涵蓋其可達聲明的類型圖。類型圖保留聲明標識、泛型參數及應用、顯式繼承、條件類型與對映類型、匯入屬性、abstract 修飾符和原始碼 JSDoc。服務和 `@typert object` 對外介面僅暴露公共實例成員；構造函式、靜態成員與非公共成員均被排除。

`WorkspaceAnalyzer` 默認採用 `check` 模式，遇到 TypeScript 文法或語義診斷、可達公開聲明缺少類型標注、跨包私有引用，以及模型無法無損保留的可達聲明合併時，分析會失敗。`write` 模式會插入型別檢查器推匯出的類型標注，重建該程序，並返回無診斷的檢查模式模型。

## 產物生成與選擇性發布

`FaceModelEmitter` 只消費模型。它會生成可執行 JavaScript，其中包含受支持的 Zod schema 和一個 `TYPERT` contribution；同時生成聲明文件，透過包的公開匯出將其中的 schema 標注為 `z.ZodType<SourceType>`。遇到不支持的 Zod 投影時，生成會失敗，不會展平或弱化源類型。

`WorkspaceTypertGenerator` 會遍歷從 Cordis `Context` 或 `Events` 擴充聲明及顯式 `@typert` 聲明可達的包公開匯出，以發現貢獻方。發布產物時，它要求宿主側產物位於 `lib/typert.host.{js,d.ts}` 並以 `package/typert` 暴露，用戶端側產物位於 `lib/typert.client.{js,d.ts}` 並以 `package/client/typert` 暴露。生成的聲明將 `TYPERT` 暴露為 `unknown`，因此參與貢獻的業務包無需相依性執行時期登錄檔。

各包可自行選擇是否發布，未提供對應公開入口的業務包無需生成 Typert 產物。倉庫的 Host tsdown 會以 `tsconfig.host.json` 為唯一 program 種子執行 workspace Typert 生成；它既生成 Host 反射產物，也把 Host Remote 約定投影為 Client 使用的 `typert.remote-client.*`。後續 Client tsdown 不啟動 Typert，也不分析 `tsconfig.client.json`。靜態消費端仍可直接呼叫 `WorkspaceAnalyzer`，顯式選擇 face 與包子集，並在不發布或載入執行時期產物的情況下分批次處理包。

## 本倉庫的 Cordis 投影

包根匯出中包含本倉庫 Cordis 目錄使用的模型驅動程式提取邏輯、完整性檢查和確定性文字渲染器。它們接受 `CordisCatalogPolicy`；由倉庫持有的類型連結、基礎類型／豁免類型分類和繼承的 Cordis 條目仍位於 `scripts/gen-cordis-catalog.ts`，並由呼叫方顯式傳入。因此，生成器包只包含投影機制，不會隱式複製本倉庫的文件分類體系。

## 模型體驗

無。該包僅在建置或測試時執行，不會向模型請求新增任何內容。

#### KV Cache 影響

無。

## 已知限制與暫緩事項

- 系統會跳過包匯出中的模式匹配；參與貢獻的包需要具體的匯出目標。
- 跨 face 的具名重新匯出和星號重新匯出會生成連結；在 `TypeTargetModel` 能夠不經展平便表示模組命名空間之前，命名空間重新匯出會失敗。
- Zod 產物生成元件僅支持 TypeScript 類型圖中有意限定的部分。泛型 schema 聲明，以及以條件類型或對映類型為 schema 根的計算構造，都會失敗，直到存在明確的 schema 工廠策略。
- 跨 face 連結會在模型中表示以供分析，但當前生成的 schema 均不需要跨 face 的執行時期 Zod 匯入。
- 發現過程會遍歷從具體公開匯出可達的原始檔；既未匯出、也未由該圖匯入的聲明會按設計排除在包模型之外。
