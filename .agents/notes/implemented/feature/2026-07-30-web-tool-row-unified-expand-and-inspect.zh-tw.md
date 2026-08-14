# Agent Note: Web 工具行統一展開互動與 trajectory Inspect

Status: implemented

[English](2026-07-30-web-tool-row-unified-expand-and-inspect.md) | [简体中文](2026-07-30-web-tool-row-unified-expand-and-inspect.zh.md) | 繁體中文

## 問題

聊天檢視表的工具行互動已經分裂成多種方言：ToolRow 透過前導圖示切換展開、且僅限有 args body 的呼叫，bash 示例有自己的一套展開方式，todo / ask-question 行只能展開原始 args，單文件工具完全不可展開，而呼叫的 OUTPUT 只能透過詳情面板查看。失敗的 bash 命令（exit≠0 但結帳為 `isError:false`）在摺疊行上沒有任何失敗訊號。此外聊天行沒有跳轉到 trajectory 記錄的入口，且 chat → trajectory → chat 切換會丟失閱讀位置（標籤環會解除安裝非活躍檢視表）。

## 決定

**所有可展開工具行共享同一互動——整行即開關（點擊 / Enter / 空格），圖示 hover 時漸變為 chevron 預覽——以及同一展開體：帶 IN/OUT 側欄標籤的卡片，各分區獨立滾動上限；hover 顯示的 Inspect 膠囊透過 store 的一次性交接跳到該呼叫的 trajectory 記錄；聊天檢視表用記憶體態的按工作階段 Map 在檢視表切換間保留語義閱讀位置。**

- `toolRowModel` 在 args 之外同時派生結果材料：`output`（`resultText` 拍平邏輯從 DetailsPanel 移入 contract）和 `errorSummary`（失敗首行，作為摺疊摘要並以錯誤色顯示）。有 body、output 或 terminal 材料的行即可展開；行本身是開關（`role="button"`、`aria-expanded`），檔案路徑摘要透過 `stopPropagation` 保持獨立連結。
- 展開卡片（figma 1249:35657）是 IN/OUT 分區列：每個分區是獨立滾動區（max-height 150px），側欄標籤 sticky 固定，l2 分隔線橫貫整卡寬度。Think 的推理文字和 run_code 的 CodeBlock 保持非卡片體；上下文注入複用此行並以無標籤的 `plainBody` 卡片展開。
- `terminalFailed` 讀取已結帳 terminal 卡片的退出狀態，讓 BashRow 和 GenericToolCard 把失敗命令顯示為行的紅色狀態點——這是摺疊行唯一的失敗訊號，因為呼叫本身結帳為 `isError:false`。
- TerminalBlock 的橫幅並入同一閱讀模型：與卡片共用同一表面（不再用 banner token），與正文之間是 l2 細線，命令列上限 150px 內部滾動，複製/狀態控制元件 sticky 且頂對齊第一行提示符。
- Inspect：`ToolCallOwnerProps.inspect`（無呼叫身份的行不提供）在展開體左下角的正常版面配置流中渲染膠囊，hover 到工具呼叫的任意位置時顯示。點擊將 `{ callId }` 寫入 chat store 的一次性 `inspect` 欄位並切換到 trajectory 檢視表；TrajectoryTable 找到記錄、打開其摘要，並透過清空欄位確認。
- 滾動保留：每次非貼底滾動時，聊天檢視表把 `{ anchorKey, anchorTop, scrollTop }` 保存到 apply 作用域的按工作階段 Map，並以 `chatScroll` 暴露；重掛載時先用 `scrollTop` 到達近似視窗，再按穩定 node／call 錨點的矩形差值校正，因此寬度重排後仍把同一閱讀行保持在原位。包括「回到底部」在內的每條貼底路徑都會在切換 tab 或工作階段前同步清除該項。Map 仍刻意不持久化——新頁面載入保持打開即貼底的默認行為。

## 曾考慮的替代方案

**保留前導圖示開關和各註冊方自有的展開方式。** 否決：三個表面已經分化；註冊方姿態（bash 示例本機復刻 CSS）意味著除非互動約定本身統一且足夠小——整行開關加 hover 預覽——否則漂移會永久存在。

**透過 URL 或 trajectory 檢視表 prop 傳遞 Inspect。** 否決：檢視表環經由 slot 登錄檔渲染，兩個檢視表沒有可攜帶 prop 的共同父級；chat store 本就跨越該邊界，一次性欄位讓交接具備重播安全性（欄位出現之前的持久化快照以 `?? null` 復水）。

**持久化聊天滾動偏移。** 否決：把幾天前的偏移復原到已經成長的工作階段裡讀起來像 bug；記憶體 Map 把記憶精確限定在會丟位置的檢視表切換場景。

**從詳情面板的材料為每行單獨取展開 OUTPUT。** 不必要：已結帳結果節點本就在快照的凍結呼叫切片上，contract 層的 `resultText` 拍平讓行和麵板共用一份派生。

## 後果

ui-tool 內建檢視表都能就地檢查輸入與輸出，詳情面板和 trajectory 仍是深查介面。共享 `ToolRow` 互動是 ui-tool 內部實作；外部原子檢視表接收 `ToolCallViewProps`，可以透過自己的 chrome 暴露其中的 `inspect` 回呼。bash 檢視表保留獨立 CSS，因此未來互動變化仍需顯式同步。`--dsw-font-markdown-code-block-small`（12/18）是手工補充的 token，待設計平臺匯出後替換。web-cordis 的 `distIndex` 修復（純拼接而非 URL.pathname）解除了含空格 cwd 下預覽無法啟動的問題。
