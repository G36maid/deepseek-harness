# Agent Note: 在建置 Windows 沙盒啟動器之前先評估 landstrip

Status: rejected — landstrip 未經實戰檢驗（駁回時問世僅數天，只有一名維護者，GitHub 星標約 48 個）；關係到安全不變數的相依性必須經過廣泛採用的驗證，因此 win32 層級維持自研啟動器的原計畫

[English](2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.md) | [简体中文](2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.zh.md) | 繁體中文

## 問題

[沙盒決策](../../implemented/feature/2026-07-06-sandbox.md)將 `PLATFORM_CHAINS.win32` 留空，並計畫用「AppContainer/受限權杖（restricted-token）家族的一個約束執行器，按 `node-addon-landlock-run` 範本從其獨立倉庫發布」來填充——一個估計約 1,500 行、需要自研編寫並維護的新倉庫（landlock-run 子樹約為 1,460 行 C／TS／指令碼／測試，外加文件與 CI）。

自那份決策記錄寫成以來，出現了一個持續維護的第三方執行器：`@landstrip/landstrip`（npm 包，活躍開發中，Rust 核心，附帶按平臺預建置的 `optionalDependencies`）覆蓋 Linux 上的 Landlock + seccomp、macOS 上的 Seatbelt，以及 Windows 上的 AppContainer/受限使用者，支持 JSON／YAML 策略輸入和基於 trap-fd 的拒絕上報通道。它與 bwrap 一樣採用 exec 包裝方式，因此無需觸碰 Linux/macOS 層級即可契合鏈的 `confine(argv)` 形態。

## 提案

當 Windows 沙盒階段啟動時，在動手編寫自研 AppContainer 啟動器倉庫之前，先評估將 landstrip 的 Windows 後端包裝為 `win32` 鏈執行器。評估必須回答：

- **探測合成。** landstrip 沒有 `--probe`；鏈所要求的功能探測約定必須從一次 trap 執行中合成出來。
- **方言對映。** 拒絕與執行器失敗兩類 stderr 方言，以及失敗關閉的退出碼分類，都需要顯式對映到鏈的詞彙中。
- **授權條款。** 其二進位檔案採用 LGPL-2.1-or-later 許可；在進入隨產品發布的相依性閉包之前需要先做分發審查。
- **原始碼與建置記錄。** 每個自研啟動器二進位都逐位元組鎖定到一個約 300 行、可完整評審的 C 文件的原生 CI 建置；而 landstrip 是單一維護者手中的一組 Rust 二進位檔案。對*既有的 Linux 層級*而言，這筆權衡早有定論——不要替換它（見[沙盒 Agent Note](../../implemented/feature/2026-07-06-sandbox.md)以及該啟動器自身移除 Rust 相依性的遷移記錄）。而對一個我們尚未建置的層級，在第三方維護與第二個自研原生倉庫之間如何取捨，是一個真正懸而未決的問題。

## 曾考慮的替代方案

- **按原計畫建置自研 AppContainer 啟動器。** 若評估在授權條款、原始碼／建置可審計性或探測契合度上不透過，這仍是預設選項；代價是要長期維護第二個原生安全啟動器倉庫。
- **把 Linux Landlock 層級也換成 landstrip。** 直接否決：沙盒正確性是安全不變數，當前啟動器有可審閱的 C 原始碼，其二進位逐位元組鎖定到原生 CI 建置，而且它正是出於這一原因才遷移擺脫了 Rust 相依性。

## 驗收標準

- 在任何 Windows 層級實作開始之前，先有一份評估記錄下探測、方言、授權條款、原始碼倉庫、發布流程和二進位建置問題的答案，並把「採用／不採用」（go/no-go）結論加入沙盒 Agent Note 的延後階段計畫。

## 風險

- 處於安全關鍵位置的單一維護者供應鏈——這正是本提案定為一道評估閘門、而非採用決定的原因。
- 該包尚且年輕；在 Windows 階段啟動之前其 API 與打包方式可能反覆變動，屆時需對照線上登錄檔重新核驗。
