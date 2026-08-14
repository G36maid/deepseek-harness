# Agent Note: Client Settings、Locale 與 Theme 分層

Status: proposed

[English](2026-07-25-client-settings-locale-theme.md) | [简体中文](2026-07-25-client-settings-locale-theme.zh.md) | 繁體中文

## 問題

瀏覽器端已有的 Settings 直接寫在 Sidebar 內，語言和主題也由元件本機狀態直接改 DOM。這使 Settings 無法由獨立外掛程式擴充，偏好狀態沒有穩定的跨外掛程式服務約定，主題登錄檔同時承擔狀態與呈現職責。

## 提案

**協作導向（後續所有模組接入 Settings 的方式）：功能屬主自註冊。** Settings 殼是純組合面：只聲明 slot、渲染 chrome 結構，零文案、不相依性 locale、不 import 也不枚舉任何功能；一個功能要出現在 Settings 裡，由它自己的外掛程式向對應 slot 註冊——locale 註冊 Language 行，ui-theme 註冊 Appearance 行，ui-settings-models 註冊 Models 一級面板。不為「某功能的設定頁」單開 `ui-settings-*` 包：設定面屬於功能包本身（做 Theme 功能，Theme 的設定選擇就隨 ui-theme 一起交付）。不屬於任何單一功能的內容（trigger/標題/close 的 chrome 文案、General 目錄與骨架行、`settings` 字典）由 `ui-settings-general` 擁有——它是「無主文案」的屬主，不是功能衛星包。

Sidebar 聲明 `sidebar.settings` single slot，`ui-settings` 佔用它並聲明四個 slot：`settings.trigger` / `settings.header` / `settings.close`（chrome 內容座，single）與 `settings.section`（一級頁面，list）。無障礙名稱全部解析自 slot 內容：trigger 的無障礙名稱即其文字內容，dialog 經 aria-labelledby 指向 header 內容節點，close 是視覺隱藏文字座。每個 section 由功能外掛程式貢獻；殼只從 slot ledger 讀取 entry metadata 生成導覽，透過 `only` 渲染當前 section。General 由 `ui-settings-general` 註冊（order 0）並聲明 `settings.general.item` list slot，功能外掛程式的偏好行按 order 排入。

Settings 入口是 sidebar Foot 的 Settings 行，點擊直接打開 1080×700 置中浮層（黑 24% 遮罩）；close 按鈕、點擊遮罩、ESC 均關閉。無任何中間選單形態。

`@deepseek-ai/dsh-client-locale` 提供 `ctx.locale`，`ui-theme` 提供 `ctx.theme`。兩個服務都以 getter 讀取、setter 寫入並用 typed Cordis 變更事件發布不可變快照；服務自己持久化偏好（只存 id，無效值回退默認）。

功能行的 apply 層各自訂閱自家變更事件（locale 訂 `locale/change`，ui-theme 訂 `theme/change`），把快照投影到該行註冊時聲明的 slot store。React 元件只讀 `useStore`、寫注入的 setter callback，不讀取 ctx 或服務。

Theme 偏好三態：`light`、`dark`、`system`，默認 `system`（無持久化偏好或無效值時）。system 的解析屬主題領域：ThemeRuntime 持有 `prefers-color-scheme` matchMedia 監聽（環境感知，非 DOM 呈現），偏好為 system 且系統配色變化時重發快照；快照同時攜帶 `preference` 與解析後的 `active` 定義。

Theme 服務不操作 DOM。`ui-layout` 初始讀取 Theme getter，隨後訂閱 `theme/change`，由 Layout 持有的 presenter 按 `active` 更新 `body[data-ds-dark-theme]` 和主題 token；presenter 不感知 system，只消費已解析結果。

### 首期註冊面

| 註冊面 | 屬主外掛程式 | 首期內容 |
|---|---|---|
| chrome 內容（trigger/header/close）| `ui-settings-general` | 設定入口行圖示+文案、面板標題、close 隱藏文字 |
| General section（order 0）| `ui-settings-general` | Permission、Tool Call 視覺骨架（無寫操作）+ `settings.general.item` slot 聲明 |
| Language 行（item order 0）| `locale` | Selector 下拉，中文/English 真實可切 |
| Appearance 行（item order 10）| `ui-theme` | Light/Dark/System 三 cube 真實可切（選中態看 preference） |
| Models section（order 10）| `ui-settings-models` | 僅導覽項，內容區為空；後續模型管理功能落在該包 |
| 外掛程式 | 無 | 首期不做，導覽不出現該項（後續外掛程式功能包註冊 section 即自動出現） |

首期只對 Settings 浮層內文案進行本機化；字典就近存放——chrome + General 骨架歸 `ui-settings-general` 的 `settings` namespace，功能行文案歸各功能包（`settings.locale`、`settings.theme`、`settings.models`）。

### slot 拓撲

```text
root
└─ sidebar
   └─ sidebar.settings                   single/root
      └─ ui-settings（壳，零文案）
         ├─ settings.trigger             single/root  ui-settings-general 注册
         ├─ settings.header              single/root  ui-settings-general 注册
         ├─ settings.close               single/root  ui-settings-general 注册
         └─ settings.section             list/root
            ├─ general (order 0)         ui-settings-general 注册
            │  └─ settings.general.item  list/root
            │     ├─ language (0)        locale 注册
            │     └─ appearance (10)     ui-theme 注册
            └─ models (order 10)         ui-settings-models 注册
```

section/item contribution 使用 `ctx.slots.inject()`，不相依性 client manifest（中繼資料清單）的 apply 順序；本機化 label 走 [全量接入 Note](../../implemented/architecture/2026-07-30-client-locale-full-rollout.md) 的 label thunk。SlotMap 類型分家：trigger/header/close/section 正家在 ui-settings 約定（消費端 general/models 均相依性殼，無環）；`settings.general.item` 正家在 locale 包——它是全部 item 註冊方的最低公共相依性（設定行必帶文案），而聲明方 general 的約定對 locale/ui-theme 不可達（會成環）；ui-theme 經 re-export 出口消費。

### slot 聲明是一等可注入等待對象

`SlotRegistry.inject()` 直接等待有類型約束的 ledger key；它不會將聲明橋接為合成的 `slot:<name>` Cordis 服務。回呼會跟隨聲明摺疊與重新聲明，而其控制器仍歸貢獻方外掛程式 fiber 所有；直接向未聲明 slot 註冊仍會直接報錯。這刪除了基於過時 disposer 的在位狀態機，以及容易因拼寫錯誤出錯的平行服務命名空間。完整的生命週期與失敗約定見 [slot 聲明注入決策](../../implemented/architecture/2026-08-05-slot-declaration-injection.md)。

### 服務約定

```ts
export type ThemePreference = 'light' | 'dark' | 'system'

export interface ThemeDefinition {
  id: string
  colorScheme: 'light' | 'dark'
  tokens: Record<string, string>
}

export interface ThemeSnapshot {
  preference: ThemePreference
  active: ThemeDefinition            // system 已解析为具体 light/dark 定义
  themes: readonly ThemeDefinition[]
  revision: number
}

export interface LocaleDefinition {
  id: 'zh' | 'en'
  label: string
}

export interface LocaleSnapshot {
  active: 'zh' | 'en'
  locales: readonly LocaleDefinition[]
  revision: number
}

export interface Events {
  /** @param snapshot - Current locale registry snapshot. @mode emit */
  'locale/change'(snapshot: LocaleSnapshot): void
  /** @param snapshot - Current theme registry snapshot. @mode emit */
  'theme/change'(snapshot: ThemeSnapshot): void
}
```

Locale 內建中文和 English；`setLocale`/`setTheme` 是唯一寫入口，未知 id 失敗。

## 曾考慮的替代方案

**由 app shell 統一訂閱偏好並重渲染 root slot tree。** 語言和主題變化只需要更新實際消費端；全樹刷新放大影響面，也把業務偏好接入 shell。

**Theme 服務直接修改 DOM。**登錄檔服務因此相依性呈現環境，生命週期與全域性樣式所有權不清；Layout 已經擁有頁面根呈現邊界。

**system 由 Layout presenter 解析。** presenter 需自帶 matchMedia 訂閱並在 themes 清單裡挑選具體定義，呈現層被迫理解偏好語義；解析放服務側則所有消費端拿到一致的已解析快照。

**Settings import 並枚舉各 section。** 新增頁面必須修改殼外掛程式，破壞「每個功能由自己的外掛程式佔用 slot」的組合模型。

**按功能為每個 section 單開 `ui-settings-*` 衛星包。** 設定面與功能本體分家：改 Theme 行為要動兩個包，包數隨設定項線性膨脹，且衛星包反向相依性 locale/theme 服務，形成純粹為拆包而生的中間層。功能屬主自註冊下不存在這層：preference 行隨功能包交付；`ui-settings-general` 只收無主文案（chrome 與 General 骨架），不承載任何功能的設定面。

**把 Locale/Theme 快照直接注入 React。** inject 結果按 entry identity 快取，易變值會過時；為每個服務自造 React 掛鉤也繞開 slot store 的統一綁定。

## 驗收標準

- Settings 殼只相依性 slot ledger，不相依性任一功能實作；General 的 item 清單同樣只相依性 ledger。
- 新增一個設定項 = 功能包自己註冊（section 或 general item），零殼改動。
- Locale 與 Theme 的寫入只走 setter，持續同步只走變更事件。
- 功能行 store 初始化走 getter，後續由自家變更事件更新並區域性重渲染。
- Layout 獨立應用 Theme 快照，Theme 服務不訪問 DOM；presenter 不出現 system 分支。
- 中文/English 與 Light/Dark/System 能切換並刷新後復原；偏好為 system 時系統配色變化即時生效。
- Models 只有導覽項與空內容區；Permission、Tool Call 骨架無寫操作。
- 浮層經 close 按鈕、遮罩點擊、ESC 均可關閉。

## 風險

slot 聲明與 contribution 的 apply 順序不固定，所有 section/item 註冊方必須使用 `ctx.slots.inject()`，而不能以服務或本機 disposer 作為在位訊號。service event 可能早於行首次渲染，功能行 store 的 init 與 inject attach 都必須從 getter 對齊當前快照。`settings.general.item` 的重複合併副本（locale、ui-theme）與 ui-settings 正家必須逐字一致，漂移即三處一起改。Layout 解除安裝時必須清理自己設定的全域性屬性，ThemeRuntime dispose（資源釋放）時必須移除 matchMedia 監聽，避免 HMR（熱模組替換）後殘留。
