# dsh-invariants

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用於包自有執行時期不變數檢查的可設定登錄檔服務。根外掛程式註冊 `ctx.invariants`；它不包含產品檢查或產品包匯入。每個工作區包都發布一個 `./invariant` 配套入口，用於註冊其精確 npm 包名。

## 服務：`InvariantRegistry`（`ctx.invariants`）

```ts
interface Config {
  enabled?: boolean
  package_allowlist?: string[]
  package_blocklist?: string[]
}
```

預設值為 `enabled: true`、`package_allowlist: []` 和 `package_blocklist: []`。只有在服務啟用、allowlist 為空或至少一個 allowlist pattern 匹配完整 npm 名稱，且沒有 blocklist pattern 匹配時，包才被選中。因此，blocklist 匹配優先於 allowlist 匹配。

每個條目都是區分大小寫的 JavaScript 正規表達式源，使用 `new RegExp(pattern)` 編譯。除非源提供 `^` 和 `$`，否則匹配不錨定；不解析 `/pattern/flags` 文法。同一清單中的空白、帶前後空白、無效或重複條目會使服務啟動失敗。有效 pattern 可以不匹配任何當前已載入包，以使後續載入和 HMR（熱模組替換）保持確定性。

`ctx.invariants.register(packageName, installer)` 為完整 npm 包名保留一個活動註冊，即使過濾器使其 installer 保持非活動，並返回 disposer。已啟用貢獻在專用子 Cordis fiber 中執行。installer 可以透過 `installer.inject` 聲明所需服務介面，並收到 `fail(message)`；後者拋出綁定到註冊包的 `InvariantError`。在註冊成功前，系統會等待同步或非同步 installer 完成；失敗會原子地 dispose（資源釋放）子級並釋放歸屬。

服務擁有每個註冊 fiber，返回的 disposer 同時屬於配套 fiber。解除安裝任一側都會移除監聽器、跟蹤狀態和保留。因此，配套入口可以重新載入並註冊同一包名，而不保留舊狀態。由工作階段支撐的配套入口從持久事件重建 baseline；僅即時配套入口觀察重新載入後開始的操作。

`InvariantError` 擴充 `Error`，攜帶穩定 `code: 'INVARIANT'`，並公開所屬 `packageName`，而不向服務新增產品相依性。

在每個組閤中，Session 自身負責不可變且在對外介面層面有效的日誌儲存：它對每個候選項製作一份無損 JSON 快照，驗證引用的源事件是否齊全以及位置替換是否合法，將 `tool/result` 替換限制為一個當前結果的 `content`，深度凍結已接受記錄，並透過不可變陣列快照公開日誌。`dsh-session` 不變數配套入口檢查 Session 不負責的其餘跨記錄規則。

## 包配套入口

發布和註冊覆蓋全部包；但不會為了覆蓋全部包而人為編造執行時期斷言。只有當包擁有可觀察事件關係或相關可變資料關係時，配套入口才安裝檢查。確認必需方法、外掛程式名稱、注入、effect 或固定純函式結果屬於類型、載入或單元測試關注點，而非執行時期不變數。

如果不存在合理的執行時期關係，配套入口使用空 installer，並以包專用的前置 `No runtime invariant:` 註解說明原因。純工具、行為已透過其介面包觀察的薄實作、僅組合包、二進位程序、需要透過崩潰測試和往返測試驗證其約定的持久化配接器和測試支援包通常屬於此類。當 owner 獲得可變狀態或事件協定時，必須重新審視該說明。

當前可執行配套入口保護以下關係：

| 配套入口 | 檢查 |
|---|---|
| `dsh-session`、`dsh-agent`、`dsh-scope`、`dsh-agent-loop` | 工作階段包含關係和呼叫/結果跟蹤、agent（代理）狀態轉換、inbox FIFO 守恆、作用域 subject 和模型請求重建。 |
| `dsh-llm`、`dsh-llm-retry`、`dsh-tools`、`dsh-system-prompt` | 流文法、持久重試位置和邊界、工具管線階段與凍結結果，以及權威提示詞組裝資料。 |
| `dsh-compaction`、`dsh-hook-protocol`、`dsh-sandbox-policy` | 持久壓縮（compaction）與掛鉤配對、壓縮中繼資料和沙盒 mode 詞彙。 |
| `dsh-fs`、`dsh-subagent`、`dsh-workflow` | 檔案系統事件身份、提供方/子級配對和工作流程/agent 生命週期身份。 |
| `dsh-goal`、`dsh-goal-round-driver` | 持久 goal 來源/內容一致性、修訂和生命週期轉換、時間戳、依次獲準的 Round 和重建的繼續提示詞。 |
| `dsh-permission-presets`、`dsh-user-approval` | 活動 preset 引用和審批詢問/決定審計配對。 |
| `dsh-jobs`、`dsh-tool-todo` | 任務快照生命週期/歸屬欄位和持久整表 todo 結構。 |
| `dsh-time-context` | 持久化時鐘讀數與工作階段中正在進行的輪次、下一步驟開始前的位置及已用時間 baseline 一致；算繪時間可解析，且不晚於其事件。 |

每個 owner 的根入口仍獨立於診斷。單獨載入服務不會安裝產品檢查；在沒有服務時載入配套入口，會等待其聲明的 `invariants` 注入。

`pnpm run verify-package-invariants` 發現全部工作區包。它拒絕生成標記、未說明的空 installer、省略或忽略 reporter 的非空 installer、錯誤註冊名稱，以及不完整的匯出、發布、相依性、TypeScript 引用或 bundle 接線。該原始碼規則是最低歸屬檢查；聚焦測試證明每個可執行配套入口的語義。

## 組合

```ts
import type { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'

declare const ctx: Context

ctx.plugin(InvariantRegistry, {
  enabled: true,
  package_allowlist: ['^@deepseek-ai/dsh-'],
  package_blocklist: ['^@deepseek-ai/dsh-agent-loop$'],
})
ctx.plugin(SessionInvariant)
```

標準 agent 組合掛載服務和 4 個核心有狀態配套入口。自訂組合為希望檢查其約定的其他已載入包顯式新增配套入口；過濾器可以在不改變包入口的情況下停用或選擇註冊。

每個普通 Vitest 拓撲都掛載顯式啟用的服務和當前測試包的配套入口。聚焦套件覆蓋可執行配套入口的合法與違規觀測，一個窮盡拓撲則掛載全部配套入口，以證明註冊和 dispose 接線。

## 模型體驗

無。服務和配套入口觀察執行時期事件和可變快照，不會更改提示詞、訊息、schema、流或工具結果。

#### KV Cache 影響

無；不變數檢查不組裝或傳送提供方請求。

## 已知限制與暫緩事項

- 請求重建覆蓋 loop 在凍結前顯式標記的請求；直接一次性 LLM（大型語言模型）呼叫即使由呼叫方凍結或附加工作階段 id，仍不在該標記約定內。
- 僅即時生命週期配套入口無法重建自身重新載入前開始的操作。標準組合和測試組合會在相應操作開始前掛載它們。
- 正規表達式過濾器在服務生命週期內固定；更改它們需要執行普通 Cordis 外掛程式重新載入。
