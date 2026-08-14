# native/

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

與 DeepSeek Harness 一同維護的原生原始碼和公開包。[`landlock-run/` workspace](landlock-run/README.md) 負責 harness 使用的 Landlock 自限後執行啟動器，包括其架構、由三個包組成的 npm 包家族、平臺支援、開發工作流程和[發布流程](landlock-run/docs/release.md)。

## Workspace 與發布邊界

`landlock-run/` 及其包屬於倉庫根 pnpm workspace，並共用根鎖定檔。開發和 CI 中的 harness 消費端直接使用當前 workspace 的入口包，因此啟動器約定變更與消費端更新可以在同一個改動中落地並一起測試。

主倉庫的 `Landlock Run` 工作流程為每個受支援架構建置並測試。`Landlock Run Release` 匯集這些原生產物，打包並驗證三個 npm tarball，隨後選填擇以同一個啟動器版本發布。入口包繼續將平臺包聲明為 npm 選填相依性，因此 npm 仍然只會安裝與使用者作業系統和 CPU 匹配的包。
