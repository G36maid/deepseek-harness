# Agent Note: 斜槓目錄跟隨空工作階段的 preset 切換

Status: implemented

[English](2026-08-10-slash-catalog-follows-preset-switch.md) | [简体中文](2026-08-10-slash-catalog-follows-preset-switch.zh.md) | 繁體中文

## 問題

preset 把決定 `/` 選單內容的那些行搬走了。Web 組裝停用了宿主面的 `skill-filesystem`、`tool-skill`、`plan-mode` 和 `command-compact`，改由 preset 提供，因此一個工作階段有哪些命令和技能，是它自身組成的屬性，而不是部署的屬性。

瀏覽器側兩份目錄都按工作階段快取——`dsh-client-ui-commands` 的 `CommandDirectory`，`dsh-client-ui-skill` 的 single-flight 拉取表——並且 composer 在 scope 出生時就按工作階段建立時的 preset 預熱了它們。隨後 hero 上的 chip 允許使用者重組這個仍為空的工作階段，而兩份快取都沒有對應的失效邊：`commands/change` 是登錄檔級的，`connection/reset` 需要重連。`agentPresets.recompose` 只是把 agent 的 scope 重新掛接到一個可能已經存在的常駐掛載上，不產生任何註冊，登錄檔級訊號因此永遠不會為它觸發。

於是選單繼續提供工作階段已經不再執行的那套組成。向下切換後 `compact`、`plan` 和全部項目技能仍列在選單裡；向上切換後留在原地的是更窄的目錄——四條宿主面行加用戶端自己的 `model` 貢獻——而且完全沒有技能，這正是 bug 報告描述的現象。只有當某個無關的登錄檔變化或一次重連恰好使其失效時，目錄才會自愈。

## 決策

這次切換的提交點是落帳的 `agent-preset/selected` 事件。preset owner 將該提交重新發為 client-safe 的 cordis owner 事件 `agent-preset/selected(sessionId, agentPreset)`，宿主流原樣轉發它，兩份目錄各自透過 `ctx.remote.$on` 直接訂閱：`ui-commands` 軟刷新該鍵（新快照落地前，舊快照繼續服務已打開的選單），`ui-skill` 讓它失效（並中止運送中的預熱，使一次與切換賽跑的 warm 無法發布過期目錄）。

該 owner 事件按工作階段粒度，不攜帶目錄，只帶 preset id。`ui-agent-preset` 會把它折進工作階段行，因為 `agentPresets.select` 的回執只會到達發起切換的那個用戶端，而工作階段頭部標籤正是以這一行為準（hero chip 比較下一次選擇時讀的也是它）。

從落帳事件而不是 RPC 處理器的回傳值派生 owner 事件，使「這個工作階段的組成變了」只有一個權威來源：每個已連線的用戶端都能觀察到這次切換，而不只是發起它的那個分頁標籤；不是發起方的用戶端也無需從一個根本不會到來的登錄檔訊號裡去推斷。

## 考慮過的替代方案

**在用戶端自己的 `agentPresets.select` 回呼裡就地失效。** 改動最小，而且第一輪之後 preset 就鎖定，hero 上的 chip 是切換唯一可能的發起處。否決理由是失效邏輯會落在恰好發起 RPC 的那個介面上，而不是提交點：同一個空工作階段在第二個分頁標籤裡仍是過期選單，將來任何宿主側的重組也完全沒有訊號。

**從既有的 `session/event` mux 幀派生用戶端事件。** 落帳事件本來就會送達每個已訂閱的用戶端，不需要新增協議類型。因面（face）分離而否決：把 `event.type` 收窄到 `agent-preset/selected` 需要 `SessionEventMap` 增補，而在 Client 程序裡載入它只有兩條路——引用 `dsh-agent-presets` 工程，那會把宿主的 `ctx.sessions` 合併拖進一個自己也發布同名服務的程序；或者用一次類型斷言繞過判別式。

**複用轉發的 `commands/change`。** 它是既有的目錄失效事件，但它是登錄檔級的、不帶工作階段、也與技能無關；用戶端會把每個工作階段的命令都重拉一遍，卻依然永遠刷不新技能目錄。

## 後果

轉發名單加入了 preset owner 的類型化事件，而每一份由 preset 決定的目錄從此有了統一的訂閱點：將來任何從組成派生的按工作階段介面，都在同一個訊號上失效，而不必再發明一個。owner 事件仍是落帳事實的第二次發布，因此將來若出現一條不落帳就重組的切換路徑，它將無人宣告。`ui-commands` 保持軟失效（已打開的選單不會變空），而 `ui-skill` 直接丟棄該項，因為技能目錄沒有「部分可服務」的狀態；在重拉視窗內打開的選單，那一瞬間顯示的是沒有技能，而不是錯誤的技能。

## 測試

`api-proxy-agent-preset.spec.ts` 斷言已提交的切換恰好轉發一次，並帶上工作階段與新 preset；`ui-agent-preset`、`ui-commands` 與 `ui-skill` 的 spec 斷言直接 Remote 訂閱會合並工作階段行或只重拉被重組的工作階段。`agent-preset-selection` web e2e 播種一個項目技能，並在 hero chip 應用 `minimal` 之後斷言 `/` 選單丟掉了 `compact`、`plan` 和該技能，同時保留宿主面的那幾行——這是面板跟隨組成的整裝應用證據。

同一條 e2e 也不再從序列化後的工作階段清單裡讀它的 staged-pick 斷言：被播種的工作階段同樣記錄著 `minimal`，子串匹配在切換落地之前就會透過。現在它按 id 尋址那個活躍工作階段。

## Related

第二次切換能否到達宿主是另一個缺陷，有各自的成因與修復：[工作階段行的標識判定](2026-08-10-session-row-identity-covers-the-preset.md)。在它落地之前，`agent-preset-selection.e2e.ts` 只能演練第一次切換——這裡的失效邊對方向無感，但它所回應的那次切換必須真的發生。
