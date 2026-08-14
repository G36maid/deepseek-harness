# @deepseek-ai/dsh-client-ui-message-feedback

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

單則訊息回饋外掛程式的瀏覽器側：一對 Like/Dislike 按鈕加一個選填備注，作為 `conversation.chat.assistant-actions` 條帶的 `feedback` 條目（order 10）貢獻。該條帶由 `ui-conversation` 聲明，渲染在已定稿助手訊息的 IconActions 行內、複製與分支之間，因此控制元件沿用該行的樣式與 hover 行為。只有已定稿的訊息能到達這個 slot——被中斷凍結的部分輸出不帶 `messageId`，因此也沒有回饋控制元件。該操作欄每個 Turn 渲染一次，位於持有該 Turn IconActions 行的收尾助手訊息上：多步驟 Turn 中較早的步驟產出的是工具行而非可評分正文，因此即使 Host 會接受它們作為目標，介面上也不出現控制元件。

每個 Session 一個 `MessageFeedbackController`，支撐該 Session 內所有訊息的控制元件，因此一次 `messageFeedback.list` 讀取即可填充整段對話。該讀取延遲到首次 hover 或 focus 才發起，而不是在掛載時觸發，因為可見歷史中每條已結束的訊息都會掛載一次控制元件。

變更透過 `ctx.remote.messageFeedback` 提交，按條目的 compare-and-set 由 Host 負責。每次 `put` 和 `delete` 都攜帶本 controller 最後觀察到的 `version`；`version-conflict` 回應會帶回權威條目，因此競爭失敗時直接用該回應對帳，無需重新拉取整個 Session。變更按 Session 序列，排隊中的操作總是與已提交的版本比較。再次點擊已記錄的評分會撤回回饋；切換到另一側會保留已有備注。

`/client` 匯出外掛程式本體（`apply`/`inject`）、`MessageFeedbackActions` 元件、`MessageFeedbackController` 類以及注入面類型。

## 模型體驗

無。回饋是 sidecar，不進入 append-only 的 Session 日誌、模型上下文或遙測；任何評分與備注對模型都不可見。

#### KV Cache 影響

無；任何回饋變更都不觸碰歷史尾部。

## 已知限制與暫緩事項

- **備注大小是 Host 策略** —— 部署方設定 `maxNoteBytes`（Web bundle 中為 8192），超長備注由 Host 以 `note-too-large` 拒絕。編輯器不預先校驗該上限，因此超長備注在保存時才失敗，而不是在輸入過程中。
- **無跨分頁標籤推送** —— 另一個分頁標籤的評分要等到重連或下一次衝突回應纔可見，不會立即出現；該 sidecar 不發布即時幀。
- **僅限對話檢視表** —— trajectory 與 waterfall 檢視表不渲染回饋控制元件，儘管它們的助手節點現在也帶有相同的 `messageId`。
