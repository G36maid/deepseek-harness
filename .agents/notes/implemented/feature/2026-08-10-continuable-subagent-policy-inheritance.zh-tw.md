# Agent Note: 可繼續 subagent 策略繼承——持久化子日誌擁有委派時快照

Status: implemented

[English](2026-08-10-continuable-subagent-policy-inheritance.md) | [简体中文](2026-08-10-continuable-subagent-policy-inheritance.zh.md) | 繁體中文

## 問題

自[行程內策略繼承決策](2026-07-25-subagent-policy-inheritance.md)以來，一次性行程內驅動器一直會把父級的沙盒／審批覆蓋項注入其子級，但可繼續路徑從未這樣做：`SubagentContinuationManager` 的物化只應用子級組合與 Activation（啟用）設定登錄檔。默認組合包把兩個委派工具都設定為 `backgroundMode: continuable`，因此在默認部署中，每個後臺子 agent（代理）都靜默回退到部署預設值：切換到 `danger-full-access` 的父級產出的子 agent 卡在 `workspace-write`，每次工作區外操作都會觸發審批提示；父級無人值守的 `'never'` 審批立場也退回為發起提示的行為（[dsh-external/issues#334](https://github.com/dsh-external/issues/issues/334)）。

## 決策

捕獲／追加這對函式從一次性驅動器移入該 seam 的共享子 agent 模組（`dsh-subagent/src/child-agent.ts`），即聲明的共享子級組合唯一歸屬之處：`captureDelegatedPolicyOverrides(parent)` 透過選填的 `ctx.get` 對 `sandboxPolicy.overrideOf(parent.session)` 建立快照，並把子級審批策略釘定為 `'never'`（[審批釘定決策](2026-08-10-subagent-approval-pinned-never.md)），`appendDelegatedPolicyOverrides(childSession, overrides)` 則追加 `source: 'delegation'` 事件。一次性驅動器與繼續執行管理器都呼叫它們，因此兩條路徑不會出現偏差。

`startContinuable` 在其第一次 await（`prepareContinuable`）之前完成捕獲，沿用與一次性路徑相同的「父級後續切換屬於父級的未來」邊界。快照放在 `MaterializeInputs.create` 中傳遞，因此只有全新物化會在未發布的設定階段、排在任何 fork 種子之後追加這些事件。冷復原（cold resume）不傳入 `create` 輸入，也不追加任何內容：持久化的子日誌已經攜帶委派事件，而重播該日誌本身就是狀態。子 agent 的生效策略由持久化子日誌擁有，而不是當前 Activation，也不是發起復原的父級，因此父級在駐留紀元（residency epoch）之間的切換絕不會追溯性地改變一個持久化子 agent。

## 考慮過的替代方案

- **一項 Activation 設定登錄檔貢獻**（`registerContinuableSetup`）：不予採納。貢獻只接收子級上下文，因此無法在委派邊界捕獲父級的覆蓋項；該登錄檔在冷復原與全新建立時都會應用，會導致重複追加或重複捕獲；而且沒有任何機制把貢獻的捕獲綁定到 start 呼叫的同步前綴，await 前捕獲的保證會因此丟失。
- **在冷復原時重新捕獲父級覆蓋項**：不予採納。復原的子 agent 會隨父級後續切換靜默改變策略，這會破壞委派時快照的語義，並讓生效策略取決於復原時機而非子級自身的日誌。希望復原的子 agent 採用新策略的父級應重新委派。
- **讓繼續執行管理器匯入一次性驅動器的內聯邏輯**：不予採納。Service Definition 包不能相依性自己的提供方包，而在 `continuation.ts` 中複製捕獲／追加這對函式會招致偏差；`child-agent.ts` 已經承載其餘每個共享組合步驟。
- **把這些事件寫入描述符種子輪次**：不予採納。種子為每個呼叫方組裝時，捕獲值尚不可知；而且一次性路徑的先例已經確立：在未發布的設定階段追加，纔是把繼承事實排在 fork 歷史之後、同時保持 `firstLiveSeq` 不變的順序。

## 後果

- 默認組合包的後臺委派（`backgroundMode: continuable`）現在會繼承父級顯式的沙盒覆蓋項，並把子級釘定為 `'never'` 審批；未組合任一策略服務的組合保持原有行為。
- `dsh-subagent` 新增針對 `dsh-sandbox-policy` 與 `dsh-user-approval` 的選填 peer 類型（即一次性驅動器所用的 `ctx.get` 模式）；`dsh-subagent-in-process-driver` 完全移除自己的策略服務 peer 與類型匯入，委託給共享輔助函式。
- 可繼續測試套件（`packages/subagent/subagent/tests/continuation-inheritance.spec.ts`）鎖定全新啟動的種子寫入、await 前捕獲、預設值省略、冷復原快照穩定性與 fork 種子優先級；ACP 快照場景 `subagent-continuable-inheritance` 經組裝後的應用鎖定子級的委派事件與只讀執行時期上下文，移除捕獲時即失敗。
- 行程外提供方（`acp`、`dsh-sdk`、`claude-code`、`codex`）不支持可繼續子 agent（沒有 `prepareContinuable`），其一次性子 agent 保留自身的部署策略（`inheritsParentContext = false`）；跨行程策略傳播仍不在範圍內。
