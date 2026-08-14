# Agent Note: Background job completion wakes an idle owner

Status: implemented

[English](2026-08-11-background-job-completion-wakes-an-idle-owner.md) | [简体中文](2026-08-11-background-job-completion-wakes-an-idle-owner.zh.md) | 繁體中文

## 問題

`tool-jobs` 對模型承諾「任務完成時你會在工作階段內收到通知——不要忙輪詢，也不要 sleep 等待」。這個承諾只在模型仍在工作時成立。完成經由 `agent.inject()` 交付，它只向 next-step inbox 追加而不預留 driver，因此在輪次結束之後才結帳的任務會把通知擱在那裡，直到某件無關的事情喚醒 agent。最常見的形態恰恰就是會失效的那一種：模型啟動一條長命令，告訴使用者已經啟動，結束輪次，而命令完成後進入了一個無人領取的 inbox。提示詞讓模型不要輪詢，然後什麼也沒到。

這個缺口被記為一條限制，而不是被推敲過，於是退路成了 `job_output(wait: true)`——同一段提示詞並不鼓勵的阻塞等待。

本決策取代[背景工作執行時期決策](../architecture/2026-06-20-generic-long-running-tool-runtime.md)中的一條事實——完成永不喚醒空閒所有者——並把 teardown 加為 `reported` 的置位方。那份 note 仍擁有其餘全部任務執行時期決策，因此就地更新而非替換。

交付機制從來不是障礙。自[統一 send 決策](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md)起，`Agent.send(message, target, wakeup)` 就覆蓋了 `target` × `wakeup` 矩陣，`wakeDriver()` 也已經處理 idle、maintenance 和已取消未收斂三種相位。缺的是「一次完成走哪條通道」這一策略選擇，以及該選擇所需的界。

## 決策

尚未報告的完成按所有者當時在做什麼來選擇通道。繁忙的所有者走注入，保持原樣。空閒的所有者用 `followup()` 喚醒。

這採納了[延續管理器](2026-08-06-manager-owned-subagent-settlement-delivery.md)已經為 subagent 結帳所採用的交付規則，那裡寫著「用 steer 而非 inject 是刻意的……這是一條正確性規則，不是部署偏好」。兩條路徑不重疊：`tool-subagent` 只為一次性後臺子 agent 註冊 Task，而 continuable 分支在抵達那段程式碼之前就已返回，因此一個子 agent 恰好由兩種機制中的一種交付。

### 繁忙的所有者保留注入

對真正在執行的 driver 而言，`steer()` 與 `inject()` 是同一次交付：對於執行中且未中止的相位，`wakeDriver()` 會提前返回且不設定 latch。二者只在一種所有者上有區別——輪次已取消但尚未收斂，此時 steer 會重定向到下一輪並在收斂時重放喚醒。

在那裡注入纔是對的。輪次被取消意味著使用者按了停止，替他們重新開一輪等於把一次中斷洗成了他們沒有要求的模型請求。普通情形已由輪次迴圈覆蓋：只要 next-step inbox 還有內容，輪次就無法結束，因此在該檢查之前抵達的通知會延長當前輪次，同時結帳的多個任務只花掉一步而不是各佔一輪。

### 喚醒有界，且該界不是時間

`maxConsecutiveWakes`（默認 3）限制一個所有者由此開啟的輪數；超出後通知降級為注入，等待下一輪。領取任何使用者撰寫的訊息都會復原預算——是領取而非抵達，因為那纔是人類輸入真正進入某一步的時刻。本外掛程式自己排隊的通知永遠不會補充它。

設界是因為這條鏈會自激，而 subagent 結帳不會。結帳受限於模型派生了多少子 agent；被喚醒的一輪卻可能啟動某個背景工作，而它的完成又會喚醒同一個所有者，且無人旁觀。`dsh run` 不需要單獨策略：它唯一的使用者訊息在第一輪就被領取且不會重複，因此預算單調消耗，行程必然終止。

`completionDelivery: quiet` 為空閒所有者復原舊通道。它的存在是為了確定性 transcript，並在名稱、取值與預設值上都對齊 `tool-subagent-report` 的 `reportDelivery` 開關。

### 銷毀自行認領報告

`cancelForTeardown` 現在會把記錄標記為 `reported`，與 `kill()` 在取消之後所做的完全一致。當通知只是一次無害的注入時，這處不對稱看不出來；而會喚醒的報告方會把它變成每個 teardown 層級一次模型請求，作用在宿主正要銷毀的 agent 上。

`reported` 本來就是正確的那個 bit——「kill、read 或 wait 已報告或承諾報告終止狀態」——而 teardown 是一次沒有呼叫方的 kill。用它可以讓該結帳的每一個觀察者都保持完整：`onJobDone` 仍會觸發，因此執行時期不變數與強制失敗路徑依舊被覆蓋，只有通知報告方會安靜下來。

### 完成是最後才宣佈的

`settle()` 此前釋放等待方、標記記錄已結帳並行布可見集變更的時機，都排在執行完成監聽器**之後**。開啟輪次的報告方是同步執行的，因此那個順序會讓被喚醒輪次的 `turn/start` 搶在它所回應的那次結帳被提交之前落地，也搶在任何 `onJobsChanged` 觀察者看到它之前。把完成放到最後宣佈，使報告方成為該結帳的最後一個觀察者，而其他觀察者都已先看到它。

## 被否決的替代方案

**在 `JobStart` 上加生產方聲明的喚醒位**，對應 Codex 的 `trigger_turn` 與 Kimi 的 `admission` 枚舉。從長期看這是更好的形狀——`tail -f` 流與兩小時建置想要不同答案——但當前沒有任何生產方需要區分它們，而倉庫要求公共面必須有當下的所有者與需求。加它的自然觸發點，是第一個「要讓某個任務喚醒而另一個不喚醒」的生產方出現時。

**一個通用的非請求輸入佇列**並帶優先級通道，正如 Claude Code 用來把背景工作、cron、MCP 推送與 hook 合併進同一次排空。DSH 的 inbox 本身就是那個佇列——`next-turn`/`next-step` 之上的持久 `agent/inbox/spliced` splice——因此這等於在既有層之上再加一層，只為決定一個 bit。

**拒絕重開一個已經產出可見答覆的輪次**，即 Codex 的 `MailboxDeliveryPhase` 閂鎖。那條閂鎖正是本決策刻意反轉的預設值：在模型已經說完話之後喚醒它就是本特性的全部意義，界由喚醒預算來承擔。

**在計數之上再加牆鐘視窗**。對互動式 agent 而言，慢的那種情形恰恰是想要的——一小時的建置結束、agent 接著幹下去，這就是特性本身——而 `dsh run` 已被它無法補充的計數封頂。只有當出現無人值守的長生命週期部署時才值得重新考慮。

**在 owner 排空期間整體壓制 `onJobDone`**，與服務級的 `listenersClosed` 對稱。它讀起來更乾淨，但會移走一個不只服務於通知的訊號：強制失敗記錄與執行時期不變數都會觀察 teardown 結帳。`reported` 位恰好只否決報告方，別的什麼也不否決。

## 影響

- 默認行為改變：空閒所有者現在每次完成會花掉一次模型請求，按所有者、在兩次使用者訊息之間由 `maxConsecutiveWakes` 封頂。想要舊行為的部署設定 `completionDelivery: quiet`。
- `tool-jobs` 的提示詞段落無需改動；「任務完成時你會在工作階段內收到通知」從願景變成了事實。
- `JobSnapshot.reported` 新增 teardown 作為第四個置位方，記錄在 Service Definition 與[子系統參考](../../../../docs/subsystems/jobs.md)中。
- `settle()` 在提交記錄並行布可見集變更之後才宣佈完成。任何相依性「在釋放等待方之前或在 `onJobsChanged` 之前執行」的監聽器現在都排在兩者之後。
- `tool-bash` 的 real-composition 測試去掉了第二條使用者訊息：僅靠結帳就能把通知帶入一個收集輸出的輪次。它斷言持久結果而非輪次邊界，因為命令是否活得比它的輪次久是一場競態；通道選擇改由 `tool-jobs` 單元測試釘住。
- 單元覆蓋釘住：空閒喚醒、繁忙注入、quiet 交付、預算耗盡、使用者輸入復原預算、外掛程式通知不復原預算，以及 teardown 靜默。

### 已接受的風險

已花掉的預算只由使用者輸入復原。耗盡預算的無人值守 agent 要等到其他原因開啟輪次時才收走剩餘通知，在此期間沒有任何機制為它重新充能。

在 `quiet` 下待領於空閒所有者的通知仍會隨該所有者釋放而消亡，與此前一致：釋放時的取消會清空未領取的 inbox，日誌保留插入/取消這一對作為記錄。[結帳交付 note](2026-08-06-manager-owned-subagent-settlement-delivery.md) 承載這需要的離線信箱討論。

對短命任務而言，完成究竟是延長執行中的輪次還是開啟新輪次是一場真實競態，因此沒有哪份編寫的 transcript 能同時容納兩種順序。組裝態覆蓋斷言結果；通道選擇由單元測試釘住。

還殘留一個微任務視窗：結帳若落在輪次迴圈最後一次檢查 inbox 之後、driver 提交 idle 相位之前，讀到的仍是 `status === 'running'`，於是走注入且無人喚醒。改用 steer 也堵不上——`wakeDriver()` 只為 maintenance 與取消後的相位設定 latch，不為「最後一次檢查與自身退休之間」的 driver 設定。要堵上它需要 `agent-loop` 在最後一次領取之前就發布退休狀態，那屬於核心 agent 的決策，而非交付策略。
