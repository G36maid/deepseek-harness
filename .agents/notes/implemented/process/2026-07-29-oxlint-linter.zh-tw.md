# Agent Note: 使用 Oxlint 作為倉庫 linter

Status: implemented

[English](2026-07-29-oxlint-linter.md) | 繁體中文

## 問題

倉庫的自有原始碼需要類型感知的 TypeScript 正確性規則、一致的格式，以及文件內重複邏輯檢查。ESLint 透過 JavaScript 解析器、項目服務和多個外掛程式提供這些檢查，但在本機遷移基線上，一次無問題的 lint 執行約需 1 分鐘，並且需要 8 GiB Node 堆、CI 結果快取和單獨調優的 ESLint 並行度。

不能以提高執行速度為由丟失規則。遷移必須保留嚴格型別檢查預設、倉庫覆蓋設定、內聯抑制指令、@stylistic 修復、SonarJS 檢查、host/client TypeScript 隔離和 vendor 排除規則。

## 決策

根目錄的 [`.oxlintrc.json`](../../../../.oxlintrc.json) 是倉庫類型感知 lint 設定的權威來源。不載入項目的 [`.oxlintrc.staged.json`](../../../../.oxlintrc.staged.json) 設定繼承其原始碼規則，為有界的 pre-commit 路徑停用類型分析，並重新納入類型感知後端無法分析但需保留的 TypeGraph fixture（測試前置資料）。`lint` 與 `lint:fix` 包指令碼、閘門調度器、CI 和 lefthook 透過 [`scripts/run-oxlint.ts`](../../../../scripts/run-oxlint.ts) 呼叫 Oxlint；[僅使用 Oxlint 的修復工作流程](2026-08-09-oxlint-only-fix-workflow.md)負責多輪外掛程式修復，並取代單獨的格式化回退路徑。

`options.typeAware` 啟用 `oxlint-tsgolint`。其後端按文件發現 TypeScript 項目：包原始碼使用各自的包項目，host 測試、示例和網站使用 `tsconfig.host.json`，client 測試及 `scripts/client-bundle-purity.spec.ts` 使用 `tsconfig.client.json`。不含程序的根解決方案絕不會被扁平化。Oxlint 的 `--tsconfig` 覆蓋項會影響匯入解析，但類型感知 lint 會忽略它，因此本倉庫不設定該選項。該設定顯式載入遷移後的嚴格型別檢查規則和倉庫覆蓋設定，而不啟用內容可能發生變化的 Oxlint 寬泛類別。`typescript/no-unnecessary-condition` 仍從 Oxlint 的 nursery 規則集中啟用，因為它在遷移前就是倉庫強制執行的規則。

Oxlint 的 JavaScript 外掛程式相容層執行 `@stylistic/eslint-plugin` 和 `eslint-plugin-sonarjs`，從而繼續強制執行現有的格式和文件內重複邏輯規則。相容層會報告 `@stylistic` 違規並執行其安全修復；`max-len` 仍僅用於驗證。自有原始碼中的抑制指令使用 `oxlint-*` 指令和 `typescript/*` 命名空間，未使用的指令仍作為警告報告；vendor 原始碼保留其上游指令，因為 Oxlint 會排除 `vendor/**`。

CI 不復原或保存 lint 結果快取。`DSH_OXLINT_THREADS` 使共享執行器將同一上限傳給 Oxlint 的 `--threads` 選項和類型感知後端的 `GOMAXPROCS` 環境變數；普通本機執行對兩者均採用預設值。Pre-commit 執行不載入項目的 Oxlint 驗證，應用帶一次有界重試的安全修復，接受僅含已忽略文件的文件選擇，並透過 lefthook 重新暫存結果。公共 `lint` 和 CI 會先準備生成的聲明，並保留完整的類型感知規則。

## 驗證

解決兩處分析器差異後，遷移後的設定報告與遷移前一致的自有原始碼無問題基線：移除了一項冗餘測試斷言，而 `tsc` 要求的一處結構性類型轉換使用了窄範圍的 Oxlint 抑制指令。以已刪除 ESLint 設定的精確 blob 為基準進行的一次性審核在完成規則名對映後確認：原始碼為 88 項對 88 項，示例為 87 項對 87 項，測試為 83 項對 83 項。已提交的指紋鎖定這些經審核的 Oxlint 規則設定及完整的覆蓋結構；它既不執行已刪除的設定，也不納入後續的上游預設變更。對 `typescript-eslint@8.61.0` 的評估還確認，`strictTypeChecked` 並未啟用 `@typescript-eslint/no-empty-function`；已刪除、僅用於測試的 `off` 條目不起作用。

可執行約定測試要求包、host 和 client 項目產生類型感知診斷，斷言 client 專用指令碼所用的項目，拒絕未匹配的回退分析，並檢驗 Stylistic、SonarJS 和 nursery 相容路徑。它們還鎖定暫存設定不載入項目的繼承行為與 TypeGraph fixture 覆蓋、未使用抑制指令的報告行為、僅選擇已忽略暫存文件的情況、完整的 Stylistic 規則集，以及收斂後最終格式化的位元組。執行器測試鎖定兩項工作執行緒控制，型別檢查則確認遷移引發的原始碼改動沒有破壞 TypeScript 程序。

## 考慮過的替代方案

**在全倉庫範圍內同時執行兩個 linter。** 所有正確性規則均可透過 Oxlint 原生規則、nursery 規則或 JavaScript 外掛程式相容層獲得。在全倉庫範圍啟用 ESLint 回退會保留較慢的項目服務初始化和兩套正確性設定，卻不會增加任何檢查。

**使用單獨的格式化器。** 遷移保留了窄範圍的 ESLint 流程，因為當時認為相容層無法執行修復。鎖定版本的工具鏈證明能夠執行相同修復後，[僅使用 Oxlint 的修復工作流程](2026-08-09-oxlint-only-fix-workflow.md)以一次有界重試取代了該部分決策。

**移除尚無原生實作的 @stylistic 或 SonarJS 規則。** 這會移除相依性，但也會削弱機械質量約定。相容層會保留這些規則，直到能夠透過單獨決策評估原生替代規則。

**遷移期間用 Oxfmt 替換 @stylistic。** 格式化器遷移會產生超出 lint 引擎邊界的輸出變化，並帶來全倉庫格式 diff。保留既有規則可使本次變更便於評審，並讓格式化器選擇保持獨立。

## 結果

本機遷移測量顯示，不使用結果快取時，一次無問題的類型感知 lint 執行從約 61 秒縮短至約 8 秒。確切比例因主機而異，不構成效能保證。

類型感知診斷現在來自透過 `oxlint-tsgolint` 捆綁的 TypeScript Go 分析器，因此即使 `tsc` 接受同一程序，邊界場景下的類型推斷也可能與 typescript-eslint 不同。lint 與型別檢查仍是兩項相互獨立的必要證據。

JavaScript 外掛程式相容 API 和暫存設定是需要維護的額外邊界。每次提交把類型感知診斷留給公共 lint 和 CI，並避免相依性生成的聲明。全倉庫驗證、修復、類型感知分析、快取政策、工作執行緒控制和內聯指令仍由 Oxlint 負責。
