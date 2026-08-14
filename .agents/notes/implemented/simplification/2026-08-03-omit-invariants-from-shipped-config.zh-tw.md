# Agent Note: 從交付的 dsh 設定中省略執行時期不變式

Status: implemented

[English](2026-08-03-omit-invariants-from-shipped-config.md) | [简体中文](2026-08-03-omit-invariants-from-shipped-config.zh.md) | 繁體中文

## 問題

`@deepseek-ai/dsh-invariants` 與各包擁有的 `./invariant` 伴隨外掛程式是選填的開發診斷。交付的 TUI 掛載了該服務和四個有狀態伴隨外掛程式，而交付的 Web 設定樹省略了這些條目，導致兩個產品 surface 的診斷成本和失敗行為不同。即使始終啟用的產品邊界仍負責工作階段驗證與不可變歷史，關係斷言失敗也可能終止普通的 TUI 執行。

## 決策

`apps/cli/config/` 下交付的 `dsh` 設定樹既不掛載 `@deepseek-ai/dsh-invariants`，也不掛載任何包擁有的 `./invariant` 伴隨外掛程式。因此，CLI 包不再直接相依性不變式服務。

不變式支持仍可供聚焦測試、示例組合包、生成的 SDK 組合，以及顯式選擇診斷的自訂部署使用。工作階段驗證、快照、凍結和來源事件引用驗證始終啟用，且不相依性選填服務，具體由[源端擁有的不可變性決策](../architecture/2026-06-11-dev-invariants-over-deep-readonly.md)規定。

建置後 CLI 的設定轉儲測試會檢查兩個交付的 surface，並阻斷服務條目或任何 `@deepseek-ai/dsh-*/invariant` 條目。

## 已考慮的替代方案

- **掛載服務並設定 `enabled: false`。** 不予採納，因為交付的設定樹和 CLI 相依性仍會攜帶不安裝任何檢查的診斷。
- **保留僅由 TUI 掛載的方案。** 不予採納，因為兩個交付的 surface 仍會保留不同的診斷和失敗行為。
- **從倉庫中移除不變式支持。** 不予採納，因為包擁有的檢查在測試、示例、生成的 SDK 及顯式開發組閤中仍然有用；只有默認產品設定不在其範圍內。

## 後果

- 普通的 `dsh` TUI 與 Web 執行不安裝不變式監聽器或 trace 狀態，也不會因 `InvariantError` 失敗。
- 開發和自訂組合仍可顯式使用不變式服務及伴隨外掛程式。
- 建置後 CLI 的組合輸出會驗證兩個 surface 的交付設定中均不存在這些條目。
- 始終啟用的工作階段完整性保持不變。
