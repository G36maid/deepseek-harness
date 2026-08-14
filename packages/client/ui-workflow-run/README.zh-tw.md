# @deepseek-ai/dsh-client-ui-workflow-run

[English](README.md) | 繁體中文

這個瀏覽器外掛程式把持久化的頂層工作流程執行重建為獨立 Chat 節點。它消費由 [`dsh-tool-workflow`](../../workflow/tool-workflow/README.md) 擁有的四類 `tool-workflow/*` Session 事件，註冊一個 `ConversationNodeDefinition`，並透過 keyed `conversation.chat.node` slot 渲染，不改變現有工作流程工具卡。

## 持久狀態與重播

`tool-workflow/run-start` 以 `runId` 建立唯一 Context；成員開始、成員結束和執行結束事件按日誌順序更新該 Context。只有 update 的歷史尾頁會保持 pending，直到更早頁面補入唯一 start；此後 prepend、完整重播和即時 append 得到相同狀態。若所屬 Turn 或 Step 已關閉但終點事件缺失，介面把相應執行或成員顯示為已中斷，而不改寫工具結果。

階段組只來自真正開始過的成員。完全相同的階段字串歸入同一組，欄位預設與空字串保持不同身份；成員結帳只改變狀態，不刪除或重排成員。

## 展示與導覽

執行和每個階段都從當前生命週期事實派生 disclosure 控制。執行自身處於執行中、失敗、已取消或已中斷，或者任一階段包含這些狀態的成員時，執行保持展開；受影響的階段也保持展開。強制展開的標題行只是靜態展開行，不承諾按鈕、鍵盤操作或 `aria-expanded`。階段在全部成員完成時摺疊一次；執行在自身和全部階段都完成時摺疊一次。每個乾淨層級隨後復原普通 disclosure 控制元件，其本機選擇在乾淨狀態的 rerender 中保持；新活動會重新取得控制，remount 則從當前資料派生初始狀態。執行使用 32 畫素 `--dsw-alias-bg-module-platform` 背景行，常駐向右／向下 chevron，並以內聯狀態點加狀態文字表達結局，不使用膠囊。階段使用 32 畫素 disclosure 行，在可伸縮主區顯示標題與成員數，在固定尾部精確顯示聚合狀態且不重複狀態點。成員使用 16 畫素狀態點槽、可省略名稱區和固定 64 畫素狀態列。

只有所有即時事實同時成立時，成員纔可打開子 Session：成員仍在執行、子 id 位於普通 Session 清單、清單行為 `origin: 'subagent'`、`parentId` 等於當前 Session，且清單行仍標記執行。帶底線的成員文字是唯一可見導覽提示；鍵盤聚焦時，名稱區顯示 2 畫素 business-primary 焦點環，右側狀態仍只顯示“執行中”。元件只調用注入的普通 `sessions.open(id)`；遠端、僅地址化、父級不符或終態的行都不可互動。

## 裝配

本包把 Definition、locale 字典和 `workflow-run` renderer 都註冊為 Cordis effect；移除用戶端 entry 會撤銷三者。shipped Web bundle 在 `ui-conversation` 與 `ui-tool` 之後裝配該外掛程式。

## 模型體驗

無，因為本包只為人類展示持久 Session 事實，不增加 prompt、工具 schema、請求內容或模型可見結果。

#### KV Cache effect

無。

## 已知限制與暫緩事項

- 只有經 `dsh-tool-workflow` 發起的頂層呼叫會生成這些記錄；巢狀 Code Mode 呼叫和直接 `WorkflowEngine` 消費端不會生成。
- 導覽刻意只面向即時執行。終態成員繼續保留供復盤，但本節點永不為其提供冷 Session 入口。
- 節點只顯示執行、階段、成員身份與狀態；指令碼、輸出、錯誤、日誌、用量、靜態拓撲和控制操作都不屬於本介面。
