# Agent Note: Web transcript 標出上下文來源、召回與 steering

Status: implemented

[English](2026-08-04-web-context-source-and-steer-marks.md) | [简体中文](2026-08-04-web-context-source-and-steer-marks.zh.md) | 繁體中文

## 問題

生產方向模型側對話補充的一切內容，進入 Web transcript（文字記錄）後只剩兩種匿名形態。每一條已記錄的非使用者 `user/message`——skill（技能）目錄、執行時期快照、經過對帳的 `AGENTS.md` 指令、guard 提示、subagent 彙報、跨工作階段快照——都塌縮成同一行 `上下文注入`，讀者不逐行展開去讀原始 JSON 就無從知道究竟注入了什麼。steering（中途引導）的情況更糟：它渲染成與開輪提示完全相同的氣泡，於是 transcript 無法說明哪一則訊息打斷了正在執行的輪次。

這些區分本來就是持久事實。每個生產方都必須提供可合併擴充的 `user/message.source` 並在其中註明自己，`agent/inbox/spliced` 則記錄有身份的訊息進入和離開的是 `next-turn` 還是 `next-step`；把這些事實丟掉的只有呈現層。被這套 Web UI 取代的終端機 transcript 本來會寫出每張卡片的生產者，因此面對同一份日誌，Web 側是一次倒退。

## 決策

transcript 為非提示訊息可能承擔的三種角色分別命名：注入上下文、召回工作階段、steering。

Chat Message Definition 為每個 `ContextMessageNode` 附加一份包含生產者角色和名稱的 `provenance` 檢視表；`contextProvenance()` 僅依據持久來源計算該檢視表。它返回 `role`（`inject`，跨工作階段快照則為 `recall`）與命名生產者的 `label`。`ContextInjectionRow` 以角色作為標題，並按 `ToolRow` 摘要的幾何在標題旁展示該名稱，因此摺疊態就已經回答了「注入了什麼、由誰注入」；141px 滾動視口與截斷上限沿用[已歸檔的展開項決策](../../archived/feature/2026-07-30-web-context-injection-disclosure.md)，未作改動。視口裡渲染什麼，則由[上下文形態決策](2026-08-05-context-form-vocabulary.md)引入的、相互獨立的形態軸決定。

**名稱從日誌中讀出，絕不來自用戶端維護的生產者名稱表。** `agent-instructions` 以它對帳過的去重指令檔案路徑命名，`session-reference` 以它讀取的工作階段標題命名，外掛程式來源以其記錄的外掛程式 id 命名，其餘來源則以自身的 `kind` 命名——這正是可合併擴充聯合類型有文件記載的默認分支。沒有可讀 kind 的來源降級為無名注入。於是新增或重新命名的生產者無需用戶端發版即可辨識，任何名稱都不會相對程式碼失準，復原、fork 或來自外部的日誌與即時工作階段的投影結果完全一致。

`recall` 覆蓋 `session-reference`，因為它是當前唯一會把另一個工作階段的材料搬進本工作階段的已發布來源。今天沒有任何 Web 葉子掛載 `dsh-session-reference`——它此前只有終端機宿主——因此該分支的存在是為了日誌可移植性，而不是為了某個已打包的生產方，其覆蓋來自單元測試而非組裝後的 Web 場景。

Chat Inbox 與 Message Definition 會重放持久 `agent/inbox/spliced` 事件；如果一條使用者來源的訊息以相同身份從 `next-step` 被領取，後續 `user/message` 就投影為 `SteeringMessageNode`。`MessageItem` 為這種持久訊息與待處理 steering 氣泡加上 `插话` 標注。從排隊輪次領取的訊息仍是 `UserMessageNode`，非使用者來源的 next-step 訊息仍是上下文。這推翻了[已歸檔的取消 steer 入口與插話裝飾決策](../../archived/simplification/2026-07-31-web-ui-no-steer-entry-or-interjection-chrome.md)中的一條結論。當時移除徽章，是因為 composer 無法 steer，標籤指向了使用者做不到的動作。此後 composer 獲得了 Steer 手勢，卻沒有同步修訂那份 note；本決策提供了它在「重新引入」條款中要求的產品決策，並訂正了其中留下的過時事實。標注是這裡唯一的 steering 裝飾：composer 模式、Queue dock 的嚴格 steer 操作、待處理 steering 的生命週期仍歸各自的所有者。

## 考慮過的替代方案

**在用戶端本機化生產者名稱。** 以外掛程式 id 為鍵的字典讀起來確實比 `@deepseek-ai/dsh-system-prompt` 好，但它會在每次重新命名時悄悄失準，每新增一個生產者都要改用戶端，而且對來自外部的日誌根本無法命名。日誌已經記錄的生產者名稱，比用戶端自己編造的標籤更可靠。

**按來源 kind 註冊呈現。** 展開項決策把鍵控的上下文檢視表 slot 推遲到出現由來源自有的呈現需求為止。為一行命名並不構成獨立呈現，而以「已掛載的生產者」為鍵的登錄檔恰恰會在最要緊的地方失效——生產者已不再掛載的復原日誌同樣必須渲染出來。

**在 host 側計算角色與名稱。** 那需要為每份事件副本附加一個檢視表，重複陳述持久來源已經說明的事實，並為每條上下文訊息增加一個 wire 欄位。改由投影為每個節點計算一次，與 transcript 其他派生事實同處一地。

**給 steering 獨立的行而非帶標注的氣泡。** steering 是一條在輪次中途抵達的使用者訊息；獨立行形會打斷靠右對齊的閱讀節奏，並且要為零新增資訊重複氣泡上的複製與分支操作。

**把同一套名稱擴充到 trajectory 表格。** 不在本次範圍內：該表格的上下文單元格有自己的文字推導，而 issue 要求的是對話面。

## 測試

- `packages/client/runtime` 單元覆蓋釘住每種來源類型、名稱欄位缺失／為空／類型不符時的回退、來源沒有可讀 kind 時的無名降級，以及 reset 和即時 append 路徑上的 steering 重建。
- `packages/client/ui-conversation` 的 jsdom 覆蓋釘住角色標題、標題旁的生產者名稱、展開後該名稱的留存，以及無角色標題欄。
- 無金鑰的組裝 Web 預期輸出攜帶帶名稱的標題欄，因此，這些標識也在組裝後的 transcript 中得到驗證，而不只經過了元件測試。

## 後果

- **部分被取代。** 決策中的 steering 標注條款已不再描述 master：[標注移除決策](../simplification/2026-08-10-web-remove-steering-interjection-caption.md)刪除了 `插话` / `Interjection` 標注，輪次中途的 steer 只能靠它在訊息流中的位置辨認。決策中的上下文來源與召回命名仍然有效，`SteeringMessageNode` 投影未變。
- 讀者一眼即可歸因 transcript 中每一條非提示訊息；即便面對本用戶端版本從未見過其生產者的日誌，標題欄依然如實。
- 只要來源僅攜帶外掛程式 id，UI 中的生產者名稱就呈現為包名形態（`dsh-tool-skill`、`@deepseek-ai/dsh-system-prompt`）。這是拒絕用戶端名稱表的代價；想要更好標籤的生產者必須在來源欄位中記錄該標籤。
- `ContextMessageNode` 增加了一個必填欄位，因此每一處構造該節點的程式碼——包括測試 fixture（測試前置資料）——都必須提供它。
- 即使 agent loop（代理循環）現在把已經接納的 steering 記錄為 `user/message`，`SteeringMessageNode` 仍是獨立的呈現節點；它的身份來自持久 inbox 歷史，而不是獨立訊息事件。
- 在某個宿主掛載 `dsh-session-reference` 之前，`recall` 分支在已發布的 Web 葉子中沒有生產者，只能透過別處寫入的日誌抵達。
