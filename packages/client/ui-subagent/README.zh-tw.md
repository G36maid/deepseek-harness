# @deepseek-ai/dsh-client-ui-subagent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Web subagent 功能 owner：向 `conversation.session.header.actions` 貢獻可延遲載入展開的目錄樹，向工作階段編輯器鏈貢獻按原因區分的只讀替代呈現，並保留註冊到 `ctx.inputTriggers` 的既有 `@` 引用 source。

頁頭操作透過標準 `useSessions` 掛鉤讀取 `subagentsByParent` 與工作階段摘要。非空直接目錄到達後，其觸發程序會統計僅含 subagent 的完整後代譜系，在普通 fork 處停止，並在任一計入統計的後代處於 `running` 時顯示活動仍在進行。緊湊樹仍以直接目錄為權威依據：可繼續和 one-shot 行會顯示 mode、`running`／`inactive` 活動狀態和由日誌支撐的選填 title，尾隨列則在上行顯示提供方的持久化 token 用量總計，在下行顯示活躍輪次耗時。token 用量總計為四個互不重疊的 `tokenUsage` 桶之和。視覺耗時在不足一天時精確到秒，達到一天後則最多使用兩個相鄰單位——天／小時、近似月份／天或近似年份／月份——而懸停資訊與無障礙名稱會保留精確的天／小時／分鐘／秒數值。耗時會累加已完成的 `subagentTiming` 輪次，僅在執行中 child 存在未結束輪次時每秒遞增一次，並在 child 變為 inactive 後凍結；被中斷的未結束輪次以其同一切面的 `active.through` 為上界，絕不使用更新的工作階段中繼資料。沒有 label 的 one-shot 行會回退到其工作階段 id，而損壞、不受支援或不可用的行仍保持可讀但停用。每個健康行的 `hasChildren` 提示會在互動前決定是否顯示展開控制元件，因此已知葉子節點從不顯示箭頭；每層目錄僅在其中至少一個健康行是分支時才預留展開列，使完全不含分支的層級能從最前面的狀態標記開始。展開分支時，會立即為每個已知直接後代預留一行停用的載入行，隨後再用該 child 的權威目錄延遲載入結果替換這些佔位行。每個可見分支都會上報給執行時期，使成員幀只在樹正被消費的位置觸發去抖動刷新。選擇任意深度的條目都會使用該行的確切地址 `{parentSessionId, childSessionId, mode}` 呼叫 `SessionRuntime.openSubagent()`。元件區域性狀態負責樹的可見性、已展開分支、鍵盤焦點與執行中耗時時鐘。ArrowRight／ArrowLeft 展開和摺疊分支；ArrowUp／ArrowDown、Home、End 與 Escape 用於導覽或關閉樹；關閉後焦點返回觸發程序。樣式只使用 token。

one-shot child 始終選用只讀編輯器，並將 transcript（文字記錄）說明為已完成的執行記錄。可繼續 child 僅在其確切 parent 不可用且 child 未在執行時期選用只讀編輯器，並以文案說明復原路徑；此類 child 仍在執行期間，selector 會讓位給普通編輯器——其輸入區與 Send 操作被停用，但獨立的 Stop 保持可用，停止後只讀替代復原。確切 parent 存活時，可繼續 child 保留普通輸入 chrome，其工作階段透過 `subagent.prompt` 路由提示詞：child 執行期間輸入和 Send 保持可用，因為每條後續訊息都會進入 child 的 FIFO inbox，而獨立的 Stop 經由 `subagent.interrupt` 路由。本包絕不接收宿主上下文，也不呼叫面向模型的工具。目錄與編輯器行為由 [Web subagent 對話 Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) 與[當前輪次中斷 Agent Note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md) 規定。

普通側邊欄會省略帶 subagent origin 的工作階段行，因此 parent 頁頭目錄是它們的導覽入口。普通 fork 仍保留在側邊欄中。

`@` source 仍然刻意保持獨立且惰性。候選是從 `ctx.sessions.list` 零 RPC 得到的執行中 child；pick 會插入字面文字 `@label `，codec 投影為 `@label`。它不參與命令裁決，也不會把 label 解析成繼續執行地址。

## 模型體驗

### 使用者提示詞中的 subagent label 文字

#### 模型看到的內容

只有舊有 `@` 引用 source 會影響模型輸入：pick 的候選以字面文字 `@label` 進入普通使用者訊息，沒有專用內容區塊或宿主側解析。瀏覽目錄、導覽 child 與查看持久化 transcript 都不會新增提示詞 section；已接收的繼續互動內容會經宿主 subagent 配接器成為普通 FIFO 使用者訊息。

#### Token 影響

有條件且僅附加：字面 `@label` 或使用者後續訊息只會向對應的新使用者訊息增加 token。目錄與 transcript 操作增加零模型 token。

#### KV Cache 影響

僅附加。本包絕不改寫更早的請求 token。

## 已知限制與暫緩事項

- **目錄沒有持久化結果**：活動狀態與計時無法區分完成、失敗或取消，且 UI 不公開 Activation 身份；停止能力僅限編輯器上針對執行中可繼續 child 的當前輪次 Stop。
- **`@` 引用仍是顯示標題文字**：重複或改名後的 label 會有歧義，因此它們刻意不獲得繼續執行語義。
