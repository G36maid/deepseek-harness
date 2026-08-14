# Agent Note: 配接器持有的推理強度能力

Status: implemented

[English](2026-07-24-adapter-owned-reasoning-effort-capabilities.md) | [简体中文](2026-07-24-adapter-owned-reasoning-effort-capabilities.zh.md) | 繁體中文

## 問題

推理強度過去只能在配接器中設定，因此對話無法在多次請求之間發現或更改所選模型支持的等級。若將某個配接器的等級聯合類型提升到 `dsh-llm`，所有提供方和模型都必須採用一套自身可能並不支持的名稱；若改用提供方特有的 options 對象，agent loop（代理循環）又無法校驗最終生效的請求，也無法透過持久化記錄準確重建該請求。

## 決策

`dsh-llm` 使用不透明的品牌類型 `ReasoningEffortId` 表示推理強度。由配接器持有的單次 `resolveModel(provider, model, signal?)` 查詢返回 `LlmResolvedModelInfo`，其中包含確切模型身份以及選填的上下文和推理元資料。`LlmRuntime.resolveModelInfo()` 會校驗該聚合結果，並返回與配接器內部狀態分離的值副本。`reasoning.efforts` 存在時，是包含展示元資料的非空有序 ID 清單，並可指定一個由設定確定的預設值。核心要求顯式指定或設定指定的推理強度與清單中的某個 ID 完全一致，且絕不自動調整或為值提供別名。

`LlmCallConfig` 和 `GenerateOptions` 攜帶選填的推理強度。agent loop 在活躍輪次訊號的控制下準備 `agent/request` 處理完成後的設定，再寫入 `request/header`，因此預設值和動態變更只有成為持久化事實後才對模型可見。準備完成的呼叫在非同步確切模型解析、請求標頭持久記錄和分派全程保留同一項確切的配接器註冊；直接呼叫 `LlmRuntime.stream()` 時，也會在等待解析前捕獲最終的配接器註冊。沒有已註冊配接器的路由會保留原定設定，使 `llm/stream` 中介軟體可以接管並短路該請求；若仍未得到處理，最終分發會拒絕該路由。復原後的 agent loop 僅在初始提供方/模型路由未變時保留日誌中記錄的推理強度；如果路由發生變化，則丟棄上一模型的不透明 ID。

當部署策略允許思考時，原生 DeepSeek 配接器聲明 `off`、`high` 和 `max`，默認使用設定指定的推理強度，若未設定則使用 `high`。由配接器持有的 `off` 對映為 `thinking.type: disabled`，且不帶 `reasoning_effort`；`high` 和 `max` 會啟用思考並攜帶各自的官方協議強度值。設定為 `thinking: disabled` 的部署僅聲明 `off`，並會在提供方 I/O 前拒絕啟用思考的嘗試。pi-ai 配接器原樣發布每個確切模型的 `getSupportedThinkingLevels()` 結果，其中包括 `off`；profile 未指定預設值時保留提供方默認行為，並將提供方協議值的對映留在 pi-ai 內部。按照 pi-ai 自身 API 的要求，其通用流選項透過省略 `reasoning` 來表示 `off`。

## 備選方案

**在覈心中定義 pi-ai 的 `ThinkingLevel` 聯合類型。** 不予採納：pi-ai 當前的規範名稱屬於配接器實作細節；未來的提供方可以暴露不同的識別符號，而無需為此發布新的核心版本。

**攜帶無類型約束的提供方 options 對象。** 不予採納：agent loop 既無法校驗選定值，也無法在請求標頭中寫入穩定且與提供方無關的事實。

**自動調整不支持的等級。** 不予採納：靜默替換會導致使用者選定的控制項與日誌記錄的請求意圖不一致，還會掩蓋過時的部署設定。

**將每個配接器規範化為核心持有的等級清單，或移除 `off`。** 不予採納：選填值集合屬於確切模型的能力。用戶端可以渲染某個配接器的 `off` 選項，而無需要求所有配接器都暴露該選項。

## 影響

用戶端只需查詢一次確切路由，即可渲染其身份、上下文容量和由配接器持有的推理選項，而無需瞭解全域性枚舉或自行合成 `off`。配接器設定仍是部署預設值和策略的歸屬方，`agent/request` 則可以在該策略範圍內為每個步驟替換實際生效的推理強度。確切身份、上下文或推理元資料無效時，分別拋出 `INVALID_MODEL_INFO`、`INVALID_MODEL_CONTEXT` 或 `INVALID_MODEL_REASONING`；顯式指定或設定指定的值不受支持時，會在提供方 I/O 前拋出 `UNSUPPORTED_REASONING_EFFORT`。

確切模型元資料的聚合查詢採用非同步方式，並且對於由權威目錄支持的配接器可能失敗。選填訊號構成呼叫方的取消邊界；非同步配接器必須在訊號中止後迅速完成結帳，使 agent loop 的資源釋放達到完全靜止。無金鑰的服務、配接器、agent loop、工作階段和請求標頭測試為校驗、預設值解析、動態變更、日誌記錄、復原行為、HMR（熱模組替換）期間的註冊所有權和取消提供回歸保障；可執行快照鎖定實際組裝請求標頭中的已解析推理強度，僅在有金鑰時執行的配接器測試則覆蓋提供方序列化。
