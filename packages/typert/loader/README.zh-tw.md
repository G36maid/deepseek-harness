# @deepseek-ai/dsh-typert-loader

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

生成的 Typert 產物所用的 Loader 整合，僅支援 Node。該外掛程式需要 `ctx.loader` 和 `ctx.typert`；它本身不提供登錄檔。

啟用時，該外掛程式會掃描現有的 Loader 設定項。隨後它會監聽 Cordis `internal/plugin` 生命週期通知，解析每個設定項所屬包的 `package.json`，在其匯出 `./typert` 時匯入該子路徑，校驗其 `TYPERT` manifest（中繼資料清單），並註冊該貢獻項，直到設定項或本外掛程式解除安裝。如果匯入操作在設定項或本外掛程式解除安裝後才結束，系統會丟棄其結果。

`packages` 用於列出需要為巢狀在另一 Loader 設定項下的外掛程式額外註冊的包產物。Cordis fiber 不會保留這些巢狀外掛程式的 npm 包說明符，因此這裡透過顯式設定劃定邊界；設定中列出的每個包都必須能從設定樹解析，並匯出 `./typert`。

未匯出該子路徑的包會被跳過。包解析結果和已匯入的 manifest 會在整個行程生命週期內快取，因此新增該匯出後必須重新啟動行程。外掛程式啟用時，如果已掛載 Loader 設定項對應的產物格式錯誤，啟用會失敗；之後才發生的失敗只會記錄到日誌，不會阻止無關包完成註冊。

## 模型體驗

無。loader 只向 [`ctx.typert`](../registry/README.md) 提供註冊項；任何模型可見投影均由消費端負責。

#### KV Cache 影響

無直接影響。

## 已知限制與暫緩事項

- 發現機制只會匯入宿主側產物；若要為用戶端執行時期新增等價的發現機制，需要先有獨立的組合所有者。
- Loader 設定項會自動發現。巢狀外掛程式或非 Loader 外掛程式需要顯式加入 `packages`，或由其所有者直接負責呼叫 `ctx.typert.register()`。
