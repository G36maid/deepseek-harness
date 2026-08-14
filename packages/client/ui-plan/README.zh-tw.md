# @deepseek-ai/dsh-client-ui-plan

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Plan mode 狀態徽章，純瀏覽器 surface 外掛程式。瀏覽器側佔用工作階段聲明的 `conversation.input.plan` 單實例 seat（位於 access 模式控制元件右側）；node 側是空 apply（roster 行）。plan 行為本身——`/plan` 命令、邊界或空閒即時提交的 `plan/mode` 狀態、`plan` 投影單元與 policy 段——歸 [`@deepseek-ai/dsh-plan-mode`](../../plan/plan-mode/README.md) 所有，由 host roster 獨立組合。

plan mode 經 `/plan` 命令路徑進入：使用者可以從 composer 的 `+` Command 選單選擇 Plan，也可以輸入 `/plan`，而本包不渲染未啟用態 plan 控制元件。當 host 計算的 `plan` 投影有效目標為 plan mode 時（`pending ? !active : active`——摺疊的 host 值而非用戶端樂觀態，幀到達即自動糾正），座位渲染 warn 色的 "Plan ×" 狀態按鈕，該按鈕經 `command.execute` 執行 `/plan off`；否則座位保持為空——未組合 plan-mode 的 host（或尚無工作階段的 Draft）不顯示任何內容。plan mode 為有效目標期間，composer 文字方塊的 placeholder 切換為 plan 任務提示——"describe your task to generate plan"（中文「描述你的任務以生成計畫」），經 ui-conversation 的 `conversation` locale 命名空間（`placeholder.plan` / `hint.plan` 鍵）本機化，並與已認領 `/plan` 命令的提示逐字共用同一份文案（由 composer 從同一投影渲染；owner 提供的 placeholder 優先）。

chip 攜帶無障礙描述 "Plan mode on, press to turn off"。准入失敗（`matched: false`、業務錯誤、傳輸故障）以內聯錯誤呈現，chip 保持顯示直至投影確認退出。

模型透過穩定的 `exit_plan_mode` 工具退出 plan mode；其 plan 評審走已組合的 Web question 通道。

## 模型體驗

間接地，透過 chip 派發的 `/plan off` 命令列：`@deepseek-ai/dsh-plan-mode` 擁有該命令列驅動的模型可見 policy 段、退出工具 schema 與已記錄狀態，本包只渲染投影並行送使用者同樣可以手敲的內容。

#### KV Cache 影響

進入或離開 plan mode 會改變活躍的 `plan:policy` 系統提示詞段，因此改變請求前綴；chip 本身不新增任何提示詞內容。

## 已知侷限與延後工作

- **Plan mode 是引導而非執行沙盒**：需要強制只讀規劃的部署必須組合獨立的沙盒與審批策略。
- **chip 屬於默認編輯器**：待處理的整編輯器互動（如 plan 評審）會臨時取代 InputBar 及其 chip。
- **無未啟用態 plan 控制元件**——入口使用共享 Command source；有能力但 mode 未啟用的工作階段在工具行不顯示 plan 入口。
