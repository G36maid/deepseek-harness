# Agent Note: Web agent 獲得顯式執行時期上下文

Status: implemented

[English](2026-07-28-web-agent-runtime-context.md) | [简体中文](2026-07-28-web-agent-runtime-context.zh.md) | 繁體中文

## 問題

CLI（命令列介面）共享 base 設定了空的部署 persona，Web overlay 沒有替換它，而 Web 啟動器既未新增原始碼提示詞段，也未新增互動介面提示詞段。工作階段 header 會記錄工作目錄，供工具與持久化使用，但模型提示詞既不說明該目錄，也不標識 DeepSeek Harness Web GUI。因此，當用戶提出「修改這個頁面的主題」之類的請求時，即使使用者指的是承載當前工作階段的 GUI，agent（代理）也會在所選項目中搜尋一個未明確說明的頁面。

## 決策

Web profile 會組合 `dsh-base` 與 `dsh-web-app` 兩個組合包。Web 組合包提供一段簡潔的編碼 agent persona，其中包含解析後的 `{{model}}` 與工作階段 `{{cwd}}`；當 `surfaceContext` 為 true 時，其 `web-runtime` 外掛程式會新增 `app:web-surface` 提示詞段。掛載 profile 設定樹前，`dsh web` 別名會讀取組合後的同一項設定，並且僅在啟用介面上下文時安裝現有的 `harness:source` 提示詞段。無頭組合包和擁有完整提示詞的 profile 都會設定 `surfaceContext: false`，從而抑制 Web 提示詞與受管 shell 事實；Web 別名也會抑制原始碼提示詞段，而無需檢查 overlay 路徑。每項已掛載的提示詞貢獻仍會在 agent loop（代理循環）等消費端寄出 request header 前啟用。原始碼提示詞段的措辭，以及其中不得從一條路徑推斷另一條路徑的警告，均由另行記錄的[原始碼 checkout 與工作目錄區分決策](2026-07-30-source-checkout-workdir-distinction.md)負責。

Web 提示詞段把未限定的「這個頁面」「這個 GUI」或「這個應用」解釋為 DeepSeek Harness Web GUI。同時，它會明確說明瀏覽器不會隱式提供 DOM、路由或截圖上下文，使模型能夠識別產品，但不會聲稱掌握未收到的視覺狀態。組裝後的文字會記錄在 `request/header` 中，從而保持「模型可見內容必須有日誌記錄」這一不變數。

## 驗證

Web 執行時期單元測試會固定啟用和停用 `surfaceContext` 時的行為，Web 別名單元測試則會固定組合後設定行對原始碼提示詞段的預設啟用與顯式停用門控。無金鑰的 Web fresh-round-trip 場景會啟動已交付的 base 與 Web 組合包，透過 HTTP／SSE（Server-Sent Events）應用執行一個真實工作階段，並在規範化原始碼路徑與工作目錄後對系統提示詞前綴生成快照。該快照按請求順序固定 harness 身份、原始碼 checkout、Web 介面定位，以及解析後的編碼 agent persona。Core Web 快照會應用 RL overlay，並固定不含原始碼提示詞段或 Web 提示詞段的完整系統提示詞。

## 考慮過的替代方案

**每次提示詞都發送 URL、DOM 或截圖。** 本次故障只需要穩定的產品定位；當前根 URL 無法標識所選元件，訊息約定中也不存在視覺捕獲內容。新增動態頁面狀態需要另行設計可記錄的模型輸入，不屬於本次修復的隱含範圍。

**要求工作階段 Workspace 必須是 harness checkout。** Workspace cwd 是使用者任務的目標，可以合理地指向空項目或其他倉庫。將其與應用原始碼位置混為一談會破壞這一邊界，並且仍無法消除已安裝版本或外部啟動工作階段中的歧義。

**把 Web 文案放入全域性 harness 身份。** `dsh-system-prompt` 還服務於 TUI、ACP（Agent Client Protocol）、SDK 和不在瀏覽器中執行的自訂部署。該介面事實應由組裝 Web 應用負責。

**為所有 CLI 介面修改現有原始碼位置提示詞段。** TUI 也複用原始碼位置提示詞段，而該段只陳述 checkout 事實。單獨保留 Web 介面定位可以維持這份可複用約定，避免錯誤地告訴無頭或終端機 agent 它們正處於瀏覽器中。

## 影響

常規 Web 請求會增加一段較短且穩定的提示詞前綴；部署此變更時，模型提供方的前綴快取可能失效一次。agent 可以區分 GUI 原始碼 checkout 與所選 Workspace，並且無需再經過一輪澄清即可解析對當前應用的一般指代。對特定視覺狀態的指代仍受「無 DOM／無路由／無截圖」這一顯式邊界約束，必要時仍需使用者提供路徑、描述或附件。擁有完整提示詞的 profile 可以透過 Web 執行時期的組合設定選擇退出，而無需檢查啟動器路徑。
