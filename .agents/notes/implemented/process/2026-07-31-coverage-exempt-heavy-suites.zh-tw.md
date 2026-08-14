# Agent Note: 覆蓋率豁免重型套件

Status: implemented

[English](2026-07-31-coverage-exempt-heavy-suites.md) | 繁體中文

## Problem

CI 覆蓋率 lane（`check:ci:coverage`）的牆鐘被少數幾個重型測試文件釘死：本機 6-worker 全量剖析中，555 個測試文件聚合 1595 秒，其中 `packages/typert/generator/tests/type-model.spec.ts` 一個文件佔 885 秒，前 10 個文件佔聚合時長的 84%。這類套件的共同點是每個用例都做全工作區編譯器分析或真實子行程 fixture（測試前置資料），v8 插樁把這類程式碼的執行時期間放大數倍。

關鍵的浪費在於：這些套件繳納的插樁稅對 per-file 100% 閾值**沒有任何貢獻**——它們行程內執行的被度量程式碼，要麼本來就不在閾值口徑內，要麼已由其他套件獨立滿覆蓋。繼續在插樁下執行它們，純粹是用 lane 時長換零資訊。

## Decision

`ci-coverage` 聚合拆成兩個平行 gate，全部測試仍然執行，只有重型套件不再交插樁稅：

- **插樁 gate**（`test:coverage`）：設 `DSH_COVERAGE_EXEMPT_HEAVY=1`，`vitest.config.ts` 據此從兩個 project 的 exclude 中剔除豁免套件，其餘全部文件照舊插樁並承擔全部閾值證明。經 gate 自帶 env 注入（既有 `Gate.env` 機制），不進 workflow 全域性環境，因此並排的無插樁 gate 和本機直跑 `vitest run` 都看不到該變數、行為不變。
- **無插樁 gate**（`test:coverage-exempt-heavy`）：用配對的 positional filter 恰好執行豁免套件，保證正確性訊號不縮水。

`scripts/coverage-exempt.ts` 是唯一名單點，集中持有成員資格約定與 filter/exclude 配對，防止兩側漂移。

### 豁免名單與逐項對帳

一個套件對覆蓋率有貢獻，當且僅當它在行程內執行了被度量的文件（`coverage.include` = 包 src 樹）。現行名單逐項核對：

| 豁免套件 | 行程內執行的被度量程式碼 | 覆蓋由誰接住 |
| --- | --- | --- |
| typert generator 全部 6 個 spec | generator 自身 src | generator src 已整包 threshold-excluded（`vitest.config.ts`），本不在閾值口徑內 |
| 其中 tools-catalog.spec 額外 import | `typert-registry`、`tool-cordis` 的 src | 兩包各自的測試獨立滿覆蓋（focused coverage 實測無閾值錯誤） |
| `scripts/install-lefthook.spec.ts`、`scripts/oxlint-contract.spec.ts`、`scripts/change-scope.spec.ts` | 無——被測對象是 `scripts/` 原始碼（從不在 coverage.include），執行方式是 spawn 子行程 | 無需接 |

### 成員資格約定

新增豁免必須同時滿足：套件行程內執行的每個被度量文件都已由其他套件滿覆蓋（或在閾值排除名單內）；filter 與 exclude 選中完全相同的文件集。約定文字隨名單同文件維護。

### 閘門自動守衛名單正確性

per-file 100% 閾值本身就是豁免名單的守衛，名單錯誤無法靜默透過：

- 若未來某個豁免套件實際獨家覆蓋著某個被度量文件，插樁 gate 當場紅（該文件跌破 100%）；
- 反向同理：出現「只有豁免套件才覆蓋」的新程式碼，同樣立刻紅。

因此覆蓋率結果的不變性不相依性人工維護名單，符合「misconfiguration fails loud」約定。唯一失去的是豁免套件自身的執行不再產出覆蓋資料——由上表可知這些資料全部冗餘，最終報告在閾值意義上逐文件相同。

## Alternatives considered

- **CLI `--exclude` 從插樁 gate 剔除豁免套件。** 實證無效：vitest 4 的 `cliExclude` 不參與 per-project include 解析，多 project 設定下豁免套件仍被選中，故改走 env + config。
- **降低 worker 數或提高 gate 並行。** 事故期間實測無效：lane 牆鐘被尾部最長文件釘死（聚合/牆鐘 ≈ 4× 有效平行），並行旋鈕兩個方向都動不了尾巴。
- **跨 runner 區塊（`--shard` + blob 合併）。** 能進一步壓牆鐘但引入 matrix、artifact 管道與合併 job 的複雜度；拆分落地後 lane 已到約 2 分鐘，不值得付。若未來套件規模再漲可重新評估。
- **直接刪除或跳過重型套件。** 拒絕：它們是 typert generator 與 scripts 工具的唯一正確性證據，無插樁並排執行保住全部訊號。

## Verification

CI 實測（16 核 runner）：拆分前 gate 段 424 秒，拆分後兩 gate 平行 `test:coverage` 95.9 秒 + `test:coverage-exempt-heavy` 71.1 秒，lane 收斂於較慢者約 96 秒；拆分前後插樁 gate 閾值錯誤均為零。`vitest list` 驗證 env 開關兩態恰好增刪豁免集；`run-gates.spec.ts` 覆蓋聚合圖構造。

## Consequences

- 覆蓋率 lane 的 gate 段從約 7 分鐘降到約 96 秒，閾值結果與執行測試集均無變化。
- `DSH_GATE_CONCURRENCY` 在本 lane 重新擁有兩個可調度對象，聚合調度器不再是直通。
- 向名單新增重型套件必須完成上述成員資格對帳；錯誤條目會讓插樁 gate 大聲失敗，而不是靜默侵蝕覆蓋率。
- 豁免套件不再出現在覆蓋率報告的貢獻文件清單中；其正確性訊號完全由無插樁 gate 的紅綠承載。
