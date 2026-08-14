# Agent Note: fork 出的 child 保持 one-shot

Status: implemented

[English](2026-08-10-fork-children-stay-one-shot.md) | [简体中文](2026-08-10-fork-children-stay-one-shot.zh.md) | 繁體中文

## 問題

fork 與 spawn 的唯一區別是 child 的 Session 會以 parent 已完成輪次的前綴作為初始內容（見 [subagent-fork-in-process](../../../../packages/subagent/subagent-fork-in-process/README.md)）。這份初始內容有實打實的 token 成本——繼承的歷史會在 child 的每次請求中重新發送——而它唯一確定的回報是提供方側的前綴複用：在提供方與模型相同的前提下，起始位元組與 parent 逐位元組相同的 child 請求，無需為這段共享區間重新預填充。任何由 child 作用域新增在繼承歷史*之前*的內容都會消耗掉這份回報，因為複用在第一個不同位元組處即告停止。

作用域區域性的 `report` 返回通道現在是此類新增中最大的一項，而自[report 義務](../feature/2026-08-06-continuable-child-report-obligation.md)起它是兩項而非一項增量：`report` 工具 schema，以及 `tool:report` 系統提示詞 section。兩者都位於請求標頭部——系統塊與工具塊先於所有訊息——因此一個可繼續的 fork child 會在第一條繼承輪次之前就使複用失效，並重新預填充它當初 fork 就是為了複用的整份 transcript（文字記錄）。這種組合付出了 fork 的複製成本卻收不到它的收益，而 parent 手上仍握著一份 child 本可共享的可複用前綴。

## 決策

所有隨附組合都把 fork 委派工具綁定為 `backgroundMode: one-shot`：[base 組合包](../../../../packages/bundle/base/cordis.patch.yml)、[ACP 示例](../../../../examples/acp-agent/cordis.yml)與[headless 示例](../../../../examples/headless-agent/cordis.yml)。base 組合包保留 `run_in_background`，因為它掛載了 task 服務；兩個示例設定 `enableRunInBackground: false`，因為它們都不掛載 task 服務，否則一次 one-shot 後臺啟動會在呼叫時因缺少 `tasks` 服務而失敗。

one-shot child——前臺與後臺皆然——經由 `SubagentRuntime.start()` 建立，該路徑從不進入可繼續的 activation setup 登錄檔，因此 `report` 與它的提示詞 section 都不會被安裝。於是一個 fork 出的 one-shot child 的系統提示詞與工具 schema 與其 parent 相同，只差部署逐個委派工具主動選擇的 `persona` 與 `toolFilter` 增量。

`spawn` 保持 `backgroundMode: continuable`。對於 child 起步時本就沒有繼承前綴需要保護的那個提供方，可繼續 child 與 report 義務隨附行為不變，因此本決策沒有讓 report 通道付出任何代價。

### 該限制在於組合，不在於程式碼

`ForkInProcessProvider.prepareContinuable` 仍然實作完好，`ctx.subagents.startContinuable()` 也仍接受 `fork`；改動的只有隨附的 `cordis.yml` 行。`tool-subagent` 在掛載時同時知道提供方的 `inheritsParentContext` 與自身的 `backgroundMode`，因此一個載入期拒絕該組合的檢查是可行的，而這裡刻意不加：該組合並非普遍錯誤。它只在某個 child 作用域增量位於繼承歷史之前時纔是錯的，而產生該增量的包——[`dsh-tool-subagent-report`](../../../../packages/subagent/tool-subagent-report/README.md)——是獨立安裝的，並且按其自身設計對 `tool-subagent` 不可見。一個不安裝 report 包的部署可以在前綴完好的前提下執行可繼續的 fork child。把某一份外掛程式清單的後果寫成委派工具的不變數，會讓該工具斷言它無法觀察到的事實。

重新開放的條件記錄為 `prepareContinuable` 方法上的 `TODO(fork-continuable-prefix-reuse)` 標記——隨附組合不呼叫這個方法——並由 issue #2124 跟蹤：當 child 的系統提示詞與工具 schema 能與其 parent 逐位元組一致時，可繼續 fork 即可重新開放。

## 備選方案

**在掛載時拒絕 `inheritsParentContext` 與 `continuable` 的組合。** 一次響亮的載入期失敗可以阻止悄然的重新引入，而設定改動做不到這一點。否決的原因是委派工具看不到 report 包，且在沒有它時該組合是合法的；對於從不安裝任何 child 作用域增量的部署，這個不變數是假的，而 `tool-subagent` 會去斷言一件由外掛程式清單擁有的事實。

**乾脆不掛載 fork 提供方。** 這是該限制更徹底的形式。否決的原因是前臺 fork *正是*複用前綴的那種情形，且不受 report 通道影響，因此全面停用會在不換來任何 one-shot 綁定尚未換來的東西的同時放棄該能力——並且隨附組合將沒有任何一個演練 session 初始內容。

**照常隨附可繼續的 fork child 並接受這份損失。** 否決的原因是這份損失是全額而非邊際的：複用在繼承歷史之前就已中斷，於是 child 為一份自己複製過來、目的恰恰是不必付費的 transcript 付了全額預填充。想要一個沒有繼承上下文的長期 child 的部署，本來就有 `spawn`。

**讓 `report` 對每個 Agent 可見。** 全域性註冊會透過讓 parent 與 child 擁有相同的 schema 與 section 來復原逐位元組相同的前綴。否決的原因是根 agent、one-shot child、遠端 child 與無 agent 呼叫方都會宣告一件推導不出收件方的工具，而執行期拒絕會讓 schema 可見性與權限彼此矛盾——這正是[report 工具 Agent Note](../feature/2026-07-30-continuable-subagent-report-tool.md)已經定下的作用域區域性決策。

**把 child 作用域增量安裝到繼承歷史之後。** 否決的原因是它無法表達：在每個提供方的協定格式中，系統提示詞與工具 schema 都是請求標頭部結構，因此它們內部的任何排序都無法把僅屬於 child 的新增放到訊息清單之後。

## 後果

- 沒有任何隨附組合會建立可繼續的 fork child；`subagent_fork` 把結果返回給呼叫方的輪次，而 `send_message` 只尋址 spawn 出的 child。
- 除非部署在 fork 委派工具上設定了 `persona` 或 `toolFilter`，fork child 的請求前綴與其 parent 逐位元組相同，因此初始內容的 token 成本重新換來了提供方側的複用。
- fork 提供方的可繼續路徑沒有生產呼叫方，也沒有整體組裝層面的覆蓋。它保留自己的包內測試，seam 也仍然接受它，因此某個組合包或 `--patch` 覆蓋層可以無需改動程式碼、也不會有任何警告地把它重新引入。
- `subagent_fork` 面向模型的 schema 發生變化：base 組合包中可繼續的後臺措辭被 one-shot 的 task 措辭取代，在兩個示例中則完全消失。受影響的無金鑰快照工具 schema 伴隨檔案在同一次改動中重新記錄。
- 在隨附部署中，report 義務的覆蓋範圍收窄到 spawn 出的 child。它的 `wakeup` 默認調度、權限模型與覆蓋均保持不變。

### 已接受的風險

該限制存在於三個設定檔與一處程式碼註釋中，而不在閘門裡。未來某個組合包行或 profile 修補程式可以在 fork 工具上設定 `backgroundMode: continuable`，從而悄然重新引入前綴損失；沒有任何東西會失敗得很響亮。這就是不把某一份外掛程式清單的後果寫入 `tool-subagent` 所接受的代價。
