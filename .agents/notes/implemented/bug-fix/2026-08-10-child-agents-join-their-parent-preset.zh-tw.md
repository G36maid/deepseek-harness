# Agent Note: Child agents join their parent's preset composition

Status: implemented

[English](2026-08-10-child-agents-join-their-parent-preset.md) | [简体中文](2026-08-10-child-agents-join-their-parent-preset.zh.md) | 繁體中文

## 問題

工具與提示段的可見性沿 `dsh-scope` 的父鏈繼承，而 agent 的 scope key 鑄造出來時沒有父。[逐工作階段 agent preset](../architecture/2026-08-03-per-session-agent-presets.md) 把所有面向模型的行搬到了 agent 平面，並讓 `AgentPresets.mount()` 成為綁定那條父鏈的唯一途徑——呼叫點在 api-proxy 的工作階段建立、復原與 fork 路徑上。兩個行程內 subagent 驅動透過 `applyChildComposition()` 組裝子 agent，而它只安裝了逐子 agent 的 persona 與工具限制，於是子 agent 的 scope 鏈長度為一，其登錄檔檢視表只能解析到全域性層。

在任何設定了 preset roster 的部署裡，那一層現在是空的：web-app 修補程式層停用了全部宿主平面工具行。因此一次性子 agent 抵達模型時工具為零，可繼續子 agent 只剩宿主平面的 `report`，兩者都不帶父方的 persona、工作區上下文、plan-mode 段與技能目錄。fork 路徑此前已因同一理由做過相同處理；委派沒有。

子 agent 的持久化 header 讓問題更進一步。`childSessionMeta()` 不記錄任何 preset，於是冷讀一個子工作階段解析到的是部署預設值——一套該子 agent 從未執行過的工具集，而這正是"模型可見 ⟺ 已記錄"規則要杜絕的情形。

## 決策

`AgentPresets.composeFrom(agentCtx, parentCtx)` 讓一個 agent 加入另一個 agent 已在執行的常駐組裝，並返回所加入的 preset id。它透過 `standingMountFor()` 定位父方的掛載——agent 的 key 認父到其 preset 的常駐 key，正是 `serviceForAgent()` 讀取的同一關係——再把子 agent 的 key 綁到同一個常駐 key 上，綁定控制代碼仍歸 roster 獨有的重鏈權威持有。未加入任何 preset 的父方不產生加入、也不報錯，那就是無 roster 的部署：它面向模型的行位於宿主組裝中，子 agent 已經能透過全域性層解析到它們。

這是認父而非掛載，兩處差別都要緊。子 agent 拿到的是父方那個確切的代際，因此父方啟動後被編輯過的組裝文件不可能把與父方歷史所產出時不同的另一個代際交給它，此後被刪除的 preset 也不可能讓一個父方仍在執行的子 agent 失敗。它還是同步的，這正是子 agent 建立視窗能夠使用它的前提——兩個行程內驅動都在同步的 `setup` 中完成組裝。

`applyChildComposition(childCtx, parent, composition)` 接收父方，並在應用子 agent 自身註冊之前完成加入。這個參數正是要點所在：它讓"組裝子 agent 卻不做該加入"在各呼叫點無法表達，而不是把第二個步驟留給每個新驅動去記住。`childSessionMeta()` 透過 `AgentPresets.composedPreset()` 記錄所加入的 id，該值從父方**活著的** scope 鏈讀取而不是從其 header 讀取，因為在空白期切換過 preset 的父方執行在更新的那份組裝上，而它的 header 仍寫著舊的那個。

`dsh-subagent` 以類型級匯入加選填 peer 相依性的方式，透過 `ctx.get('agentPresets')` 觸達 roster——這正是它對 `sandboxPolicy` 與 `approval` 已在使用的、有明確文件的機會性消費模式。

把父方的工具交給子 agent 之後，暴露出同一次 agent 平面搬遷引入的第二個缺陷：`ToolRuntime` 把**作用域級**註冊排除在限制之外、只過濾全域性層，因此當所有面向模型的行都變成祖先貢獻之後，子 agent 的 `toolFilter` 就不再約束任何東西——而且全域性層為空時，`restrict()` 會把收到的每個名字都判為未知並直接讓子 agent 建立失敗。豁免集合應當是作用域**自己註冊**的工具，而不是恰好位於全域性層的工具；後一種讀法只在這兩個集合重合時才成立。`view()` 現在過濾作用域繼承來的一切——全域性層與每個祖先層——只豁免它自己那層。這條自身層豁免是承重的而非順帶的：委派執行時期把子 agent 的 `report` 與結構化輸出工具註冊進子 agent 自己那層，而一個只點名子 agent 可用能力的過濾器絕不能把它回報所相依性的機制一並剝掉。

## 考慮過的替代方案

**在子 agent 的 setup 裡按 id 重新掛載父方的 preset。** 語義與機制兩方面都不成立而被否決。它會重讀 roster 並重新 stat 組裝文件，因此父方啟動後的一次編輯就會把子 agent 分叉到另一個代際，而此後被刪除的 preset 會讓子 agent 失敗、父方卻照常執行。`mount()` 還是非同步的，同步的建立視窗無法在不重構兩個驅動的前提下接受它。

**把子 agent 的 key 綁到**父方的** key 而不是常駐掛載上。** 否決，因為這改變了子 agent 繼承的內容：父方自己的 scope 層攜帶其逐 agent 限制，那些限制會就此與每個後代求交，而活得比父方久的子 agent 會掛在一個已 dispose 的 agent key 上。加入常駐掛載給到子 agent 的是父方的組裝，僅此而已。

**擴充可繼續 activation setup 登錄檔以覆蓋一次性子 agent。** 否決，因為該登錄檔的貢獻類型是同步的 `(childCtx) => () => void` 並帶有逐次安裝的撤銷，建模的是會來會走的部署能力，而 preset 加入是一次性認父、自身沒有撤銷可言。擴充它反而會讓任何繞過該登錄檔的驅動重新具備遺漏的可能。

**讓 `dsh-subagent` 匯入 `resolveSessionPreset` 並按解析出的 id 掛載。** 否決，因為這會給一個必須在沒有 roster 時也能工作的包引入硬模組邊，而且最終仍落回上述的重新掛載語義。

**過濾鏈上的每一層，包括作用域自身那層。** 否決，因為那會讓逐子 agent 的能力過濾器把該子 agent 的回報與結構化輸出工具一並刪掉——它們由委派執行時期註冊進子 agent 自己那層——於是一個點名"子 agent 可用哪些能力"的 `allow` 會讓它徹底無法回報。

**只修活著的加入，不動持久化 header。** 否決，因為那樣活著的子 agent 與冷讀同一個子 agent 會對"哪份組裝產出了這段歷史"給出不同答案——同一類缺陷，只是被搬了個地方而不是被修掉。

## 測試

`packages/preset/agent-presets/tests/mount.spec.ts` 用真實 fixture 組裝覆蓋該加入：子 agent 看到父方的工具與提示段、不會掛載出第二個代際、加入在父方 dispose 後依然成立（活得比父方久的後臺子 agent）、上報的 id 一致、沒有 preset 的父方不產生加入、以及無 scope 的上下文被拒絕。

`packages/core/tools/tests/scoped.spec.ts` 直接覆蓋該限制規則：子 agent 的過濾器能移除它從祖先作用域繼承來的工具、子 agent 自身的註冊在自己的過濾器下存活、祖先的限制仍作用於其內巢狀的每個作用域。

`packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts` 在一個不含任何面向模型行的宿主組裝上，透過 `startInProcessRun()` 斷言模型可見的結果：子 agent 自身請求中的 schema、父方的提示段、記錄下來的 header preset、施加在繼承來的 preset 工具之上的 `toolFilter`，以及在空白期切換過 preset 的父方——切換到**另一個** preset，這樣斷言才能區分"讀父方活 scope 鏈"與"讀父方建立 header"。

組裝記錄這一層用的是真實 shipped Web 組裝的 e2e，而不是無金鑰快照。本倉庫所有可執行 example 都不組裝 preset roster，因此該缺陷在快照 harness 裡根本不可觀察：要做快照場景，得先有一個既掛載 roster 又發起委派的 example。Web e2e 啟動的是真實的 `base` + `web-app` 修補程式層與兩個 shipped preset，這正是測試政策要求的組裝證據；Web 瀏覽器 lane 的 subagent golden 承載了可見後果——記錄了 preset 的子 agent 現在會顯示與其父方相同的 preset 徽標。

## 後果

委派現在的成本是每個子 agent 一次 scope 認父，再無其他——沒有額外的外掛程式實例、沒有 roster 讀取、沒有新的失敗模式。子 agent 的能力恰好等於父方的能力，減去它自己的 `toolFilter` 所移除的部分；逐 subagent 的 preset（"agent 類型"）仍未建置，那會是一個新的請求欄位，而不是對這次加入的改動。

`applyChildComposition()` 的形態變了，因此將來任何倉庫外的行程內驅動都必須提供父方。這是刻意付出的代價：此前的簽名允許呼叫方組裝出一個毫無能力的子 agent 而不報任何錯。

冷復原的可繼續子 agent 加入的是父方**當前**的組裝，而不是它自己 header 所記錄的那份。視窗很窄——父方必須先建子、保持空白、切換 preset，之後才喚醒它；駐留中的子 agent 不會重新加入，一次性子 agent 也不會復原——而替代方案更糟：按子 agent 自己記錄的 id 解析會重讀 roster，把這次認父刻意規避掉的"preset 已刪除"失敗模式又請回來。子 agent 的 header 仍記錄它啟動時的那份，因此這處分歧是可觀察的而非靜默的。

`ToolRuntime` 現在把限制的豁免集合讀作"該作用域自己註冊的東西"而不是"全域性層"，這在委派之外改變了一處既有行為：**祖先**作用域貢獻的工具現在會受後代過濾器約束，而此前只有全域性層的工具會。鏈上其餘部分的豁免不變——作用域自身的註冊仍在自己的過濾器之外，這正是委派執行時期所相依性的性質。
