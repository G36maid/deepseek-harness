# Agent Note: 行程內 subagent 策略繼承——子 agent 在父級的沙盒覆蓋項下啟動

Status: implemented

[English](2026-07-25-subagent-policy-inheritance.md) | [简体中文](2026-07-25-subagent-policy-inheritance.zh.md) | 繁體中文

## 問題

沙盒與審批覆蓋項都是按工作階段的日誌摺疊。行程內 subagent 會獲得一個新工作階段，因此 spawn 子 agent（代理）過去會回退到部署預設值，fork 子 agent 則只能看到其已完成輪次前綴中的切換。因此，委派可能放寬已經切換到 `read-only` 的父級。

## 決策

委派邊界在第一次 await 之前，經由共享的子 agent 輔助函式（`dsh-subagent` 中的 `captureDelegatedPolicyOverrides`／`appendDelegatedPolicyOverrides`）對 `sandboxPolicy.overrideOf(parent.session)` 取得快照；一次性驅動器與[可繼續啟動](2026-08-10-continuable-subagent-policy-inheritance.md)都會呼叫這些輔助函式。父級後續的切換屬於父級的未來；取消後重新委派會取得新快照。沙盒策略服務為選填，僅複製顯式工作階段覆蓋項，絕不複製部署預設值或一次性授權。審批策略不繼承：同一次捕獲會把每個子 agent 釘定為 `'never'`——[審批釘定決策](2026-08-10-subagent-approval-pinned-never.md)取代了本 note 原先的審批覆蓋項繼承。

每個捕獲值都會成為子 agent 工廠在未發布設定階段追加的一條帶來源標記的 `sandbox/mode` 或 `approval/policy` 事件。工作階段構造函式已將 `Session.firstLiveSeq` 固定為 fork 前綴的長度，因此繼承事實會排在 fork 歷史之後，在子 agent 公佈時進入遙測，同時讓 `SessionHeader.seedLength` 保持為此前綴的長度。因此，既有的末事件勝出摺疊會讓委派快照壓過過時的 fork 歷史，並讓子 agent 後續的切換壓過該快照。孫代 agent 會摺疊其父級已記錄的狀態，因此無需另一套繼承機制即可組合此規則。

普通的工作階段追加會在發布前校驗繼承事件，持久化層則在工作階段公佈時捕獲完整的未發布日誌。因此，任何已物化的子 agent 日誌都會在首批資料中存下繼承事件；不存在第二套策略儲存、schema 欄位或查詢索引。`source: 'delegation'` 標記讓審批敘述能夠區分繼承與子 agent 側的使用者切換。

### 被攔住的子 agent 會經歷什麼

受限子 agent 會得到普通拒絕標記，升級請求則被子 agent 釘定的 `'never'` 策略確定性拒絕；`subagent:delegation` 執行時期上下文聲明告知子 agent 上報限制而不是重試，由控制器持有的父 agent 可以放寬自己的工作階段後重新委派（[審批釘定決策](2026-08-10-subagent-approval-pinned-never.md)）。

## 考慮過的替代方案

- **通用的 `SessionHeader` 策略欄位**：不予採納。它們會在元資料中複製一項事件溯源事實，並要求貫穿核心工作階段類型、持久化後端、查詢索引、碰撞標識與每個策略消費端進行傳播。未發布設定階段的事件具備所需順序，並複用現有持久化儲存。
- **將新策略事實與構造歷史合併**：不予採納。`Session.firstLiveSeq` 會把完整的構造種子歸類為重播歷史，因此遙測會跳過僅屬於子 agent 的事實。未發布設定讓歷史與新事實留在該邊界各自原有的一側，無需再增加工作階段選項。
- **首個提示詞監聽器**：不予採納。儘管建立交易已經允許在發布前追加日誌，它仍會引入監聽器順序與更晚的時序邊界。
- **複製部署預設值**：不予採納。預設值仍由運維人員擁有且可能變化；未切換的父級不會記錄任何值，因此其子 agent 跟隨當前部署。
- **每次呼叫時沿 `parentSession` 即時解析**：不予採納。這會打破「兩個工作階段永遠看不到彼此狀態」的隔離不變數，要求父工作階段在子 agent 的整個生命週期內保持載入，還會讓父級在子 agent 執行途中做的切換追溯性地改變一個正在執行的子 agent。委派時快照纔是本設計的語義：子 agent 保持它被交付時的策略；取消後重新 spawn 即可拿到收緊後的策略。
- **強制使用 `'never'`**：本 note 當初不作為繼承行為採納，理由是強制值會排除未來的子 agent 應答器；該結論已被[審批釘定決策](2026-08-10-subagent-approval-pinned-never.md)推翻，現行理由歸其所有。把 ask 路由到根控制器需要父鏈所有權與發起 spawn 的 `callId`，仍按[審批 seam Agent Note](2026-07-06-approval-seam.md) 所述延期。

## 後果

- spawn、fork 和巢狀的行程內子 agent 會保留父級顯式的沙盒覆蓋項，並被釘定為 `'never'` 審批。聚焦測試套件證明真實檔案系統拒絕、過時 fork 優先級、委派時捕獲、即時事件邊界、預設值省略與上下文釋放。
- 無金鑰 headless 快照是組裝後應用層面的回歸測試：只有父級是 `read-only`，部署預設值是 `workspace-write`；若移除捕獲，子 agent 的持久化事件與被拒的磁碟寫入這兩項檢查都會失敗。
- 每次委派最多增加兩條僅日誌事件。兩個策略服務的選填 peer 類型由 `dsh-subagent` 擁有——其共享輔助函式持有 `ctx.get` 消費；未組合任一服務的組合保持原有行為。行程外子 agent 仍採用自身的部署策略，正在執行的子 agent 不跟隨父級後續切換。
