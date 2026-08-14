# Agent Note: 可繼續 child 的返回通道是一項義務

Status: implemented

[English](2026-08-06-continuable-child-report-obligation.md) | [简体中文](2026-08-06-continuable-child-report-obligation.zh.md) | 繁體中文

## 問題

可繼續後臺 child 擁有自己的 Session，因此它寫在那裡的任何內容都不會到達啟動它的 agent。[report 工具](2026-07-30-continuable-subagent-report-tool.md)為該 child 提供了一條返回通道，卻把它呈現為若干選項之一：schema 裡寫著「可呼叫零次或多次」，child 的提示詞中沒有任何地方要求它呼叫該工具，而已採納的默認調度（`quiet`）會把報告加入已停駐 parent 的下一次請求，卻不喚醒它。

這些選擇單獨看都站得住腳。合在一起，它們讓這條返回通道無法作為委派契約使用。一個完成工作、把答案寫進自己 transcript（文字記錄）隨後停止的 child，會讓 parent 一無所獲；而確實上報了的 child，面對的是一個已經停駐、要等到別的事件把它喚醒才會讀到報告的 parent。外部回饋中的 parent 忙輪詢 `list_agents`、反覆向已結帳 child 傳送訊息、以及放棄 `subagent` 改用 `workflow`，都可歸結為同一處缺失的保證。

## 決策

返回通道是 child 收到的一條指令，而不是它需要自行發現的能力。report 包會向每個可繼續行程內 child 安裝兩項作用域區域性註冊，並由同一個 disposer 撤銷兩者：

- `report` 工具，其描述現在說明 child 要在結束前呼叫一次並給出自足的最終結果，並在部分進展會改變 parent 下一步動作時提前呼叫；
- 一個 order 為 117 的 `tool:report` 系統提示詞 section，用 child 自己的語氣承載同一條義務，使從不細讀工具描述的 child 仍能收到它。

`reportDelivery` 的預設值現在是 `wakeup`。一條被接受的報告恰好建立一個普通的後續 parent 輪次並喚醒停駐的 parent 驅動；它仍然絕不 steering（中途引導）已開始的輪次。對於寧可讓報告無人閱讀也要避免輪次放大的部署，`quiet` 依舊可用。

### 為什麼 section 與描述同時存在

兩者針對不同的失效模式。工具描述是在模型已經在考慮 `report` 時被讀到的；提示詞 section 是在它判斷自己是否已經完成時被讀到的。這條義務必須同時出現在兩處，因為本次修復的失效——child 直接停下——發生在第二處。

該 section 註冊在 child 自己的作用域上，與[child 組合](../../../../packages/subagent/subagent/src/child-agent.ts)為遮蔽式 persona 已經使用的機制相同，因此 parent 與所有同級都看不到該工具與該指引。工具註冊失敗時，`installReportTool` 會回滾該 section；它返回的 disposer 會先嘗試撤銷兩項註冊，再拋出清理失敗。

### 是指令，不是強制

沒有任何東西會拒絕一個從不上報的 child。沒有任何執行時期路徑會檢查是否傳送過報告，`report` 仍接受一個輪次中呼叫零次或多次。本次改動是面向模型的措辭加上一個調度預設值；服務權限、確認與復原契約都保持不變。

這條邊界是刻意劃定的：提示詞文字只能到達仍在執行自身迴圈的 child。被錯誤、token 上限、取消或拆卸終止的 child 根本沒有機會遵守，因此執行時期會自己記錄結帳這件事，而不是信任這條指令（見[由管理器負責的結帳投遞](2026-08-06-manager-owned-subagent-settlement-delivery.md)）。

### 快照覆蓋

整體組裝的 ACP `subagent-report` 場景現在演練隨附的默認行為：child 上報，停駐的 parent 就該報告執行一個普通輪次，隨後的提示詞仍能從持久化日誌中把報告讀回來。由於該 child 的作用域現在組合出類別 pin 無法描述的提示詞，快照 harness 新增了 `pinsChildSystemPrompts`，它與既有 `pinsChildToolSchemas` 完全對稱：把一個 child fixture 的提示詞移入 `system-prompt.<n>.expected.md`，其餘請求 header 欄位仍歸類別 pin 所有，要求 sidecar 恰好在聲明時存在，並拒絕與該類別 pin 完全相同的 sidecar，使冗餘副本無法悄悄漂移。

## 備選方案

**保留 `quiet` 作為預設值，只相依性提示詞。** 這曾是隨附的立場，而它本身什麼也沒有解決：一條 parent 從不閱讀的報告，與一條從未傳送的報告無法區分。[report 工具 Agent Note](2026-07-30-continuable-subagent-report-tool.md)對「始終喚醒」的否決，前提是 parent 還有別的理由去查看自己的上下文；已停駐的後臺協調者並沒有。輪次放大才是真正的代價，而它現在是 `quiet` 仍然保留的理由，而不是它作為預設值的理由。

**讓 child 按呼叫選擇投遞模式。** 與最初的否決相同：模型將掌握調度壓力，行為也會隨呼叫而非隨部署變化。

**只把義務寫在工具描述裡。** 描述是在從多個工具中選擇時被讀到的。本次改動針對的 child 並不在選擇工具，它認為自己已經做完了。提示詞指引纔是能觸及該判斷的介面。

**在結帳時拒絕沉默的 child，以此強制該義務。** 沒有什麼可以拒絕：當結帳可被觀察時 child 的迴圈已經結束，讓它的拆卸失敗只會毀掉工作而不會送達結果。由執行時期無條件投遞終止事實纔是這一情形的答案，而它屬於繼續執行管理器，不屬於本包。

## 後果

- 載入本包後，每個可繼續行程內 child 的每次請求都會多出一個提示詞 section 和一段更長的 `report` 描述；其他任何 Agent 的請求都不變。
- 默認部署會為每條被接受的報告喚醒 parent 一次。頻繁上報的巢狀樹會消耗額外的 parent 輪次；`quiet` 是有文件記載的退路。
- `installReportTool` 需要 child 作用域中的 `ctx.systemPrompt`，因此本包在 `inject` 中聲明 `systemPrompt`，從而在載入時失敗，而不是等到下一次 child 物化時。
- 單元覆蓋固定了新預設值、兩處關鍵指令措辭、該 section 相對 parent 與同級均僅限 child 的作用域，以及兩項註冊在安裝回滾或撤銷時的清理。
- 三個帶可繼續 child 的整體組裝 ACP 場景透過新的 sidecar 逐字固定完整的 child 提示詞；今後任何對 child 作用域 section 的改動都會讓這些場景失敗，而不是悄悄透過。

### 已接受的風險

默認喚醒會在深層樹中放大模型工作量。部署透過 `reportDelivery` 掌握該取捨，且放大幅度以每條被接受報告一個輪次為界。

child 仍可能不上報就結束，本次改動無法偵測這一點。只有執行時期自己的[結帳記帳](2026-08-06-manager-owned-subagent-settlement-delivery.md)才能補上這一情形。
