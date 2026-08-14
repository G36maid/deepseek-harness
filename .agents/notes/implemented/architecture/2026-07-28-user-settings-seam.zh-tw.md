# Agent Note: 使用者設定 seam（`ctx.settings`）與文件提供方

Status: implemented

[English](2026-07-28-user-settings-seam.md) | [简体中文](2026-07-28-user-settings-seam.zh.md) | 繁體中文

> 範圍：`packages/settings/` 能力族——Service Definition、文件提供方，以及使用者設定與 `cordis.yml` 的組合邊界。[web config-tree note](2026-07-24-web-config-tree-boot-and-transport-layering.md) 曾把「profile 寫路徑」記為延後項；本 seam 就是該寫路徑的歸屬。消費端遷移（主題、語言、默認模型路由）與 web `settings.*` RPC 面是後續工作，不在本 note 已交付範圍內。

## 問題

使用者可編輯設定沒有歸屬：`dsh web` 經靜態白名單讀 cwd 錨定的 profile json 且無寫路徑，TUI 讀 `$DSH_HOME/config.yaml` 裸 loader patch，兩者都在啟動時凍結。個人設定頁（web GUI）需要一個跨 surface 的使用者層，帶 schema 校驗、寫路徑與熱傳導——同類產品（Codex、Claude Code、Kimi、OpenCode、Pi）也全部收斂於「使用者偏好與擴充組合分離」。Loader 的 reactive 設定更新承載不了這件事：`fiber.update` 原地替換 entry config，構造期讀過設定的外掛程式毫無感知，也沒有任何回呼通知它。

## 決策

**兩個面，一條判定。** `cordis.yml`（+ Include patches）仍是組合面：有哪些外掛程式、接線、部署設定，歸 orchestrator 所有並隨產品升級。settings namespace 只承載使用者可編輯子集；判定是「個人設定頁應該能改它嗎？」值可同時存在於兩個面而不歧義，因為分層就是約定：schema 預設值，然後註冊方的組合 `base`（其 entry 設定子集），最後使用者文件分節。

**映像檔 `session-persistence/` 的三包邊界。** `dsh-settings` 擁有抽象 `SettingsProvider` 服務：namespace 登錄檔、分層解析、schema 校驗、按 namespace 深相等變更偵測，以及 `settings/updated` 提交事件。提供方只實作 `writable`/`load()`/`persist(ns, section)`，並透過受保護的 `publish(doc)` 推入外部觀察到的文件——因此熱更新語義對所有提供方一致，網路設定中心後端（nacos 類，可能只讀）只是一個平級包的距離。`dsh-settings-file` 是文件提供方：由 `resolveSpec` 定位的 YAML/JSON（默認路徑顯式設為 `<DSH_HOME>/settings.yaml`）、chokidar 監聽、在跨行程寫鎖下以 `0600` tmp+rename 原子提交的讀改寫持久化、對被寫 namespace 的葉子級 diff 修補（未觸碰節點的註釋得以保留）、按內容相等抑制自寫（[write-path integrity note](2026-07-30-settings-write-path-integrity.md)）。

**註冊是呼叫方 fiber 上的 effect。** `register()` 經服務代理呼叫，`this.ctx` 即註冊方上下文，註冊掛在 `ctx.effect` 上：對註冊方執行 dispose（資源釋放）時，即移除 namespace 及其觀察者（經 HMR（熱模組替換）資源釋放測試證明），而使用者的分節繼續留在儲存中等待下一任 owner。

**靜止時響亮報錯，執行中保留最後可用值。**啟動期與註冊期校驗直接拋錯（非法存量分節使正在註冊的外掛程式失敗；存在但不可解析的文件使提供方載入失敗）。執行中壞的外部編輯只告警並按 namespace 保留最後可用狀態——熱重新載入絕不拖垮行程。該不對稱映像檔 `Include.refresh()` 與 Kimi 的安全執行時期重載。

**消費端天然選填。**消費端在 `ctx.inject(['settings'], …)` 內註冊；不掛提供方時仍只按 entry 設定解析，因此所有既有組合、demo、快照原樣工作，遷移按外掛程式漸進。

## 備選方案

- **以 Include 寫回為使用者層**（cordis-webui 式的按外掛程式設定頁寫 loader entry 文件）：寫回目標是按組合的文件，會把使用者偏好綁死在某個 `cordis.yml` 上；使用者層必須在範本升級中存活，並以同一文件服務 TUI 與 web。
- **以 Loader reactive `fiber.update` 為傳導通道**：構造期讀取毫無感知；seam 的顯式 `watch()` 把熱更新變成消費端約定而非框架魔法。
- **領域化的 settings 服務**（按產品域的 getter）：因耦合而否決；服務只做儲存、校驗、發布——領域含義留給擁有 schema 的註冊方。
- **現在就做多層優先級**（Codex/Claude Code 式 system/managed/project 層級）：延後到真實第二層出現；resolve 步驟是分層未來唯一的擴充點。
- **現在就上跨行程鎖**（Pi 的 proper-lockfile）：最初以「原子替換加 watcher 收斂，真實衝突出現再說」為由延後——但收斂會丟失未觀察到的同級 namespace，因此該延後已被 [write-path integrity note](2026-07-30-settings-write-path-integrity.md) 的手寫寫鎖取代。

## 後果

按相依性順序延後：web `settings.raw`/`settings.describe`/`settings.update` RPC 面（暴露前必須對 `role('secret')` 欄位脫敏）；首批消費者遷移（`ui-theme`、語言、api-gateway 默認路由）並退役 `PROFILE_MAPPINGS` 與 profile json；面向金鑰的 `${env:VAR}` 值間接引用；provider 側分層。keyless 快照義務隨第一個對模型或產品使用者可見的消費端落地，而非本基礎設施步驟。
