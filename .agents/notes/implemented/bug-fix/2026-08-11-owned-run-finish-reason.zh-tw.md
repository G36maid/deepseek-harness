# Agent Note: 自有執行的結束原因報告

Status: implemented

[English](2026-08-11-owned-run-finish-reason.md) | [简体中文](2026-08-11-owned-run-finish-reason.zh.md) | 繁體中文

## 問題

Python SDK 消費端需要簡潔地判斷自有活動區間如何進入 idle。要求每個消費端掃描原始 `turn/end` 事件會重複協議知識，而通用的成功狀態會丟失 token 上限與模型錯誤之間的區別。

## 決策

`RunResult.finish_reason` 是從已提交訊息進入持久 inbox 的回執開始、到整個 agent 下一次進入 idle 為止所收集的根工作階段最後一個 `turn/end` 的字串 `kind`。如果該區間沒有 `turn/end`，欄位為 `None`。缺少字串 `data.reason.kind` 的 `turn/end` 會拋出 `SdkProtocolError`，而不會報告為區間內沒有輪次結束。該欄位描述自有執行區間；它不會把這個結束原因歸屬於已提交的提示詞。[自有執行邊界決策](../architecture/2026-07-30-followup-enqueue-and-owned-runs.md)仍禁止提示詞級結果歸因。

該欄位只公開 kind，因為呼叫方需要穩定的分類，完整的結構化原因仍可從 `RunResult.events` 取得。傳輸丟失、逾時和協議故障仍會拋出例外，而不會生成結束原因。

## 考慮過的替代方案

**復原 `status`。** 由部署對映的 `ok` 或 `error` 狀態會混淆不同的持久結束情況，而且看起來像傳輸成功狀態，因此無法回答區間為何結束。

**公開模型 `FinishReason`。** 一次執行可能包含多個模型步驟，中間的 `tool-calls` 結束並不代表執行結束。agent 最後一個 `turn/end` 纔是相關的執行級觀測。

**將欄位命名為 `stop_reason`。** ACP 和 subagent seam 會把輪次結束原因對映到各自的 `stopReason` 取值集合。Python 欄位保留原始的 agent 原因 kind，因此沿用它們的名稱會讓人誤以為該介面也執行了這種對映。

**公開完整的結構化輪次原因。** 原始事件串流已經保留錯誤與取消的詳細資訊。在 `RunResult` 上複製這個對象會產生兩種需要 Python 呼叫方協調的表示。

## 驗證

Python SDK 測試覆蓋選擇最後一個輪次結束、區間內沒有輪次結束，以及拒絕畸形輪次結束原因。SDK README 記錄欄位取值、`None` 情況、失敗行為和執行級範圍。

## 後果

呼叫方無需解析事件清單，即可按 `completed`、`max-tokens`、`error` 和未來的原因 kind 分支。該欄位可能描述區間內加入的 steering、注入上下文或排隊工作，因此不能將其表述為初始提示詞的因果結果。倉庫內的 TypeScript SDK 只透過類型化事件提供結束原因觀測；其呼叫方可以直接從 `SessionEvent[]` 讀取該觀測。
