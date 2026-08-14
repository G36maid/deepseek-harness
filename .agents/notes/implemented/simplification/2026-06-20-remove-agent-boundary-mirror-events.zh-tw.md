# Agent Note: 停止將持久化邊界映像檔為 agent 事件

Status: implemented

[English](2026-06-20-remove-agent-boundary-mirror-events.md) | 繁體中文

## 問題

迴圈在 `SessionEvent` 中記錄規範 transcript（文字記錄），同時還發出一組平行的即時 `agent/*` 邊界映像檔事件：`agent/turn-start`、`agent/turn-end`、`agent/step-start` 和 `agent/step-end`。這些映像檔迫使消費端在同一持久事實的兩個真源之間做選擇。ACP（Agent Client Protocol）已經為提示詞結帳和已提交輸出選擇工作階段日誌，因為它是唯一持久、可重放的記錄；消費即時映像檔需要把它的時序與日誌中已經儲存的邊界進行調和。stdio UI 是唯一仍從映像檔事件渲染輪次邊界的生產環境消費端；它已經從 `session/event` 渲染工具呼叫和工具結果。

這種重複並非零成本。每次生命週期變更都需要同時更新工作階段事件、映像檔事件、文件、不變式、測試和快照預期。重複的邊界事件還使失敗事件的先後關係變得微妙：一個輪次可能在即時 `agent/turn-end` 監聽器執行之前就已被持久化關閉，因此邊界之後的監聽器失敗在日誌中已沒有合法位置可以插入，只能帶外上報。

## 決策

將 `session/event` 作為唯一的即時邊界/transcript 流。需要渲染輪次、工具呼叫、工具結果、助手訊息和持久化邊界的消費端統一訂閱 `session/event`，從持久化層使用的同一套事件詞彙中派生 UI。

四個持久邊界映像檔——`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`——已從 agent（代理）事件分類體系中移除。希望在邊界處取得 agent handle 的 UI 會保留來自 `agent/created`/`agent/disposed` 的即時目標對象，並直接比較其工作階段；`dsh-ui-stdio` 據此為應用擁有的 agent 標記 `[main turn N]` 頭部，其他工作階段則渲染其持久 id。規範記錄仍是事件溯源工作階段日誌。

步驟映像檔（完全沒有消費端）最先在[事件域語義 Agent Note](../architecture/2026-06-30-event-domain-semantics.md) 中移除；該 Agent Note 當時以 stdio UI 需要在輪次邊界取得 `Agent` handle 為由，保留了輪次映像檔。本決策完成餘下工作：`dsh-ui-stdio` 是可隨時丟棄的測試 REPL，其渲染可以自由變化，因此「ui-stdio 需要它」並不是保留映像檔的理由——它讀取 `session/event`，只保留自己的即時目標對象。

## 範圍：移除什麼、不移除什麼

已移除（持久邊界映像檔——每項都以工作階段日誌為權威）：`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`。

保留——不是持久邊界映像檔，因此不在本決策範圍內：

- `agent/steering`——不是邊界，因此不在本決策範圍內。它映像檔持久的 `steering/message` 控制記錄，而非邊界，後來由自己的後續決策移除：[移除 `agent/steering` 映像檔 emit](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md)。
- `agent/stream-chunk`——即時 token 流。不在本決策範圍內（它映像檔持久的 `assistant/chunk`，而非邊界），後來由自己的後續決策移除：[停止將 token 流映像檔為 agent 事件](../../archived/simplification/2026-07-02-remove-stream-chunk-mirror.md)。
- `agent/created`、`agent/disposed`、`agent/status`、`agent/error`、`agent/queued`——不屬於 transcript 資料的生命週期/控制事件。尤其是 `agent/queued`，它是在任何持久事件存在之前觸發的收件箱確認（取消的排隊工作可能永遠不會進入日誌），所以有意只保留為即時事件。

## 曾考慮的替代方案

- **將 `agent/steering` 一並移除**——原始提案的範圍；因超出範圍而被排除：它映像檔持久的 `steering/message` 控制記錄，而非邊界，後來由[自己的決策](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md)移除（`agent/stream-chunk` 也由[流區塊映像檔 Agent Note](../../archived/simplification/2026-07-02-remove-stream-chunk-mirror.md) 移除）。
- **為 stdio UI 保留輪次映像檔**——[事件域語義 Agent Note](../architecture/2026-06-30-event-domain-semantics.md) 的原始立場；在此否決，因為 `dsh-ui-stdio` 是可隨時丟棄的測試 REPL，而非承載關鍵約束的消費端，並且它改為根據 `session/event` 加自己的即時目標對象渲染邊界。

## 後果

外掛程式不能再透過便捷的、以 `Agent` 為首個參數的事件觀察輪次/步驟邊界。它需要訂閱 `session/event`；如果需要即時對象，則透過 `ctx.agents` 尋找共享 id 對應的對象，或保留自己已經擁有的對象。這是可以接受的取捨：邊界消費端不應相依性可能與持久日誌發生漂移的第二個事件源。
