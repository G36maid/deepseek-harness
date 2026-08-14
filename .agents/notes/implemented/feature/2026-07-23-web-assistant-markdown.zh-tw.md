# Agent Note: Web 對話中安全的 assistant Markdown

Status: implemented

[English](2026-07-23-web-assistant-markdown.md) | [简体中文](2026-07-23-web-assistant-markdown.zh.md) | 繁體中文

## 問題

Web 對話透過工作階段事件、歷史重播與流式累積保留 assistant Markdown 源文字，但其最末端的文字原語會按字面渲染源文字。若修改共享原語，使用者訊息與 steering（中途引導）訊息也會被格式化；若在執行時期中解析，則會把呈現狀態混入不相依性 React 的工作階段投影。

## 決策

`@deepseek-ai/dsh-client-ui-primitives` 匯出 `MarkdownText`，用作不受信任的 assistant 文字渲染器；`ui-conversation` 僅為 assistant `text` 塊選擇該渲染器。已完成的歷史訊息、流式輸出尾部與被中斷的部分輸出已經共用 `AssistantMarkdown`，因此無需更改事件或快照，它們便會採用同一渲染器。使用者訊息與 steering 訊息繼續使用 `MessageText`，並保持按字面渲染。

`MarkdownText` 以 `mdast-util-from-markdown` 加 GFM micromark 擴充解析，並經包內自有渲染器渲染 mdast 樹，輪次流式輸出期間增量解析（[增量 AST 渲染器 Note](../architecture/2026-08-06-web-markdown-incremental-ast-renderer.md) 擁有該機制及其 DOM 一致性約定）。它覆蓋 CommonMark 塊，以及 GFM 表格、任務清單、刪除線與自動連結，且不解析原始 HTML。一個 micromark attention 擴充複用 CommonMark resolver，同時允許至少兩個星號組成的連續序列在 Unicode 標點後閉合，前提是其後緊鄰 CJK 文字。這一例外涵蓋流式輸出期間與完成後無空格 CJK 文字中以標點結尾的粗體；單星號強調、緊鄰非 CJK 文字的情況、已轉義源文字、程式碼與數學公式仍沿用上游解析行為。圍欄程式碼經共享的 `CodeBlock` 路由；該元件用用戶端的 shiki 單例（`--shiki-*` token）高亮已註冊文法，否則回退為純等寬文字。輪次流式輸出期間，圍欄停留在純文字分支，以免每收到一個區塊就對成長中的圍欄重新分詞。

視覺間距、表格、連結、引用塊、行內程式碼與程式碼塊外框遵循 deepsuite `@deepseek/md`（`markdown.css` / `code-block.css`），並使用同一套 `--dsw-alias-markdown-*`、`--dsw-font-markdown-*`、`--dsw-alias-border-l*` 與 `--dsw-alias-label-*` token。連結使用 `--dsw-alias-state-business-primary`（deepsuite 的樣式表使用 `--dsw-alias-brand-text`，僅在 newDesign 下為藍色；design-platform 將 brand-text 保持為近黑色，此處不做重新調色）。當單個行內程式碼 token 完全由絕對 HTTP(S) URL 構成時，其程式碼外框會包含一個與普通連結相同、可透過鍵盤聚焦的安全外鏈錨點；埠、路徑與查詢文字保持不變，而命令、非完整 URL、其他 scheme 與圍欄程式碼仍不會成為連結。`CodeBlock` 提供語言橫幅與複製控制元件（`复制` / `复制成功`）。已完成的文字透過定稿文法的數學擴充渲染 KaTeX；`mathCompatibility` 將 `\(...\)`、`\[...\]` 和塊級同一行 `$$...$$` 對映為同一套標準數學 AST 節點。這是一層小範圍的解析器相容層，不是正則重寫，也不修復格式錯誤的模型輸出。流式輸出在完成前保持按字面渲染，避免不完整公式閃現錯誤。引用膠囊、標題錨點、thinking-small markdown 變體，以及自訂 □/☑ 任務標記仍不在範圍內；GFM 任務清單繼續使用原生核取方塊。

該相依性在 `ui-primitives` 中顯式聲明；由於這一純庫由 Web shell 預置，解析器與高亮器會成為初始瀏覽器 bundle 的一部分。

## 不受信任輸出策略

assistant 生成的連結目標地址僅限絕對 HTTP、HTTPS 與 mailto URL。HTTP(S) 連結會在新分頁標籤中打開，並帶有 `rel="noopener noreferrer"`；相對目標地址與其他協議會渲染為不可導覽的文字。Markdown 圖片遵循獨立的[遠端圖片策略](2026-07-30-web-remote-markdown-images.md)。由於管線中未引入 HTML 解析器，原始 HTML 仍是不會生效的源文字。Shiki 輸出是由圍欄文字生成的靜態 span 樹（不含指令碼或使用者 HTML）。

圍欄程式碼與 GFM 表格各自處理橫向溢位，因此較長內容無法撐寬對話欄。

## 考慮過的替代方案

**將現有的 mdast 與 micromark 開發相依性提升為正式相依性，並維護自訂 React walker。**此方案避免引入新的解析器體系，但產品需要自行負責每種節點對映、GFM 擴充和安全敏感的渲染分支。專用 React 渲染器將這套遍歷交由上游維護，同時保留 AST 到 React 的處理路徑。*後因新證據被推翻——增量流式解析需要純字串封裝無法提供的 AST 級輸入；該決策由[增量 AST 渲染器 Note](../architecture/2026-08-06-web-markdown-incremental-ast-renderer.md) 擁有。*

**將 `MessageText` 替換為 Markdown 渲染。**這會產生格式化使用者提示詞與 steering 的副作用。在產品明確選擇此行為之前，這些輸入仍按字面渲染。

**將 Markdown 解析為工作階段快照。**這會讓 React 節點或呈現層 AST 成為持久的執行時期狀態，並重新引入最終輸出與流式輸出之間的模式邊界。解析仍留在呈現層的葉節點中。

**透過淨化啟用原始 HTML。** 原始 HTML 當前沒有產品需求，並且會擴大可執行內容邊界，因此保持停用，無需增加淨化器相依性。遠端圖片由後續的[圖片策略](2026-07-30-web-remote-markdown-images.md)約束。

**移植 deepsuite 的 Prism `highlight.css` 與 mdast 管線。**外觀一致性由 CSS Modules 與共享的 `--dsw-*` token 負責；高亮仍走現有的 shiki 允許清單，使用戶端不必引入第二套高亮器或 Prism class 約定。

**為處理 CJK 標點邊界而預處理 Markdown 源文字，或在解析後修復文字節點。**源文字重寫必須在解析器掌握這些區別之前復現轉義、程式碼、數學公式與定界符規則；文字節點修復則已經丟失部分源文字意圖，也無法與已解析的行內節點組合。在分詞器邊界擴充 attention 可保留上游 resolver，並將差異限制在定界符的適用條件上。

**要求模型輸出標準連結，並讓 URL 形態的行內程式碼保持不可互動。**輸出指引無法統一已持久化回覆與第三方模型回覆，而行內程式碼是將端點標記為字面值的常見方式。僅在行內程式碼的渲染邊界識別完整的絕對 HTTP(S) 值，可在應用現有不受信任連結策略的同時保留程式碼語義。

## 後果

assistant 回覆在流式輸出與重播期間都會一致地渲染為語義化 Markdown，而工具卡片、推理行、互動、使用者氣泡和宿主協議保持不變。每次累積更新後，流式輸出只重新解析不穩定的尾部；未完成的 Markdown 可能暫時改變尾部結構，但獨立的尾部會限定 React 失效範圍，最終事件也不會切換渲染器。URL 形態的行內程式碼會在不改變其可見字面文字的情況下變得可導覽，而採用不安全 scheme 或混有其他內容的程式碼仍不可互動。程式碼圍欄與工具及詳情表層共用同一外框與複製路徑。初始 Web shell 包含 Markdown 解析器、GFM 執行時期、KaTeX 與 shiki 允許清單；citation、anchor 和 thinking-small 表層仍暫緩。
