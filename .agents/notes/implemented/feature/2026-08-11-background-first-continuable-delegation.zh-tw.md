# Agent Note: 可繼續委派採用後臺優先

Status: implemented

[English](2026-08-11-background-first-continuable-delegation.md) | [简体中文](2026-08-11-background-first-continuable-delegation.zh.md) | 繁體中文

## 問題

可繼續 child 已經具備持久化 id、獨立輪次、後續訊息以及由管理器負責的結帳通知。如果把省略的 `run_in_background` 視為前臺，模型就必須在每次呼叫時重複寫出 `true`，才能得到這套生命週期。這樣也會掩蓋真正有用的調度判斷：只有當 parent 的下一步動作需要 child 結果時，parent 才應等待。

child 作用域的 `report` 提示詞要求傳送自包含的最終報告，而[由管理器負責的結帳投遞](2026-08-06-manager-owned-subagent-settlement-delivery.md)會獨立傳送本次執行的結束結果與收尾訊息。已完成的 child 因而可能先用最終報告喚醒 parent，再用結帳通知喚醒一次。後臺優先調度會保留兩次投遞：由 child 編寫的交接仍是強制提示詞指引，由管理器生成的通知則不相依性模型是否遵循指令，覆蓋每種終止路徑。

## 決策

`tool-subagent` 根據選定的生命週期策略解析省略的 `run_in_background`。`backgroundMode: continuable` 會把省略解析為後臺並立即返回持久化 child id；顯式傳入 `false` 會選擇前臺並等待結果。`backgroundMode: one-shot` 保留前臺默認行為，因為它的後臺輸出仍需透過 Task 收集。`enableRunInBackground: false` 仍會省略該參數、拒絕強制傳入的 `true` 並在前景執行。系統不增加第二個默認選擇設定。

面向模型的文字按位置劃分職責：

- 工具描述說明呼叫行為、持久化 id、執行時期結帳通知、透過 `send_message` 繼續對話，以及顯式前臺覆蓋；
- `run_in_background` 參數說明具體生命週期的預設值以及何時覆蓋；
- `tool:<toolName>` 系統提示詞 section 會告訴模型同時啟動相互獨立的委派、在它們執行時期繼續有用工作，並且僅當下一步動作相依性結果時選擇前臺。只有當該工具在組裝作用域中仍可見時才會渲染這個 section，因此子級工具限制會同時移除 schema 與對應指引。

[可繼續 child 上報義務](2026-08-06-continuable-child-report-obligation.md)保持不變：child 提示詞要求傳送一份自包含的最終報告，並在發現會改變 parent 下一步動作的資訊時提前報告。由管理器負責的結帳仍然無條件執行，不檢查報告是否已經到達。這兩則訊息可能重複最終內容，但作者和用途不同：`report` 是 child 的顯式交接，結帳則記錄本次執行如何結束，並在 child 無法配合時保留終止輸出。`reportDelivery` 仍是部署調度策略，預設值仍為 `wakeup`。

無金鑰 headless `subagent-settlement` 場景省略 `run_in_background`，收到立即返回的 child id；儘管 fixture（測試前置資料）有意不呼叫 `report`，它仍透過管理器生成的結帳通知到達 parent 最終答案。包測試另行固定了顯式 `false` 的前臺語義、parent 調度文字以及 child 的強制報告提示詞。

## 考慮過的替代方案

**把欄位替換為 `run_in_foreground`。** 反轉布林值會讓常見情形以肯定形式表達，卻會為同一項調度選擇創造第二套詞彙，並迫使所有現有呼叫方與面向提供方的 transcript（文字記錄）一起改變。保留 `run_in_background` 可以維持單一欄位，並把前臺作為顯式例外。

**增加可設定的後臺預設值。** 獨立預設值可能與 `backgroundMode`、schema 措辭和已安裝提示詞不一致。生命週期策略已經區分可繼續 Activation 與一次性 Task，而這個區別正好決定了後臺完成是否會自動投遞。

**只修改提示詞。** 如果執行時期解析不變，提示詞偏好仍會讓省略參數的呼叫進入前臺。模型必須能夠相依性公佈的預設值，而不是在每次工具呼叫中完美複述它。

**最終報告到達後抑制結帳通知。** 條件結帳會重新引入每次 Activation 的記帳，並且當 child 先報告進度、隨後失敗時丟掉無條件執行時期保證。即使生成的訊息與最終報告重疊，結帳仍然無條件執行。

**只用 `report` 傳送結帳前的進度。** 這樣可以消除重複的最終內容，但也會從 child 提示詞中移除由 child 編寫的顯式交接。最終報告義務保持不變，執行時期結帳則繼續作為它的獨立後備和終止記錄。

## 後果

- 普通可繼續呼叫無需寫出 `run_in_background: true` 即為非阻塞；序列委派需要顯式選擇 `false`。
- 同一條 assistant 訊息中的獨立 subagent 呼叫會在工具迴圈的並行安全分發下重疊執行；有相依性的前臺呼叫仍可逐個寄出。
- parent 指引、工具 schema、執行時期解析和結帳投遞陳述同一個預設值。
- 遵循指令的 child 會發送一份自包含的最終結果，也可以更早報告重要發現。每次 Activation 還會產生無條件結帳通知，因此已完成的執行可能兩次投遞相互重疊的最終內容。
- 一次性後臺 Task 與停用後臺的工具實例保留現有行為。
