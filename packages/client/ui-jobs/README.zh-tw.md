# @deepseek-ai/dsh-client-ui-jobs

[English](README.md) | 繁體中文

Web 背景工作特性的歸屬方：向 `conversation.session.header.actions` 貢獻一個條目，列出當前工作階段可見的 `ctx.jobs` 記錄。資料完全來自 [`dsh-client-runtime`](../runtime/README.md) 從 `session/jobs` 幀摺疊出的 `jobsBySession` 清單映像檔，因此本包不發任何 RPC，除彈層開合外不持有任何狀態。

只有當工作階段至少有一個任務時才渲染觸發器，普通對話不會因為一項未被使用的能力而長出控制元件。角標計數為 `running` 加 `stopping`，為零時省略，這樣只剩已完成任務的工作階段保留一個安靜的歷史入口，而不是宣告一個「零」。彈層是一個扁平清單：活躍行在前按 `startedAt` 升序，隨後終態行按 `finishedAt` 降序；毫秒相同的並列按啟動順序打破，宿主的 map 迭代順序永遠不參與決定。一行顯示生產者 kind、label、狀態標記、生產者一旦給出 `detail` 就取代通用狀態詞的那段文字，以及已耗時。該耗時在活躍時每秒推進，並在 `finishedAt` 凍結；只有當打開的清單裡確實有會動的東西時時鐘才執行。缺少 `finishedAt` 的終態行讀作零而不是負數，超過一小時的耗時停留在小時單位，不會長出任何生產者目前都到不了的「天」詞彙。

終態行保持可見並弱化，直到登錄檔在 owner 銷毀時把它們丟掉。它們本就在快照裡，失敗任務的 `detail` 是其失敗唯一可讀之處，在這裡過濾掉它們是輸出與中斷兩期要推翻的工作。因此一個執行中的一次性後臺 subagent 會同時出現在這裡和 [subagent 目錄](../ui-subagent/README.md)裡：目錄負責進入子工作階段的 transcript，而這個清單是將來中斷能力唯一可能附著的控制代碼。

Escape 關閉清單並把焦點交還觸發器，在其外部按下指針同理。最後一個任務消失時先關閉清單再解除安裝控制元件，焦點因此不會從一個被移除的節點上憑空消失。樣式只用 token；文案走本包自己的 `job` locale 命名空間。行為由 [Web 背景工作展示 Agent Note](../../../.agents/notes/implemented/feature/2026-08-08-web-background-job-display.md) 規定。

## 模型體驗

無，因為本包為人類渲染宿主計算出的登錄檔狀態，不觸及 prompt、訊息、schema、流或工具結果。模型對同一批任務的視角仍屬於 [`dsh-tool-jobs`](../../jobs/tool-jobs/README.md)。

#### KV Cache effect

無；本包從不組裝或傳送 provider 請求。

## 已知限制與暫緩事項

- **行是隻讀的** —— 任務的流式輸出與人類發起的中斷是各自獨立的階段。中斷還額外欠一個 seam 目前沒有回答的、面向模型的決策：`kill()` 會把終態投遞標為已上報，所以照當前契約寫出來的中斷會讓模型一直以為它的任務還在跑。
- **清單不等於登錄檔自己的集合** —— 它展示的是「一個工作階段透過線路檢視表能看到什麼」，所以別的工作階段擁有的任務在這裡永遠不出現；而行程重新啟動會清空清單，transcript 裡啟動這些任務的 `run_in_background` 卡片卻還在。無主任務（在沒有活體 `Agent` 時啟動的）是反過來的情形：它會進入每一個工作階段的清單，與 `list(caller)` 對每個呼叫方的報告一致。
