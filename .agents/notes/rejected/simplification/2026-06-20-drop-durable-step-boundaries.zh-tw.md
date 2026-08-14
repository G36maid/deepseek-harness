# Agent Note: 移除持久化的步驟邊界事件

Status: rejected — `step/end` 是模型步驟已完成的持久訊號；保留對稱的 `step/start` / `step/end` 對，比從相鄰的步驟級事件推斷完成狀態更便於理解崩潰修復、不變式與 transcript（文字記錄）檢查。

[English](2026-06-20-drop-durable-step-boundaries.md) | 繁體中文

## 問題

工作階段日誌儲存了 `step/start` 和 `step/end` 事件，儘管每個步驟級事件本身已經攜帶 `{ turn, step }`：assistant 區塊、assistant 訊息、工具呼叫、工具結果、用量和錯誤。`deriveMessages()` 忽略步驟邊界，ACP（Agent Client Protocol）在 UI 層面也忽略它們，主要消費端是不變式檢查、測試、快照預期輸出和當機復原。

被否決的論點是：邊界事件使日誌更像儀式而非資訊。實際上，`step/end` 是具體資訊：讀者無需從下一個事件推導狀態，就能判斷一次模型請求是已完成、已崩潰還是正在修復。同樣，單獨一條 `step/start` 對於「模型請求已發起但在產生任何區塊之前就失敗了」的場景也有價值。

## 提案

將輪次作為唯一的持久化邊界。`step/start` 和 `step/end` 將從 `SessionEventMap` 中移除；在需要分組的事件上保留數值型 `step` 欄位。agent loop（代理循環）遞增步驟計數器並以該編號記錄步驟級事件，但不再追加開始與結束邊界事件。消費端透過共享 `(turn, step)` 的連續事件推斷步驟分組。

不變式外掛程式應當強制步驟級事件在一個已打開的輪次內具有有效的正整數步驟編號，而非要求獨立的邊界記錄包圍它們。當機復原不應合成 `step/end`；如果一個被中斷的輪次被保留，修復路徑仍然可以關閉該輪次而無需捏造步驟邊界記錄。

## 驗收標準

- `SessionEventMap` 不再包含 `step/start` 或 `step/end`。
- agent loop 中不再有 `closeStep()` 終結路徑。
- ACP 快照和持久化約定 fixture（測試前置資料）不再期望步驟邊界行。
- `deriveMessages()` 和重播從步驟級事件推匯出相同的訊息歷史。
- [事件分類體系文件](../../../../docs/architecture.md)將輪次描述為持久化邊界，將步驟描述為步驟級記錄上的一個欄位。
- 工作階段格式版本和已記錄的 fixture 被刷新；按預發布格式策略，非當前版本的已儲存日誌被拒絕。

## 放棄了什麼

日誌不再將「一次模型請求已發起但行程死亡前未產生任何事件」記錄為持久化事實，也不再有顯式的「此步驟已完成」標記。在工作階段日誌仍是持久化重播與審計表面的當下，這一損失不可接受。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
