# @deepseek-ai/dsh-client-ui-skill

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

skill（技能）呼叫 source 的瀏覽器端：把 `/` 觸發的 `skill` source 註冊進 `ctx.inputTriggers`。普通工作階段的候選來自 `skill.list` RPC，以每次呼叫的 `ClientSessionContext` 投影中的 `{sessionId}` 尋址，host 從工作階段 header 解析 `cwd`。宿主提供每一個使用者可呼叫的 skill；`modelInvocable: false` 的條目（即 `disable-model-invocation` skill，此路徑是其唯一入口）會以當前語言把僅限使用者標記作為描述前綴帶上。由目錄尋址的可繼續 subagent 在用戶端解析為沒有 skill 候選，因為現有 skill RPC 要求工作階段已掛載；查看其持久化歷史不得啟用它。目錄按普通工作階段快取，拉取走 single-flight；scope 建立時的 `warm` 掛鉤預熱該工作階段的快取項，轉發的 owner 事件 `agent-preset/selected` 丟棄該工作階段這一項（目錄屬於 preset，而空工作階段可能在預熱之後才切換），`connection/reset` 清空全部快取。結果按 `startsWith(query)` 過濾。

pick 會落下字面文字 `/name `，寄出的提示詞中也是同一段字面文字（[slash 管線 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)）——本 source 不實作任何裁決掛鉤，也沒有引用 codec。確定性在宿主側：pre-step 手勢邊界（`dsh-tool-skill`）識別使用者訊息中任意位置、以空白為界、指名使用者可呼叫 skill 的 `/name` token，並為每個入口注入算繪後的 `<skill_content>`，因此選單 pick、手動鍵入的 token 與 TUI/ACP（Agent Client Protocol）提示詞都以同一種方式載入 skill。與宿主命令同名的名稱仍解析為命令：裁決在用戶端把該行認領走，它根本不會成為提示詞——這是有意的優先級，與同類產品一致。清單 RPC 使用外掛程式註冊時捕獲的根上下文連線——source 絕不從每次呼叫的參數上讀取服務；草稿 chip 視覺由 `lexicon` 掃描派生。

`skill.list` 失敗時 `candidates` 拋出例外，slash 殼層記錄日誌，並靜默丟棄該選單組——選單只顯示 pending／ready 狀態。

`/client` 匯出介面只有外掛程式主體（`apply`／`inject`）；source 對象是註冊 effect 的內部實作。

## skill 工具行

瀏覽器外掛程式還會把 `skill` wire 名稱註冊進 `ui-tool` 的 keyed `tool.call.toolview` slot。收起的行以與 Bash 行相同的中性視覺層級顯示 14 畫素的 skill 文件與閃光組合圖示、`Skill` 標題、分隔符和請求載入的 skill 名稱；執行中的工具呼叫帶有 transcript（文字記錄）的掃光效果，失敗時用錯誤首行替換名稱，中斷的工具呼叫則使用警告狀態。已結帳的行以整行作為展開入口，展開後顯示一個尺寸受限的 `Instructions` 卡片，其中原樣呈現持久化的工具輸出；可用時還會提供標準執行軌跡的 `Inspect` 入口。該行的名稱、生命週期和正文只派生自 `ui-tool` 提供的凍結的工具呼叫／工具結果切片，絕不讀取當前 skill 目錄，因此即使已安裝的 skill 或其描述發生變化，重播仍保持穩定。

## 模型體驗

### 使用者顯式 skill 呼叫

#### 模型看到的內容

使用者訊息原樣到達模型，字面文字 `/name` 也包含在內。隨後宿主的 pre-step 邊界（`dsh-tool-skill`）把規範的 `<skill_content>` 塊——與 `skill` 工具返回的 `renderSkillContent` 輸出相同——作為注入的指令上下文追加在該步驟各項注入的末尾，最貼近模型的回答。載入是確定性的：模型無需被要求呼叫 `skill` 工具就能收到完整正文，目錄也會告訴它不要重新載入已內聯注入的 skill。

#### Token 影響

一次呼叫會把算繪後的 skill 正文作為注入上下文加進該輪次——成本與模型經由工具載入該 skill 相同，只是無條件付款，而非由模型自行裁量。瀏覽選單和拉取候選不會增加任何模型 token。

#### KV Cache 影響

僅附加：注入的訊息落在可複用歷史前綴之後。該包絕不改寫較早的請求 token。

## 已知限制與暫緩事項

- **僅含工具結果的 history 頁使用通用行**：鍵控分派要求配對的工具呼叫位於執行時期視窗內；分頁將工具呼叫留在視窗外時，工具結果沒有工具身份。這項用戶端呈現功能不會為了復原該身份而擴充 history 協定約定。
- **文字是唯一依據**：引用是普通的草稿文字；手動鍵入的相同 token 就是同一個引用，宿主手勢邊界評判的是寄出的文字，而不是選單互動。chip 視覺由 lexicon 掃描派生；沒有 occurrence 身份、位置跟蹤，也沒有提示詞協定上的結構化引用載荷（兩者都是臺帳事項）。
- **預熱落定之前打開的選單**：在那次擊鍵下不顯示 skill 候選；下一次擊鍵會重新輪詢已落定的快取。
