# Agent Note: Ask-question Web 呈現

Status: implemented

[English](2026-07-29-ask-question-web-presentation.md) | 繁體中文

## 問題

Web GUI 已經可以透過 `QuestionComposer` 的輸入區接管收集回答，但其周邊的工作階段記錄呈現在三個方面是錯的。待回答的問題會渲染兩次：一次是輸入區接管，一次是早於接管存在的只讀 `PendingCard` 佔位卡片。已結帳的 `ask_user_question` 呼叫渲染為通用 "Tool call" 行並直接傾倒原始 args JSON，因此兩種輸入區裁決 —— 使用者放棄整組問題（`ASK_CANCELLED`）與問題待回答期間輪次被打斷（`ASK_ABORTED`）—— 都顯示為無名的紅點失敗。而且輸入區自身的介面文案（分頁、按鈕、佔位符、校驗回饋）是硬編碼中文，而周邊用戶端已透過 `dsh-client-locale` 實作雙語。

另外，輸入區視覺也偏離了當前設計：自訂回答需展開才能輸入、多選除尾部對勾外沒有可見標識、分頁掛在頭部、還有從模型文字裡解析 `（可多选）` 標題後綴的約定。

## 決定

一個待回答的問題恰好擁有兩個介面：輸入區接管收集回答，工作階段記錄中一個專門的 `ask_user_question` toolview 行陳述互動結果。該行與 `todo_write` 完全一樣註冊進帶 key 的 `tool.call.toolview` 槽位，並複用共享的 `ToolRow`（外觀、執行掃光、前導展開）。其摘要是互動裁決而非參數：執行中顯示 `waiting`，結帳後從結果 JSON 得出 `N/M answered`（被跳過的回答 —— `selected` 為空且無 `custom` —— 不計入），`ASK_CANCELLED` 顯示 `cancelled`，`ASK_ABORTED` 顯示 `interrupted` 並沿用共享的琥珀色 stopped 語義。畸形或截斷的結果回退到通用摘要。`PendingCard` 曾收窄為 `PendingWait<'approval'>`，`ChatView` 曾將待處理清單過濾為僅審批等待，使佔位卡片只服務於審批；其後審批輸入區接管（[Web 權限與審批](2026-07-23-web-permission-and-approval.md)）已將它徹底移除。

輸入區重設計將分頁移到底部操作區旁，多選選項渲染顯式核取方塊，單選保留編號行，並用始終可見的自訂輸入行取代展開式自訂入口（無選項問題用多行文字方塊）。刪除 `parseQuestionTitle` 的多選後綴約定；`multi_select` 已是結構化元資料，標題原樣渲染。

輸入區介面文案實作雙語：外掛程式在 `dsh-client-locale` 的 `question` 命名空間下註冊中英詞典，並透過 slot inject face 向條目提供綁定命名空間的翻譯器和作為 hooks compartment 來源的 locale 快照，語言切換時已掛載的輸入區會重新渲染。校驗回饋以詞典 key 儲存、切換時重新翻譯；載體失敗訊息與所有模型撰寫的問題/選項文字原樣渲染。

兩個相鄰修復隨行。所有通用 toolview 前導圖示（含懸停箭頭）現在統一繼承三級標籤色 —— 刪除了 others 變體的二級色覆蓋和獨立的箭頭顏色規則，只保留有意為之的 cordis 業務主色強調。用戶端 dev-watch 打包器用 `addWatchFile` 註冊每個 CSS 模組，因為虛擬模組間接層此前使僅改 CSS 的編輯對 watcher 不可見。

## 曾考慮的替代方案

**繼續透過 `PendingCard` 渲染問題。** 否決：該卡片是接管存在之前的只讀佔位，導致同一內容顯示兩份且其中一份不可作答。toolview 行加接管同時覆蓋了記錄與收集兩個面。

**在工作階段記錄行內聯顯示問題或回答。** 否決：輸入區接管擁有問題渲染與回答收集，而行的約定（`todo_write`）是單行、詳情在面板。因此行只報告結果，正如 todo 行報告計數而面板擁有清單。

**用通用錯誤形態渲染 `ASK_CANCELLED`/`ASK_ABORTED`。** 否決：放棄是使用者自己的主動操作，打斷是共享的停止手勢；兩者都是預期結果而非工具失敗。命名裁決（且中止保持琥珀色 stopped 語義）與其他被打斷的工具呼叫的呈現一致。

**現在就翻譯行內裁決文案。** 依明確的產品決定推遲：本次改動中行的 `waiting`/`answered`/`cancelled`/`interrupted` 字串保持英文；輸入區介面文案的國際化落地是因為其僅中文的文案在 en 語言下本就是錯的。

**保留標題後綴的多選約定。** 否決：`multi_select` 是結構化請求元資料且核取方塊標識已承載該訊號，從模型文字解析 `（可多选）` 是脆弱的重複通道。

## 後果

`ask_user_question` 與 `todo_write` 現在共同示範預期的 toolview 模式：複用 `ToolRow`、從呼叫參數或結果 JSON 做帶形狀校驗回退的摘要、透過帶 key 的 slot 註冊。專用的 `todo-row.module.css` 已刪除。

行內裁決字串是問題流程僅剩的硬編碼英文面；將其本機化是推遲的後續工作。審批輸入區接管已交付（[Web 權限與審批](2026-07-23-web-permission-and-approval.md)，並按[審批面板 Agent Note](../bug-fix/2026-07-30-approval-panel-command-cap.md)施加高度上限），`PendingCard` 已不復存在。

`ui-user-questions` 新增 `dsh-client-locale` 相依性和此前沒有的 inject face；其約定（`QuestionComposerInjected`）與消費端一起放在 `contract/slots.ts`。

## 驗證

`ui-conversation` 測試釘住行的 waiting/answered/skipped/cancelled/interrupted/回退矩陣、僅審批的待處理過濾和 slot 註冊；`ui-user-questions` 測試釘住重設計的輸入區（核取方塊多選、始終可見的自訂行、底部分頁、詞典 key 回饋重翻譯、IME 安全的 Enter）以及外掛程式的詞典註冊與 inject face；`ui-primitives` 測試釘住圖示集。組裝後的 Web GUI 在真實工作階段中演練了回答、取消與輪次打斷路徑。
