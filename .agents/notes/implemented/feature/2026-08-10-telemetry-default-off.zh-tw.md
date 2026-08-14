# Agent Note: 遙測必須顯式啟用

Status: implemented

[English](2026-08-10-telemetry-default-off.md) | [简体中文](2026-08-10-telemetry-default-off.zh.md) | 繁體中文

## 問題

DeepSeek Harness 有兩路出站遙測資料流。在內測階段，共享基礎設定掛載了帶內建生產 endpoint 的遙測，兩路資料流默認上報以幫助診斷上報的問題：工作階段 OTel 後端在省略 `mode` 時可能匯出完整工作階段內容、工具資料、提示詞和工作區路徑，而 dsh-sdk 啟動器資料流則無條件外發。因此，全新安裝無需部署方明確選擇便允許向外上報。

## 決策

兩路資料流都使用 `DSH_TELEMETRY_MODE` 作為正向授權設定。未設定和空值都解析為 `DISABLED`。`@deepseek-ai/dsh-session-telemetry-otel` 也將省略的 `mode` 解析為 `DISABLED`；該模式不構造 OTel 提供方、處理器或匯出器，並將回饋留在本機工作階段日誌中。dsh 共享基礎設定繼續掛載後端設定行，使停用模式仍可在記錄回饋時說明沒有共享任何內容。部署方透過 `FULL` 或 `FEEDBACK_ONLY` 顯式啟用 Session Log 共享；只有 `FULL` 還允許 dsh-sdk 啟動器上報。任何非空 `DSH_TELEMETRY_DISABLED` 仍是具有最高優先級的載入前硬性退出開關。[默認掛載決策](2026-07-31-web-telemetry-default-mount.md)繼續負責 endpoint、批次處理節奏和退出排空設定。

dsh-sdk 啟動器讀取同一變數，不解析 `cordis.yml`，也不啟動 Cordis。`FULL` 允許上報；`FEEDBACK_ONLY`、`DISABLED`、未設定和空值都會拒絕。授權在命令執行前從啟動環境凍結：`dsh-sdk start` 會載入項目 `.env`，項目程式碼也能修改 `process.env`，若在執行後解析，項目便能自行授權上報其自身設定，而[設定來源所有權決策](../architecture/2026-08-04-configuration-source-ownership.md)對整個 `DSH_*` 命名空間禁止這種行為。在該邊界上，不受支持的模式按拒絕處理而非拋出，因為遙測不得改變命令結果。此規則在啟動器及其提案被[SDK 項目工具鏈移除決策](../simplification/2026-08-11-remove-sdk-project-toolchain.md)刪除之前，僅取代了啟動器默認允許上報的規則。

[CLI reference README](../../../../apps/cli/reference/README.md) 記錄了這一部署口徑：工作階段日誌上傳預設關閉，`DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 和 `DSH_TELEMETRY_MODE=FULL` 是兩種顯式啟用選項，顯式開啟後的匯出可能包含完整工作階段內容。復原後的[測試階段引導聲明](2026-08-13-shared-modal-product-onboarding.md)不包含遙測文案，因此產品仍不提供任何關於開啟上傳的提示。

## 考慮過的替代方案

**保留默認退出機制並改進披露。** 不採用：披露不能讓缺少設定構成傳送資料的明確授權，尤其是工作階段遙測可能包含完整的本機內容。

**將工作階段遙測默認設為 `FEEDBACK_ONLY`。** 不採用：即使部署方沒有顯式啟用向外上報，記錄回饋仍會觸發上傳。預設值必須讓工作階段及其回饋都留在本機。

**新增項目級授權標記。** 不採用：`DSH_TELEMETRY_MODE` 已能表達兩路資料流的授權；另一個設定項會產生衝突設定，並需要啟動器專用的解析邏輯。

**刪除兩種遙測實作。** 不採用：內部部署仍需要顯式啟用 `FULL` 與回饋觸發的上報；在 `FULL` 下，啟動器資料流也仍有用。

## 後果

全新 profile 和項目不寄出任何遙測網路請求。內部部署為兩路資料流選擇一個模式：`FEEDBACK_ONLY` 只允許由回饋觸發的 Session Log 共享，`FULL` 還會啟用啟動器上報。現有硬性退出繼續生效，上傳模式也保留 endpoint 校驗、脫敏責任、批次處理和關閉行為。
