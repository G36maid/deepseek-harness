# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

產出文件與可點擊文件引用功能的屬主。Node 側向系統提示詞 registry 註冊最終回覆指引；瀏覽器側把已完成輪次末尾的產出文件行註冊到 chat 檢視表的 `conversation.chat.turnTail` slot，並將收尾正文中匹配的行內程式碼引用轉換為連結。正式提供的組閤中只有 Web patch 載入本包；從 cordis.yml 中刪去這一項會同時移除提示詞、文件行與正文連結。

`deliverablesDefinition` 把每個輪次中成功的修改呼叫摺疊進引擎發布的 `DeliverablesTurnData`；`producedForClosing` 結合收尾 Assistant 的 seq 讀取這份資料。依據的是修改工具自身附帶的 `locations`，而不是收尾正文：無論模型是否記得點名，產出文件都會被列出。修改操作按算繪意圖而非工具名識別：diff 卡片，或 `kind` 為 `edit` 的通用卡片（即 `str_replace_editor` 的 insert 操作所呈現的形態）；因此新的修改工具只需聲明自身行為即可加入。讀取、刪除和失敗的呼叫不貢獻任何條目；同一路徑在一個輪次內按首見順序只出現一次。Conversation Location 索引負責維護輪次歸屬關係，因此一個輪次即使先修改文件、隨後沒有正文內容就結束，也不會溢進下一個輪次的行裡。

`ProducedFiles` 在收尾訊息正文與其 IconActions 之間算繪該行：一個低調的標籤和一條經過測量的單行文件 lane。它展示能夠放下的最大前綴（至多六個標籤項；文字為檔名，完整路徑作為 `title`），並為本機化後的精確 `+ N 个文件` 寬度預留空間，因此剩餘計數始終可見，既不換行也不橫向捲動。每個標籤項經由屬主提供的 `openFile` 打開——與工具行相同的 Host 打開器，chat 檢視表會把相對路徑按工作階段 cwd 解析。存在隱藏文件時，第二行的**在資料夾中顯示**也經由同一屬主路徑打開工作階段 workspace；它只在頁面使用 loopback 且當前 Host 握手報告 `canOpenPath` 時出現，直接遠端 Web 與 headless／容器 Linux Host 預設均省略該操作。設計原理：[workspace 文件連結 Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md)。

收尾正文承載同一份詞表。本外掛程式提供供 chat 檢視表按收尾訊息查詢的 `chatFileMentions` 服務：`producedFileMentions` 按精確路徑解析行內程式碼 token，或當 token 恰好等於某條產出路徑的 basename，且這樣的路徑僅有一條時解析——兩條路徑共享同一 basename 時，文字保持不可點擊而不作猜測，因此提及連結永遠不會打開錯誤的文件，也不會導致 404。解析成功的提及保留程式碼標籤，並採用 Markdown 樣式表的連結樣式：靜止時為連結藍色，懸停時顯示底線，與 URL 提升的行內程式碼完全一致——完整路徑作為其 `title`；提及絕不會算繪在連結內部或流式文字中。決策記錄：[行內文件提及 Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md)。

Node 側註冊靜態系統提示詞段落 `ui:deliverable-file-references`。它要求模型點名成功建立或修改的主要文件，並將這些文件以及正文中提到的其他本輪變更文件寫成 Markdown 行內程式碼：使用文件工具採用的精確路徑，或僅在 basename 能唯一指代本輪文件時使用 basename。該提示詞只向模型說明算繪器接受的文法；它不約束無關的路徑討論，也不會擴大算繪器的成功修改詞表。

## 模型體驗

### 可點擊文件引用指引

#### 模型看到的內容

一段固定提示詞要求模型在最終回覆中點名成功建立或修改的主要文件，並將這些文件以及正文中提到的其他本輪變更文件寫成採用精確路徑或唯一 basename 的 Markdown 行內程式碼，例如 `out/report.html`。

#### Token 影響

載入本包時增加一段固定提示詞；不增加工具 schema、工具結果或按 Turn 變化的上下文。

#### KV Cache 影響

該段落在本包載入期間始終以順序 190 保持靜態，因此留在可複用的提示詞前綴中，不會隨 Turn 改變。

## 已知限制與暫緩事項

- **提及匹配只認精確路徑或唯一 basename。**後綴式提及（`out/index.html` 寫作 `index.html` 可解析；`deep/out/index.html` 寫作 `out/index.html` 則不行）保持不可點擊；等真實的收尾訊息形態產生需求後再放寬匹配規則。
- **終端機命令間接建立的文件仍不在匹配詞表內。**除非某個成功修改位置也記錄了該路徑，否則在行內程式碼中點名這類文件不會使其可點擊。
- **原生資料夾交接以 Host 桌面為目標。**經非 loopback 權威訪問的瀏覽器會省略該操作，報告沒有原生打開器的部署也一樣。若 SSH 轉發讓遠端 Host 看似處於本機 loopback，部署必須為閘道設定 `nativeOpen: false`；無介面的 macOS／Windows Host、Windows interop 不可用的 WSL，或 display／opener 探測誤報的 Linux 桌面也必須這樣設定。識別操作者實際可見的桌面仍屬於部署策略。
