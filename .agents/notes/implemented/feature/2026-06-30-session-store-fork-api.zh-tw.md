# Agent Note: SessionStore fork API

Status: implemented

[English](2026-06-30-session-store-fork-api.md) | [简体中文](2026-06-30-session-store-fork-api.zh.md) | 繁體中文

## 問題

事件溯源的工作階段日誌已經具備 fork 所需的原語：建立一個帶有種子事件前綴的新工作階段，然後像重播一樣從該種子日誌推導模型歷史。這個原語有意保持底層：`ctx.sessions.create(id, { seed, meta })` 接受任何合法種子，但常規的活躍工作階段分支需要圍繞以下問題制定策略：哪些前綴可以被複制、子工作階段應打上哪些元資料、以及錯誤如何分類。

語義上的風險在於 fork 邊界。一個合法的使用者可見 fork 種子必須連續，並在活躍輪次之外結束。如果在執行過程中 fork，會複製一個未關閉的 `turn/start`、可能還有一個未關閉的 `step/start`，以及可能懸空的工具呼叫。這違反了執行與提供方 transcript（文字記錄）不變式，並且會建立一段誤導性的子歷史——看起來子工作階段參與了父工作階段中一個尚未完成的輪次。已關閉輪次之後的獨立上下文和由外掛程式負責寫入的純日誌事件是穩定且可 fork 的歷史。現有的 [subagent seam](2026-06-21-subagent-capability-seam.md) 有意解決的是另一個問題：工具觸發的 subagent fork 通常發生在父輪次仍然打開時，因此 `dsh-subagent-fork-in-process` 會將種子裁剪到父工作階段最後一個已完成輪次的前綴。通用的工作階段 fork 不應靜默裁剪；它應當要麼在請求的邊界處 fork，要麼拒絕請求。

## 決策

`dsh-session` 直接負責 `ctx.sessions` 上的常規活躍工作階段 fork。不設獨立的 `dsh-session-fork` 包，也不設 `ctx.sessionFork` 服務：該 API 沒有獨立的後端、事件詞彙、生命週期或持久化行為，所有持久化工作都委託給現有的工作階段儲存和持久化後端。

store 暴露一個操作：

```ts ignore-check
type SessionForkSource = Session | SessionId

class SessionStore extends Service {
  fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
}
```

`boundary` 是要複製到的源事件 `seq`（含該序號）。省略時預設為源工作階段當前的最後一個事件；對空源工作階段省略 `boundary` 則建立一個空的子工作階段。fork 特有的校驗會檢查請求的邊界存在，並確認所選前綴最近的輪次邊界不是未匹配的 `turn/start`。因此，所選前綴可以結束於 `turn/end` 或更晚的獨立事件，隨後被深拷貝到子工作階段的種子中。子工作階段繼承源工作階段的 `cwd`，將 `parentSession` 設為源工作階段 id，並將 `seedLength` 設為已複製前綴的長度。省略 `childSessionId` 時，`SessionStore` 使用其現有的 id 策略生成一個。

空前綴可以被 fork；任何非空邊界都必須是位於開放輪次之外且安全、已存在的序號。類型化的錯誤區分源缺失、對象過時、子 id 重複、邊界無效和前綴結束於執行過程中等情況。更廣泛的日誌校驗與當機復原仍由其現有的負責方處理。

### Host 與瀏覽器適配

Host 的 `session.fork` RPC 接受 `atSeq`，並將其視為所需輪次內的錨點，而非 store 中包含該序號的安全邊界。它選擇該錨點處或其後的首個 `turn/end`；錨點省略或超過末尾時，選擇最後一個已完成輪次。若錨點已在日誌中，但從該錨點起找不到匹配的 `turn/end`，則返回 `fork-unavailable`，絕不回退到更早的輪次，因此訊息操作不會靜默遺漏所點擊的訊息。

Host 透過 agent（代理）登錄檔，以選定的種子和譜系建立子工作階段；發布前 setup 會先安裝日誌中最新的提供方、模型和推理（reasoning）目標，子工作階段才能執行。隨後，Host 將子工作階段附加到源 Workspace。若附加失敗，則返回 `workspace-attach-failed` 及已發布的子工作階段 id；用戶端先將該子工作階段對帳到摘要清單，再向呼叫方報告錯誤。Session 行操作使用最後一個已完成輪次，訊息操作則提供其事件 seq；兩者都會在成功後打開子工作階段，展開譜系後可在源工作階段下看到它。

## 曾考慮的替代方案

**獨立的 `ctx.sessionFork` 服務。** 較早的一版迭代曾把它作為獨立服務交付；它過度套用了能力 seam 模式。程式碼沒有可替換的後端、沒有額外的事件面、沒有獨立的所有權生命週期，也沒有超出 `ctx.sessions.create({ seed, meta })` 的持久化行為。保留獨立包會迫使呼叫方為了在工作階段儲存原語之上執行一層策略而去發現並安裝第二個服務。

**兩個函式：`snapshot()` 加 `fork()`。** 這保留了一個可複用的種子／元資料計算，但唯一支持的消費端會立即建立工作階段。它還使 API 看起來比使用者實際需要的具體操作更抽象。單一的 `fork()` 加顯式 `boundary` 使 API 保持直接，同時仍支持對先前時間點的 fork。

**靜默裁剪未關閉輪次到最後一個已完成邊界。** 這對 `dsh-subagent-fork-in-process` 是正確的——委託通常在父輪次仍然打開時開始，子工作階段應只繼承已完成的前綴。但對常規的使用者／工作階段分支而言是錯誤的，因為它隱藏了請求的 fork 點實際上不是合法邊界這一事實，並且靜默丟棄了父輪次的尾部。

## 後果

公開 API 保持精簡且易於發現：活躍工作階段分支是 `ctx.sessions` 的一部分，緊鄰 `create({ seed })`，而非一個獨立服務或一對兩步輔助函式。持久化繼續透過現有的 `session/created` 和 `session/flush` 行為運作：fork 出的子工作階段建立時便帶有種子事件，因此現有後端只需持久化該種子一次，並在 header 中保存 `parentSession`／`seedLength`。

v1 範圍仍然排除 ACP（Agent Client Protocol） `session/fork`、對未載入的已持久化工作階段的 fork、面向模型的工具，以及 subagent 重構。如果未來新增 ACP 方法，應在具備協議與快照覆蓋後才聲明支持該能力；本 Agent Note 不新增任何 ACP 協議行為，因此不需要 ACP 快照。fork 子工作階段的重播仍由現有的[種子邊界測試 Agent Note](../testing/2026-06-22-fork-child-replay-seed-boundary.md) 覆蓋；store、Host、載體與用戶端的專項測試固定邊界和對帳約定，真實 Chromium 場景則固定組裝後的訊息操作與譜系樹。
