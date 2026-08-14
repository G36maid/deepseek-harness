# Agent Note: 架構一致性——相依性規則與配接器套件

Status: proposed

[English](2026-06-11-architectural-conformance.md) | [简体中文](2026-06-11-architectural-conformance.zh.md) | 繁體中文

## 問題

目前有兩項架構保證僅存在於行文中：（1）沒有任何元件相依性具體的 agent loop（代理循環）包（[微核心承諾](../../implemented/architecture/2026-06-11-microkernel-event-taxonomy.md)）；（2）每個 LlmAdapter 都正確遵循區塊協議。二者都應由機制強制執行（[品質閘門原則](../../implemented/process/2026-06-11-quality-gates.md)）。

## 提案

**dependency-cruiser** 配合以下規則：

- `packages/*`（除 agent-loop 自身的測試和 examples/ 外）禁止匯入 `@deepseek-ai/dsh-agent-loop`。
- 禁止跨包深層匯入（`@deepseek-ai/dsh-*/src/...` 路徑）——只允許使用公開入口點。
- packages/ 內禁止出現迴圈相依性。
- `vendor/*` 禁止從 `packages/*` 匯入。
- 分層：dsh-llm 不匯入其他 dsh 包；dsh-session 僅匯入 dsh-llm；以此類推（packages/README.md 中的相依性表，強制執行）。

**配接器一致性套件**位於 dsh-llm（`@deepseek-ai/dsh-llm/conformance`）：一個以配接器工廠為參數的可複用 vitest 套件，用於斷言區塊協議約定，包括每個塊內的索引單調遞增、某個索引出現 `block-end` 後不再接收增量、恰好出現一個 `finish`、用量至多出現一次、每個 `tool-call-delta` 都攜帶呼叫 id，並且及時回應 abort。當前先對 mock 執行；DeepSeek V4 配接器從第一天起繼承該套件。還可以選擇提供開發模式下的 `strictAdapter()` 包裝層，在除錯標志開啟時於執行時期強制執行相同規則（與 [開發模式不變式](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md) 配對）。

## 計畫

先落地 dependency-cruiser 設定與 CI 步驟（約一小時工作量，換來永久保證）；一致性套件隨其首個消費端測試（針對 MockAdapter）一起落地，並作為 V4 配接器階段的前置條件。

## 驗收標準

- dependency-cruiser 在 CI 中執行上述規則族；違規匯入導致建置失敗。
- 一致性套件對 mock 配接器和兩個正式配接器執行，新配接器包透過呼叫該套件並傳入自己的工廠即可繼承測試。

## 風險

隨著包的增加，dep-cruiser 規則需要維護——規則應基於模式（`dsh-*`）而非逐一枚舉。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
