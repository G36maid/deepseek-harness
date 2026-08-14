# Agent Note: Web skill 工具行

Status: implemented

[English](2026-08-06-web-skill-tool-row.md) | [简体中文](2026-08-06-web-skill-tool-row.zh.md) | 繁體中文

## 問題

Web transcript（文字記錄）透過通用後備行渲染 `skill` 呼叫，使已載入的指令集看起來像一次未知工具呼叫，儘管 Skill（技能）已是產品中的一等概念。通用行還會在結果旁暴露 JSON 參數的外層結構，圍繞使用者真正需要的唯一標識增加了噪聲：已載入的 skill 名稱。

## 決策

`ui-skill` 在 ui-tool 的 `tool.call.toolview` keyed slot 下註冊 key 為 `skill` 的元件。該元件消費公開的 `ToolCallViewProps` owner 約定，並自行實作行 chrome，不匯入 ui-tool 的展示內部實作。

收起的行使用 14 畫素的文件與閃光組合圖示，並沿用 Bash 行的中性色層級：圖示採用三級色，`Skill` 標題採用二級色，分隔符採用 caption 色，skill 名稱採用三級色。執行、失敗和中斷呼叫分別沿用 transcript 的掃光、錯誤狀態點加首行摘要，以及警告狀態點語義。已結帳呼叫可以透過整個摘要行展開一個高度上限為 260 畫素的 `Instructions` 卡片，其中原樣呈現持久化結果文字；用於跳轉至 trajectory 的現有 `Inspect` 入口仍保留在卡片下方。

該行的所有可見值均派生自當前 runtime 視窗中已配對的呼叫／結果片段。skill 名稱來自已記錄的 `name` 參數，指令來自持久化的結果內容；該行絕不關聯當前 skill 目錄來讀取描述或提供方元資料。如果分頁將呼叫留在視窗外，結果便沒有工具身份，並繼續使用通用後備路徑，而不是擴充 history 協議約定。現有的 ACP（Agent Client Protocol）`skill-load` 記錄經由真實的 Web 持久化與組合路徑寫入，用於無需金鑰的互動和無障礙快照。

## 考慮過的替代方案

- 保留通用工具行，只新增一個 `skill` 顏色選擇器，並將其放在 `ui-conversation` 中。該方案仍會保留多餘的輸入外層結構和通用展開體，也會讓 conversation 包擁有特定領域的視覺規則。
- 在宿主工具渲染意圖聯合類型中新增新的 `skill` 值。鍵控用戶端 slot 在呼叫位於 runtime 視窗內時已經能夠識別該工具，因此新的跨邊界呈現值只會增加協議和快照表層，卻不會支持其他消費端。
- 匯出 conversation 包的私有 `ToolRow` 元件供複用。用戶端包刻意對外暴露約定而非跨包元件；匯出該元件會使獨立功能包耦合到 conversation 的實作細節。

## 後果

除了引用 source 的相依性外，`ui-skill` 現在還相依性公開的 conversation toolview 約定、locale 包、原語包和 React。它自行保留了一小份摺疊展開行 chrome，因此未來的全域性互動變更必須與 Bash 示例和 conversation 行同步更新這個註冊方。

即使已安裝的 skill 目錄發生變化，冷重播仍保持確定性；在使用者顯式展開指令前，transcript 保持緊湊。僅含結果的 history 頁有意使用通用後備路徑；讓這個邊緣情況保持通用呈現，可以保留現有 history 協議，並將該功能限定在用戶端呈現層。專用卡片有意顯示工具完整封裝的輸出，而不是隻提取 `<skill_instructions>`，從而原樣保留模型實際收到的內容，也避免為 skill 結果格式再引入一個解析器。
