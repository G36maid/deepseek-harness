# Agent Note: 聊天流展示 max-tokens 結束的輪次

Status: implemented

[English](2026-08-12-max-tokens-turn-end-notice.md) | [简体中文](2026-08-12-max-tokens-turn-end-notice.zh.md) | 繁體中文

## Problem

agent loop 已把 `max-tokens` 記錄為獨立的 `turn/end` 原因，但沒有任何使用者表面消費它。Web 聊天流中只有 `reason.kind === 'error'` 會生成工作階段節點，unknown-surface 兜底又只接管 append-surface 事件，於是被提供方在輸出上限處截斷的輪次沒有任何可見跡象：被截斷的回答看起來和正常完成一樣，使用者無從得知執行為何停止（issue #1522）。

## Decision

新增 `turn-max-tokens` 工作階段節點 Definition，匹配 `reason.kind === 'max-tokens'` 的 `turn/end`，在該輪位置生成一條持久聊天行：warning 狀態的 StateDot、本機化標題，以及說明已截斷輸出會保留、傳送“繼續”可在新一輪接著輸出的指引。節點只從持久工作階段事件推導，因此刷新、復原和歷史重播會重建出完全一致的結果。提示不顯示任何 token 數字：事件本身不攜帶數量，提示也不得偽造提供方未報告的預算資料。

渲染器與其他聊天行一樣註冊在按 kind 分發的 `conversation.chat.node` 槽位下，legacy chat-snapshot 投影也包含該節點。fixture 歷史新增了一個 max-tokens 樣本輪（72，圖片輪和 todo 輪順移為 73、74），並有一條 assembled keyless snapshot 釘住圓點狀態、標題和指引文案，把 max-tokens 路由回錯誤樣式或再次靜默的回歸都會改動 golden。

## Alternatives considered

**在 `turn-error` 上加一個 max-tokens 分支** — 否決：issue #1522 的驗收要求 max-tokens 不得呈現為普通 provider error；共用節點會耦合兩種呈現，且兩種原因攜帶的資料不同（一個有錯誤負載，一個沒有）。

**用 turn-tail 標記代替獨立聊天行** — 否決：turn-tail 渲染的是完成輪次的收尾資訊，其操作會在後續輪次摺疊，而截斷提示必須停留在被截斷的那一輪，並且在歷史中無需互動即可看到。

**在提示上放繼續或重試按鈕** — 暫緩：復原輸出的語義尚未確定（新開一輪還是同輪續寫、舊輸出保留規則），issue #1522 明確把它排除在範圍外；指引文字已給出安全的下一步，不必先固定一個操作契約。

## Consequences

max-tokens 結束在即時流、刷新和重播中都可見、已本機化，並與錯誤和正常完成明確區分。fixture 重編號需要更新兩處相依性 snapshot 的註釋，之後釘 fixture 輪次號的改動要按新版面配置計數。Web 聊天流之外的表面（ACP 和 SDK 消費端）仍按各自的呈現對映該原因，本次不變。
