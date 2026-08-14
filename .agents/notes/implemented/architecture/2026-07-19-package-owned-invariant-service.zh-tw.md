# Agent Note: 包擁有的不變式服務約定

Status: implemented

[English](2026-07-19-package-owned-invariant-service.md) | 繁體中文

## 問題

執行時期不變式檢查跨越工作階段軌跡、agent（代理）狀態、作用域 dispatch 和請求重建。如果所有檢查都放在一個診斷包中，該包就必須匯入彼此無關的產品領域詞彙，測試也會離開真正的所有者；任何產品包新增或移除檢查時，都要修改中央包。

選擇啟用診斷的部署還需要比“是否載入一個外掛程式”更細的控制。這類組合會攜帶已知的不變式貢獻，同時允許全域性關閉或按包選擇診斷。包稍後載入或在 HMR（熱模組替換）下重載時，選擇結果必須保持穩定；被過濾的貢獻也不能讓兩個外掛程式靜默佔用同一個包名。

包所有權還必須覆蓋完整。若沒有機械化的倉庫規則，新包可能遺漏伴隨外掛程式、相依性或發布設定，並一直不會進入診斷範圍，直到維護者發現這一缺口。

## 決策

### 一個登錄檔服務，貢獻歸包所有

`@deepseek-ai/dsh-invariants` 是與產品無關的 Cordis 服務外掛程式，註冊 `ctx.invariants`。它只負責設定、註冊唯一性、子 fiber 生命週期和帶包歸屬的失敗；不匯入 session、agent、scope 或 agent-loop 包，也不包含這些包的檢查。

工作區內的每個包都發布 `./invariant` 伴隨外掛程式，註冊自己完整且準確的 npm 包名。如果所有者具備有意義的事件或可變資料關係，companion 就檢查該關係；否則空 installer 必須攜帶該所有者專屬的說明。後續的[執行時期約定 Agent Note](2026-07-19-package-invariant-runtime-contracts.md) 禁止生成的所有權佔位符和合成 API 形狀斷言。包的根入口不會隱式匯入或註冊診斷，因此載入根包不會改變執行時期檢查，也不要求不變式服務存在。

### 設定與選擇

```ts
interface Config {
  enabled?: boolean
  package_allowlist?: string[]
  package_blocklist?: string[]
}
```

預設值為 `enabled: true`、`package_allowlist: []` 和 `package_blocklist: []`。對完整註冊名的選擇規則為：

```ts
export function selected(enabled: boolean, package_allowlist: RegExp[], package_blocklist: RegExp[], packageName: string): boolean {
  return enabled
    && (
      package_allowlist.length === 0
      || package_allowlist.some(pattern => pattern.test(packageName))
    )
    && !package_blocklist.some(pattern => pattern.test(packageName))
}
```

blocklist 匹配優先於 allowlist 匹配。每個條目都是區分大小寫的 JavaScript 正規表達式源，透過 `new RegExp(pattern)` 編譯。除非呼叫方提供 `^` 與 `$`，否則匹配不錨定；系統不會解析斜槓包圍文法或 flags。服務啟動會拒絕空白、首尾帶空白、無效或同一清單內重複的源。沒有匹配當前已載入包的有效源仍然合法，因為註冊順序、稍後載入和 HMR 不應改變設定有效性。

### 註冊與失敗歸屬

公開註冊邊界是 `ctx.invariants.register(packageName, installer)`。即使過濾器禁止安裝，它也會為每個完整 npm 包名保留唯一的活躍註冊，並返回 effect disposer。解除安裝伴隨外掛程式或服務都會釋放註冊名及全部貢獻狀態。

啟用的 installer 在服務擁有的獨立 Cordis 子 fiber 中執行。`InvariantInstaller.inject` 顯式聲明該子 fiber 的服務 API；登錄檔不攜帶產品專用相依性元資料。服務會在註冊成功前等待 installer 返回的 promise，因此非同步啟動檢查仍具有交易性。installer 接收綁定後的 `fail(message)` 報告器。呼叫它會拋出名為 `InvariantError` 的 `Error` 子類，保留穩定程式碼 `INVARIANT` 並記錄註冊方 `packageName`；該錯誤不繼承產品包中的錯誤基類。

註冊啟動是交易性的。如果 installer 在註冊監聽器後失敗，子 fiber 會完整釋放，並在失敗向外傳播前解除包名佔用。被過濾的註冊不建立子 fiber，但會保留佔用直到 dispose（資源釋放）。伴隨外掛程式重載時總會從乾淨的 installer 狀態開始；有狀態貢獻從其所屬服務重建基線。

原有函式式外掛程式入口與單參數 `InvariantError` 構造函式不作為相容 API 保留。倉庫處於預發布階段，所有呼叫方會一起遷移到服務和帶包歸屬的錯誤。

### 首批有狀態伴隨外掛程式與完整所有權

| 伴隨入口 | 註冊名 | 所屬檢查 |
|---|---|---|
| `@deepseek-ai/dsh-session/invariant` | `@deepseek-ai/dsh-session` | 工作階段序列、輪次/步驟包圍關係和同一步驟的呼叫/結果軌跡 |
| `@deepseek-ai/dsh-agent/invariant` | `@deepseek-ai/dsh-agent` | agent 狀態轉換 |
| `@deepseek-ai/dsh-scope/invariant` | `@deepseek-ai/dsh-scope` | 作用域事件載體的存在性與主體一致性 |
| `@deepseek-ai/dsh-agent-loop/invariant` | `@deepseek-ai/dsh-agent-loop` | 模型請求重建 |

這四個所有者提供了首批有狀態檢查。後續執行時期約定決策為另外十七個確有事件或可變資料關係的所有者增加檢查，並為其餘包記錄有理由的空 companion。每個伴隨入口都是單獨打包的 `./invariant` export，具有獨立聲明和對 Loader 安全的命名空間外掛程式形態；服務包自身的伴隨外掛程式匯入本機服務類型，避免形成自相依性。

`verify-package-invariants` 會發現每個工作區包，並拒絕缺失的伴隨外掛程式原始碼、生成標記、沒有解釋的空 installer、缺少或不使用失敗報告器的非空 installer、外部或無法解析的註冊名、缺失的 `./invariant` export 或發布文件、缺失的不變式對等相依性（peer dependency）、開發相依性及項目引用，以及遺漏伴隨入口的自訂建置設定。

### 作用域事件語義對映

生成的作用域事件主體解析表位於 `dsh-scope`，與消費它的約定和不變式相鄰。`gen-scoped-events` 使用根 TypeScript Program 枚舉 `this: Scoped<Base>` 聲明，從真實 `scopeTarget(base, key)` 呼叫推斷路由鍵類型，並要求唯一、無歧義的 payload 主體或顯式 unsupported 標記。提交的執行時期對映不匯入事件所有者包，因此語義完整性不會擴大服務包或 scope 包的執行時期相依性閉包。

### 示例組合與 SDK 輸出

示例 agent 主幹會掛載服務和四個有狀態伴隨子路徑，並把 `enabled`、`package_allowlist` 與 `package_blocklist` 轉發給服務。生成的 SDK Cordis 組合輸出相同條目。子路徑條目新增可安裝的根 npm 包，而不會把子路徑誤當成包名。根據[交付設定決策](../simplification/2026-08-03-omit-invariants-from-shipped-config.md)，交付的 `dsh` TUI 與 Web 設定樹會省略該服務及其伴隨外掛程式。

Workspace 約束識別獨立的不變式 bundle；包 exports、項目引用、建置設定、相依性聲明和 lockfile 描述同一份發布元資料。生成的設定目錄、模組圖和 API 文件都從這些源派生。

## 測試

服務測試覆蓋預設值、全域性關閉、allow/block 選擇、blocklist 優先級、錨定與非錨定匹配、大小寫敏感、無效設定、零匹配模式、延遲註冊、重複所有權、dispose、回滾和 HMR 重新註冊。具備可執行檢查的所有者會把正向與負向行為保留在 companion 原始碼旁邊。

組合測試覆蓋標準主幹轉發和生成的 SDK 條目。Loader 測試固定每個伴隨命名空間，建置後的純 Node 冒煙測試覆蓋編譯子路徑 export。作用域事件新鮮度閘門會重新執行語義 Program 分析。

每個 Vitest 設定都會載入測試宿主；在普通 Cordis 根上下文啟動第一個外掛程式之前，宿主會掛載顯式啟用的服務，並新增當前測試包的伴隨外掛程式。一個完整拓撲會一次掛載所有包的伴隨外掛程式；服務與所有者的聚焦測試自行建置不變式拓撲，從而在不發生重複所有權衝突的前提下覆蓋關閉、過濾、回滾與重載。閘門測試還會執行每個伴隨外掛程式的 `apply` 函式，並驗證它呼叫 `register` 時使用 manifest（中繼資料清單）中的包名，而不是隻檢查原始碼文字。

## 考慮過的替代方案

- **把所有檢查保留在 `dsh-invariants`。** 不予採納，因為登錄檔仍要匯入所有被檢查的產品領域，所有者變更仍需中央編輯，測試也繼續遠離被保護的約定。
- **當 `ctx.invariants` 恰好存在時，讓根包入口隱式註冊檢查。** 不予採納，因為根入口行為會相依性組合順序與選填服務是否存在，診斷無法獨立選擇，而且包載入會隱藏一個不在顯式伴隨外掛程式中的註冊 effect。
- **在執行時期自動發現所有 `invariant.ts` 文件。** 不予採納，因為檔案系統或包發現不是執行時期所有權約定，會讓 bundle 發布含義不清，也無法表達顯式 Cordis 載入順序或相依性安裝。建置期生成與校驗以及測試宿主可以枚舉原始碼樹，因為它們驗證的是倉庫完整性，而不是組合已發布的部署。
- **根據當前已載入包集合驗證 allow/block 條目。** 不予採納，因為零匹配模式可能有意指向稍後載入或 HMR 載入的貢獻；當前載入順序不能決定設定有效性。

## 後果

- 產品包擁有並測試自己的關係斷言，服務保持與產品無關。
- 每個包都承擔 companion 的發布與相依性成本；只有具備有意義執行時期關係的所有者才增加 listener 或 trace 狀態成本。
- 掛載診斷的組合無需改變外掛程式樹即可關閉全部檢查或按包名選擇。
- 顯式伴隨條目讓診斷成本和所有權在 Cordis 設定與包 export 中可見。
- 每個選中的可執行貢獻增加一個子 fiber 及其 listener/狀態成本；選中的空貢獻不增加 listener 或 trace 狀態成本，被過濾註冊則只保留包名佔用。
- 正規表達式源屬於部署設定，在服務重載前保持固定。
- 普通 Vitest 根上下文會安裝當前測試包中被選中的伴隨外掛程式；一個完整拓撲只付款一次全部子 fiber 成本，用於覆蓋整個倉庫的註冊。
- 工作階段儲存驗證、快照、凍結、引用的源事件驗證與 surface 接受規則始終啟用，不受不變式選擇影響。
