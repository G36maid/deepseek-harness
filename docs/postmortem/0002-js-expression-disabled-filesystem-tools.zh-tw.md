# 事後檢討（postmortem） 0002：檔案系統快照工具被永久停用

[English](0002-js-expression-disabled-filesystem-tools.md) | [简体中文](0002-js-expression-disabled-filesystem-tools.zh.md) | 繁體中文

狀態：已解決

## 摘要

ACP（Agent Client Protocol）示例試圖透過 `disabled: !!js ...` 有條件地啟用檔案系統外掛程式，但 Cordis 僅在外掛程式 `config` 內部對 JavaScript 運算式求值。原始的運算式對象為 truthy，因此檔案系統棧始終處於停用狀態。快照刷新隨後將 `UNKNOWN_TOOL` 結果接受為新的預期輸出。修復方案改用顯式的檔案系統 overlay，並增加了靜態設定守衛和快照結果守衛。

## 概述

預設的 ACP 組合有意只啟用 bash，因為其沙盒無法約束行程內的檔案系統提供方。檔案系統快照場景仍然需要 `read`、`write` 和 `edit`，因此這些外掛程式被放在預設的 `cordis.yml` 中，並附帶一個 `disabled` 運算式，意圖僅在全權限啟動和快照模式下啟用它們。

Cordis Include 將每個 `!!js` 標量解析為一個運算式對象。Loader 遞迴地對外掛程式的 `config` 進行插值，但直接讀取 `disabled` 等設定項中繼資料。因此每個檔案系統設定項看到的都是一個 truthy 對象，在所有模式下均保持停用。

## 影響

七個檔案系統場景和一個混合工作區編輯場景呼叫了登錄檔中不存在的工具。其結構化工作階段日誌攜帶 `ToolNotFoundError`（code 為 `UNKNOWN_TOOL`），stdout 算繪出通用的失敗工具卡片。快照套件透過了，因為結構化工作階段日誌和 stdout 算繪出的通用失敗工具卡片均與刷新後的 fixture（測試前置資料）匹配；它證明的是回歸的確定性重播，而非檔案系統行為的正確性。

實際執行的受限預設模式並未獲得意外的檔案系統訪問權限。草率地直接修復插值反而會帶來這一風險：權限預設在執行時期更新 bash 沙盒和審批狀態，但無法掛載、解除安裝或約束檔案系統棧。

## 時間線

- PR（Pull Request） #261 整合了 ACP 組合並刷新了檔案系統快照，同時引入了條件式檔案系統設定項。
- 所有單元測試、覆蓋率、快照、文件、建置和 hygiene 檢查均透過。
- 對刷新後的檔案系統預期輸出的評審發現了通用的失敗卡片和結構化的 `UNKNOWN_TOOL` 結果。
- 一次真實的 Loader 啟動確認：每個 `disabled` 值仍為運算式對象，每個檔案系統 fiber 均未建立。

## 根因

實作時假設 `!!js` 適用於整個 Loader 設定項。實際只有 `entry.options.config` 使用它：`Entry._resolveConfig()` 對該欄位進行插值，而 `Entry.disabled` 直接測試 `entry.options.disabled`，不經過插值。YAML 標籤在文法上合法，因此載入程序不產生任何診斷資訊。

快照框架將任何確定性的 transcript（文字記錄）視為有效行為。Header pin 驗證了組合後的工具 schema，但檔案系統場景共享來自預設組合的 pin，因此未獨立證明其所需工具已註冊。刷新在任何語義斷言拒絕缺失工具之前，就已重寫了預期的 stdout 和工作階段日誌。

## 已新增的防護措施

- 檔案系統場景啟動 `fs.cordis.yml`：一個顯式的固定全權限 overlay，配有對應的重播設定和獨立的 request-header 類。
- [`AGENTS.md`](../../AGENTS.md) 與 [Cordis 入門](../cordis-primer.md#loader-configuration)明確說明 `!!js` 僅在外掛程式 `config` 內有效，條件式組合應使用 overlay。
- `verify-cordis-config` 解析倉庫中的 Cordis YAML，拒絕 Loader 設定項中繼資料中的運算式節點（包括 include patch 和插入的設定項）。
- `dsh-acp-snapshot` 在全新執行和已提交的工作階段 fixture 中拒絕結構化的 `UNKNOWN_TOOL` 結果，防止其被提交為預期輸出。

## 教訓

- 文法上被接受的設定值不一定在該位置被求值；應記錄並驗證具體對哪些欄位進行插值。
- 快照刷新是 fixture 的生產程序，不是正確性審查。諸如已註冊工具缺失這類語義上不可能的結果，需要獨立於預期輸出的斷言。
- 權限控制只應描述其實際管轄的能力。組合時的檔案系統訪問無法安全地跟隨執行時期的 bash-only 預設。
