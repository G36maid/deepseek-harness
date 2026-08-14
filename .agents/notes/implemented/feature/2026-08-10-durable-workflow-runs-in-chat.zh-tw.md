# Agent Note: Chat 中的持久工作流程執行

Status: implemented

[English](2026-08-10-durable-workflow-runs-in-chat.md) | [简体中文](2026-08-10-durable-workflow-runs-in-chat.zh.md) | 繁體中文

## 問題

普通工作流程工具行擁有模型呼叫與最終工具結果，但這兩條記錄無法說明哪些成員真正開始、如何分組、各成員是完成、失敗還是取消，也無法說明行程停止時哪些工作尚未結束。即時 `workflow/*` 事件只存在於當前行程，因此刷新或稍後重新打開 Session 會丟失執行歷史。

Web Client 已經能夠從持久 Session 事件組裝由業務擁有的 Conversation Node。工作流程歷史因此需要：能夠把一次已接受執行關聯到呼叫 Session 的生產方、作為前綴也始終有意義的最小持久協議，以及不奪走現有工具卡所有權的獨立 renderer。

## 決策

`dsh-tool-workflow` 把每個已接受的頂層執行投影到呼叫 Agent 的 Session。`tool-workflow/run-start` 記錄穩定 `runId` 與已校驗名稱；匹配的工作流程成員事件記錄成員序號、精確標籤、選填精確階段、子 Session id 與結果；只有在結果已取得且 `run.dispose()` 完全靜止後，`tool-workflow/run-end` 才記錄停止原因。巢狀 transport 執行照常執行，但不會寫工作流程記錄，因為它不擁有獨立 Chat 行。

記錄只供觀察。任一次 Session append 首次失敗後，本執行會停止所有後續寫入、只記錄一次告警，並且絕不改變取消、結果對映或 dispose。每種失敗位置都留下空記錄或合法連續前綴：已開始執行可以缺少後續成員或執行終點，已開始成員也可以缺少成員終點。包 invariant 會在冷載入與即時 append 時拒絕重複執行 start、無效或複用的正成員序號、無配對或重複成員 end、仍有開放成員時結束執行，以及執行結束後的任何更新。

workflow 包透過 `@deepseek-ai/dsh-workflow/types` 提供瀏覽器安全的執行與觀察詞彙；包含活躍 `Agent` 的請求和控制控制代碼繼續只屬於 Host。`@deepseek-ai/dsh-tool-workflow/types` 擁有四類 Session 事件。Client 只匯入這些類型 face，因此 Host 與 Client TypeScript 程序共享持久合約，而不會合並 Host Cordis Context。

`ui-workflow-run` 註冊一個 `workflow-run` Conversation Definition 和一個 keyed Chat renderer。每條事件都能獨立給出同一 `runId`；run-start 初始化 State，後續事件按日誌順序更新；只有 update 的歷史尾頁會保持 pending，直到 prepend 補入唯一 start。最終節點保留引擎擁有的 key，並以 run-start 錨定在原工具呼叫之後，從執行中到終態始終保留同一個 React 父級。

renderer 為每一層分配不同視覺職責。執行使用 32 畫素 module-platform 背景行，常駐向右／向下 chevron，並以內聯狀態點加狀態文字表達結局，不使用膠囊。階段使用 32 畫素 disclosure 行，在可伸縮主區顯示標題與成員數，在固定尾部精確顯示聚合狀態且不重複狀態點。成員使用 16 畫素狀態點槽、可省略名稱區和固定 64 畫素狀態列。階段只在成員真正開始時出現，並按精確階段字串分組；欄位預設與空字串保留不同身份和本機化名稱。成員結帳只改變狀態，不刪除或重排成員。所屬 Turn 或 Step 關閉時，缺少執行或成員終點會顯示為已中斷；存在持久終點時仍以它為權威。[狀態驅動程式的工作流程 disclosure](2026-08-11-workflow-run-status-driven-disclosure.md)擁有這些事實變化時執行與階段內容的可見性。

導覽從兩個當前權威派生，不寫入持久記錄。只有持久成員狀態仍為執行中，且當前普通 Session 清單包含同一 id、`origin: 'subagent'`、`parentId` 等於當前父 Session、`running: true` 時，成員行纔可互動。帶底線的成員文字是唯一可見提示；鍵盤聚焦時，名稱區顯示 2 畫素 business-primary 焦點環，固定狀態列繼續只表達生命週期，而不寫動作說明。renderer 只調用注入的普通 `sessions.open(id)` 回呼。僅地址化、遠端、父級不符或終態成員繼續可見，但保持靜態。

[七狀態 Figma 參考](https://www.figma.com/design/tguwzZRmHCjbq58mfsqT0M?node-id=5-2)固定執行展開／收起、完成歷史／展開、失敗與取消、復原後中斷以及暗色窄列的資訊層級。倉庫的 `DisclosureRow`、`StateDot`、圖示、語義 token 和 keyed-node 行為仍是實作權威；參考稿不引入執行時期欄位或狀態 owner。

## 驗證

包測試覆蓋頂層與巢狀准入、零成員與並行執行、先 dispose 後寫終點的順序、四個 append 失敗前綴，以及冷／即時 invariant 拒絕。Conversation 測試比較完整 replace、只有 update 的 prepend 和即時 append，並覆蓋精確階段身份、終態與中斷狀態、disclosure 狀態、清單事實導覽、HMR 移除與重新註冊。shipped Web replay 複用現有工作流程父／子模型 fixture，驅動程式真實 worker、spawn provider、Session 持久化、瀏覽器 bundle、執行中子級導覽、終態保留、原工具行並存、暗色窄列 token 與刷新重建。

## 曾考慮的替代方案

**把工作流程內容附加到現有工具卡。** 拒絕，因為 `ui-tool` 與工具定義擁有該行的展示和互動。工作流程專屬 appendix 會耦合兩個獨立 keyed 業務生命週期，並復原已移除的工具後附加模型。

**持久化伺服器端 projection 或新增 workflow wire 通道。** 拒絕，因為 Session 事件已經提供持久化、即時傳輸、分頁和 gap repair。另一個 service、cache 或 transport 會複製同一事實並建立第二個生命週期 owner。

**展示聲明階段，或從指令碼文字推斷靜態工作流程圖。** 拒絕，因為只有成員 start 事件能證明工作真正發生。`meta.phases`、`phase()` 敘述、分支和指令碼文法都不是一次執行的權威拓撲。

**保留終態子級導覽。** 拒絕，因為工作流程記錄證明歷史身份，不證明當前可訪問性。冷 Session 或遠端 Session 的打開需要獨立目錄與授權合約；本節點不作這種承諾。

## 後果

工作流程進度與父對話保存在同一日誌中，能跨刷新與行程復原；執行所有權仍屬於工作流程 run holder，原工具卡保持不變。持久協議增加四類小事件和一個包所有的 invariant；首次寫入失敗會刻意犧牲後續觀察，而不是犧牲工作流程正確性。瀏覽器 State 按已載入視窗派生，狀態驅動程式的 disclosure 生命週期把復盤選擇留在本機，導覽會隨清單事實消失。設計只展示真實執行成員與狀態，並放棄靜態圖、輸出、日誌、控制操作和終態成員打開。
