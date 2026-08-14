# Agent Note: 獨立的 Events 兜底掃描補上 Cordis 表面完備性缺口

Status: implemented

[English](2026-08-09-cordis-event-walk-backstop.md) | 繁體中文

## 問題

`gen-cordis-catalog` 渲染 Typert host face 投影發現的每個服務與事件，fail-closed 的頁面對映（`SERVICE_PAGE`、`EVENT_SCOPE_PAGE`）保證每個被發現的 key 或 scope 恰好落在一個 `docs/subsystems/` 頁面上（頁面區塊機制歸[按子系統區塊決定](../process/2026-07-28-per-subsystem-cordis-surface-regions.md)所有）。但"發現"本身此前只對服務有兜底：一條獨立的 AST 掃描讀取每個 `declare module 'cordis'` Context merge，要求每個聲明的 key 要麼被渲染、要麼在 `SERVICE_WALK_EXEMPTIONS` 中給出具名理由。

事件沒有這樣的兜底。投影只遍歷從 host face 包匯出可達的文件，因此 client face 程式碼——或 host 分析器無法觸及的任何文件——裡的 `interface Events` merge 會無聲消失：12 個已聲明事件（`slash/input-*`、`theme/change`、`locale/change`，以及 client runtime 的 `*/changed` 失效訊號）不出現在任何生成文件中，而且再多一個也不會有任何機制察覺。服務掃描的 glob 也只有 `packages/*/*/src/*.ts`，於是聲明在巢狀文件（`src/client/**`）中的 13 個 client face Context key 恰恰對這條為防止無聲消失而存在的掃描不可見。

## 決策

事件獲得與服務兜底完全對稱的機制，且兩條掃描都讀取完整的包原始碼樹。

`scripts/cordis-walk.ts` 新增 `eventNameList`（`interface Events` merge 的每個成員名，方法與屬性成員一並讀取，使投影器會拒絕的形狀也進入掃描）；掃描產出文件中每一個 `declare module 'cordis'` 塊（Typert 分析器讀取全部塊，止步於第一個會藏起第二個塊的表面），其對引號風格不敏感的預過濾匹配 `declare module` 頭部而非字面文字 `interface Context`，從而不再跳過只含 Events 或使用雙引號的 merge 文件。`gen-cordis-catalog` 的掃描 glob 從 `packages/*/*/src/*.ts` 加深為 `packages/*/*/src/**/*.{ts,tsx}`（兩個 pattern）。分區新增第三個方向守住掃描自身：投影渲染的每個服務 key 與事件名也必須對掃描可見，使掃描回歸（glob、預過濾、塊遍歷）成為硬錯誤而非兜底的無聲退化。

新的人工維護對映 `EVENT_WALK_EXEMPTIONS` 為投影看不到的每個已聲明事件命名，附理由與擁有其表面的包 README。鍵是完整事件名而非 scope：client face 事件與已渲染的 host 事件共享 scope（`commands/changed` 與 host 的 `commands/*` 家族並存），scope 級豁免會無聲吞掉未來的 host face 回歸。分區檢查與服務對映一樣雙向 fail-closed：未豁免的不可見事件、已渲染事件的豁免、無任何 merge 聲明的豁免，皆為硬錯誤。

分區判定從 `computeOutputs` 中提取為純函式 `walkPartitionProblems(input, maps)`，使每條驗收路徑都能以單元測試證明而無需執行 Typert 投影；`computeOutputs` 向它饋送渲染模型加獨立掃描結果，頁面拼接錯誤的聚合方式保持不變。

促成本決定的審計發現 host face 本已完備：48 個渲染服務 + 10 條 walk 豁免覆蓋全部 58 個 host 可見 Context key，49 個 host 事件全部渲染，且每個渲染簽名中的每個類型名都已被既有的 fail-closed `LINK_MAP`/`FOUNDATION_TYPE_NAMES`/`TYPE_LINK_EXEMPTIONS` 檢查分類。25 條發現（12 事件、13 key）全部在 client face；現在每條都帶指向其所屬 README 的具名豁免，與既有的 `appShell`/`connection` 先例一致。

## 驗證

`scripts/gen-cordis-catalog-partition.spec.ts` 證明每條驗收路徑：綠色分區、不可見且未豁免的事件（報出聲明文件）、已渲染事件的過時豁免、從未聲明的過時豁免、服務側的對稱路徑、兩個頁面對映中未對映的已渲染表面、掃描看不到的已渲染表面（第三方向），以及掃描觸達巢狀的僅含 Events 的 merge、多塊文件的每個塊、雙引號頭部與 `.tsx` 原始檔。在真實原始碼樹上刪除一條現役豁免會讓 `gen-cordis-catalog` 以事件名與聲明文件顯式報錯；復原後生成器回到位元組相同的 no-op 再生成（85 個產物，寫入 0 個），這同時證明新豁免恰好覆蓋當下表面。doc-sync 中的 `verify-cordis-catalog` 每次執行都會執行該分區檢查。

## 考慮過的替代方案

- **渲染 client face 而非豁免。** 以 `faces: ['host', 'client']` 分析並給 client 服務/事件生成區塊纔是對盲區的根治，但它改變子系統目錄的定位（host 層參考），並要求為純瀏覽器表面做頁面歸屬決策；既有的 `TODO(cordis-catalog-interface-services)` 已跟蹤拓寬投影。兜底是保證，渲染是其上的升級。
- **scope 級事件豁免。** 對映更小，但 `commands/changed`（client）與已渲染的 host 事件共享 `commands` scope，豁免整個 scope 會無聲吞掉未來的 host face 事件——正是本決定要消除的失敗模式。
- **用 Typert 推導完備性而非原始 AST 掃描。** 投影與兜底必須獨立失敗：Typert 的可達性 bug 恰是兜底要捕獲的對象，因此掃描刻意保持為不共享機制的樸素 `ts.createSourceFile` 遍歷。
- **對渲染簽名的傳遞類型閉包設門。** 決定前先測量：渲染簽名中可達的每個類型名都已分類，更深的欄位套欄位類型由頁面手工維護的 `type-equiv` 貼上與包 README 擁有；閉包門會在沒有讀者需求的情況下強迫內部類型認領頁面。

## 後果

新的 cordis 事件——host 或 client、任意文件深度——必須渲染到某個子系統頁面，或在 `EVENT_WALK_EXEMPTIONS` 中以其文件所有者具名；刪除事件時必須一並退役其豁免。聲明在 `src/` 下任意位置的 Context key 現在同樣如此。人工維護對映增加了 25 條 client face 條目，理由全部指向包 README，使子系統目錄保持 host 層參考的定位。`walkPartitionProblems` 是分區判定的唯一居所；未來的兜底維度（如渲染 client face、schema 表面）應擴充它及其 spec，而非把檢查重新內聯進 `computeOutputs`。
