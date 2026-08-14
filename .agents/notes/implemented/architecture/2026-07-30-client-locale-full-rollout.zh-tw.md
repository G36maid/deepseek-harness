# Agent Note: client 文案全量接入 typed locale 席位與不翻譯邊界

Status: implemented

[English](2026-07-30-client-locale-full-rollout.md) | [简体中文](2026-07-30-client-locale-full-rollout.zh.md) | 繁體中文

## Problem

typed locale 標準席位（`locale:` 註冊聲明 → 框架注入強類型 `t`）落地後，只有四個先行包接入；其餘 client 包的文案仍是硬編碼的中英混雜字面量。全量遷移需要幾個先行包沒有觸及的機制與邊界決定：註冊期文字（導覽行、檢視表 tab 的 label）在語言切換時如何刷新；zero-cordis 的 ui-primitives 原子元件如何拿到文案；哪些字串**刻意不**本機化——沒有記錄的邊界會誘使未來的 agent（代理）「補完」翻譯。

## Decision

**註冊期文字走 label thunk。** ui-slots 的 list 註冊項 `label` 接受 `SlotLabel = string | (() => string)`；owner 投影 ledger 行時必須經 `resolveSlotLabel` 解析（不裸讀 `options.label`），並讓讀取點跟隨 locale revision（outlet 自身訂閱 revision；ledger 外的投影如 ui-settings 導覽把 revision 並進快取鍵、訂閱雙源）。thunk 每次讀取時求值，語言切換零 ledger churn——沒有重註冊、version 不動，`locale/change` 重註冊接線全部刪除。

**元件文案走標準 `t` 席位；深層子元件用 prop 下傳**，類型寫 `XxxProps['t']`。字典規範形態不變：`zh satisfies Record<string, string>` 為 key 源、`en satisfies Record<XxxKey, string>` 鎖雙語平衡。

**zero-cordis 原子元件（ui-primitives）文案 props 化**：`HoverCard` 的 `copyLabel`/`copiedLabel`、`TerminalBlock`/`JsonTree` 的 `labels`、`CodeBlock` 的 `copyLabel`/`copiedLabel`、`MarkdownText` 的 `codeLabels`、`JsonBlock` 的 `truncatedLabel`、`ConnectionBanner` 的 `label`、`Modal` 的 `closeLabel`——預設值即原硬編碼字串，不傳 props 的消費端渲染逐位元組不變。已本機化的外掛程式從自己的 `t` 席位傳字典驅動的 label；傳對象 props 的呼叫點按 `t` 身份 memo（`MarkdownText` 的元件表按 `codeLabels` 身份快取）。

**不翻譯邊界（刻意決定，不是欠帳）：**

- **錯誤/失敗類字串一律英文**：client 自產的兜底串（`command failed`、plan 切換失敗）、RpcError 訊息、wire 透出的 `error.message (code)` 原樣呈現。
- **設計字面量不進字典**：工具行 variant 標題（Think/Bash/…）、SYSTEM/USER 類 kind 徽標、Plan chip 字標、整個 StatsLine——中英介面顯示一致。
- **ui-trajectory 整包緩做**（開發者檢查面，術語密集，單獨裁決）。
- **boot 文案保持硬編碼**（AppRoot 渲染早於 locale 服務可用）。

**派生層保持純函式，本機化只在渲染層**：ui-workspace 的 `relativeTime` 返回結構化 `{unit, n}` 由渲染組合字典範本；blank 工作階段/未分組桶的儲存標題不變，渲染按 `blank` 標志/`workspaceId` 缺席替換本機化文案；**搜尋態 blank 行一律排除**（雙語標題無法與單語查詢穩定匹配）。日期不引 Intl：格式範本進字典（訊息時鐘 `clock.md`/`clock.ymd`，workspace hover `date.ymd`），格式化函式喫 `t` 參數保持純。

**測試與 e2e 口徑**：`makeTranslate(...dicts)`（dsh-client-test-runtime）映像檔服務尋找鏈（首個命中字典勝出、key 兜底、`{name}` 插值），元件測試的 `t` 樁統一用它並以真實 props 席位定型。web e2e 統一透過 `newEnglishPage`（`en-US` 瀏覽器）打開，built-boot 快照 同樣固定 navigator 語言：golden 因而不受語言遷移影響。settings 語言切換用例繞開該 helper 並開啟 `zh-CN` 瀏覽器，因為在顯式 Host 偏好到達前，暫定 locale 會跟隨 `navigator`（[由瀏覽器推導初始 locale](../feature/2026-07-31-browser-derived-initial-locale.md)）。

[settings/locale/theme 分層 Note](../../proposed/architecture/2026-07-25-client-settings-locale-theme.md) 中「apply 層訂閱 `locale/change` 重註冊刷新 label」的機制已被本決定取代（thunk + revision 生命週期）。

## Alternatives considered

- **label 保持 string、語言切換時重註冊**（先行包的舊形態）：boot 已經為每個包註冊一次，`locale/change` 監聽者重註冊會放大成風暴；ledger version 抖動還會擊穿一切按 version 快取的投影。thunk 把刷新成本移到讀取點，讀取點本來就跟隨 revision。
- **給 ui-primitives 造 locale 上下文/注入通道**：破壞 zero-cordis 邊界（原子元件從此相依性執行時期），且強迫未本機化消費端（ui-trajectory）陪跑。props 化讓每個消費端獨立決定。
- **錯誤串進字典**：錯誤面是排障面，英文原樣最利於搜尋與上報比對；且 wire 透出串本就不可譯，半譯反而製造混合語言。
- **日期用 `toLocaleString()`/Intl**：跟隨瀏覽器/OS 語言而非應用語言，切換後必然產生混合文字；字典範本量小且與訊息時鐘同構。
- **blank 行參與搜尋（匹配本機化標題或儲存標題）**：任一選擇都在某個語言下「看得見搜不到」；佔位行本無資訊量，整體排除語義最穩。

## Consequences

- 語言切換全 UI 即時刷新且零重註冊；新包接入 = 字典 + declare-merge + `locale: NS` 三步，無手寫膠水。
- 代價：list label 的消費端必須知道 `resolveSlotLabel`（裸讀 `options.label` 現在可能拿到函式）；類型上 `SlotLabel` 已擋住多數誤用。
- ui-primitives 的中文預設值在英文語言下依舊是中文，**直到消費端傳入 labels**——未遷移的 JsonTree 消費端（ui-trajectory）顯示其英文預設值，恰好符合其整包英文現狀。
- e2e 英文釘死意味著 zh 默認態主要靠包級元件測試與 settings 語言切換用例覆蓋，瀏覽器 e2e 不再驗證 zh 文案。
