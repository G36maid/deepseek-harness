# Agent Note: web 設定平面

Status: implemented

[English](2026-07-30-web-config-plane.md) | [简体中文](2026-07-30-web-config-plane.zh.md) | 繁體中文

> 範圍：[請求級 LLM（大型語言模型）設定 note](2026-07-29-request-level-llm-config-credentials.md) 中延後的 wire 面與 web UI——帶推送式失效的 `settings.*`/`credentials.*`/`llm.*` RPC 領域、分層且脫敏的 `describe()`、本機設定文件交接、llm 可設定提供方目錄與拓撲事件、獨立的 `dsh-client-schema-form` 模型層，以及帶手寫提供方編輯器的 Models 設定頁。`deepseek` → `deepseek-official` 提供方路由重新命名作為解除鎖定前提的破壞性變更一並搭車合入。

## 問題

請求級設定 seam 讓 LLM 配接器設定免重新啟動，但唯一的寫入方還是直接編輯 `settings.yaml` 的文字編輯器：web 用戶端沒有觸達設定、憑據或提供方拓撲的任何 wire 通道，「存入金鑰、再次發起提示」於是仍意味著離開產品本身。擋住設定頁的缺口不是一個，而是三個：`describe()` 只返回合併後的生效值（表單分不清使用者覆蓋與組合預設值，而且照原樣序列化會把 `role('secret')` 的值發到每一個瀏覽器）；沒有任何東西枚舉配接器*可以*執行的提供方（裸掛載的 `llm-pi-ai` 在設定之前完全不可見）；兩個配接器又都想要 `deepseek` 這個路由鍵，目錄因此無法無歧義地把路由歸到擁有它的 namespace 名下。為每個提供方手工維護一份表單被直接否決——schema 已經以 schemastery `Config` 值的形式存在，第二份欄位真源註定漂移。

## 決策

**wire 領域掛上編譯期 RPC 對映，拒絕落為錯誤碼，owner 事件原樣轉發。**`settings.describe/openDocument/update/replace/mutate`、`credentials.describe/set/unset`、`llm.providers` 與 `llm.models` 一同加入 `RpcMethodMap`，由編譯器鎖定的接線位點讓 schema、處理器與用戶端保持步調一致。seam 側拒絕摺疊為業務錯誤，用戶端則訂閱轉發的 settings、credentials 與 LLM owner 事件，無需輪詢即可收斂（見[轉發的 Remote 事件](2026-08-10-remote-event-delivery.md)）。settings 讀取、原生操作與寫入和 `pickDirectory`/`openPath` 一起進入連線守衛的特權集合：回環 + 同源，否則 403，因為暴露在局域網上的 dsh web 絕不能接受來自其他源的設定訪問。

**`describe()` 增加分層與結構化 secret 脫敏。**`SettingsDescriptor` 在生效值之外攜帶 `base`/`user`，表單據此按「欄位是否出現在使用者層」來標記「已覆蓋」，而非按值是否不等（與 base *相等*的覆蓋仍然是覆蓋）。`describe({ redactSecrets: true })`——在每個 wire 面都強制啟用——經由對 schema 的純結構遍歷（object/dict/array 容器；secret 角色子樹整體是一個不透明葉節點）從全部三層剝除 `role('secret')` 子樹，並把剝除的槽位枚舉為 `{path, set}`，頁面因此不必收到任何值就能渲染只寫輸入框。

**Host 識別並打開本機設定文件。** settings seam 暴露選填的 `documentPath` 提供方元資料和 `prepareDocument()` 操作；`settings-file` 返回已完全解析的自訂檔名或 `$DSH_HOME/settings.yaml` 檔名，並在文件缺失時以僅屬主可訪問的權限獨佔建立空文件，非文件提供方則保留基類的 `undefined`。僅限回環訪問的 `settings.describe` 回應會在脫敏 namespace 檢視表旁只攜帶布林型 `hasDocument` 能力。`ui-settings-general` 只在回環頁面註冊一條 `settings.action` 條目，只有元資料確認可準備好一份由提供方持有的本機文件後才顯示，並呼叫無路徑參數的 `settings.openDocument`；Host 會在文字文件交接前再次解析提供方路徑（macOS 上使用 `open -t`，使任意 YAML 文件關聯無法重定向這次操作；桌面 Linux 上使用 `xdg-open`；Windows 上使用 `Invoke-Item`；WSL 上先執行 `wslpath -w`，再使用同一 Windows 交接）。通用 Workspace 路徑仍保留默認意圖，包括針對瀏覽器可渲染文件的瀏覽器偏好。瀏覽器既不推導 `$DSH_HOME`，也不會收到檔案系統目標；遠端頁面不會為這項操作發起特權 settings 讀取。

**llm seam 聲明可設定性並公佈拓撲。**`registerConfigurableProviders()` 是一個全有或全無、以 fiber 為作用域的目錄，條目為 `{provider, displayName, settingsNs, settingsPath}`——這正是設定頁要為一條可能尚不存在的路由打開正確設定子樹時所需要的尋址；`listConfigurableProviders()` 在 wire 處理器裡與存活路由合併，未聲明的存活路由因此仍報告為啟用。零負載的 `'llm/adapters-updated'` 事件從全部四個註冊／註銷提交點觸發，listener 派發帶例外隔離（INVARIANT 重拋），沿用 settings/commands 的先例。`llm-deepseek` 的路由重新命名為 `deepseek-official`，因為 pi-ai catalog 名正言順地擁有 `deepseek` 這個聚合器條目；依預發布立場，不設別名。

**架在 schema 模型層之上的手寫編輯器。**`dsh-client-schema-form` 把 wire 的 `toJSON()` 信封還原（rehydrate）為活的 schemastery 節點，用於校驗、路徑解析與不可變草稿編輯——但不做通用渲染：第一版交付了完整的 schema 驅動程式表單渲染器，得到的卻是一個未加樣式、把 schema 原樣傾倒出來的頁面（每個進階欄位都平鋪到卡片上、原始欄位名直接充當標籤、`retryPolicy` 的「不支持」回退落在主流程裡）。手寫方向勝過了再加一套提示／分組系統，進一步的簡化又把引用輸入框整個移除：卡片的主欄位是一個 **API 金鑰** 輸入框，未設定金鑰的整分節提供方會以其設定卡片的形式打開，收起的「自訂設定」摺疊區承載按家族精選的額外欄位（兩個家族都有 `baseURL`，deepseek 有 `reasoningEffort`／pi-ai 有 `reasoning`，另有直接 DeepSeek 模型行的 `id`、`name` 和 `contextWindow`）。現有模型欄位中不在可見集合內的部分會在陣列編輯後保留；重試策略、逾時及其他欄位仍歸 `settings.yaml` 所有。校驗仍會在寫入前執行還原出的 schema，配接器特有的檢查則會拒絕序列化 schema 無法表達的目錄不變數。卡片的顏色經 `--dsw-alias-*` 設計 token 解析；它此前引用的 `--border`／`--surface`／`--text-*` 在本應用中無人定義，於是渲染出的是它們的亮色模式回退值，在暗色主題下依舊保持亮色。模型目錄採用 pi-ai 提供方表單引入的行形態：每個模型一個帶邊框的條目，ID 與顯示名稱落在行上，容量則收在該行自己的摺疊區裡，使兩個編輯器呈現為同一套設計，而不是各自分岔。每個欄位都保留那個為其命名的帶序號 `aria-label`。兩項容量都是文字輸入框，讀取十進位的 `K`／`M` 後綴（`1M` 即 1000K，與容量的通行標注方式一致）並存儲純數值：欄位持有焦點期間保留鍵入的文字，因為若每次按鍵都從解析出的數值重新推導該文字，`1000` 會在尚未輸完時就被改寫成 `1K`；無法解析的文字也會留在螢幕上，因此保存時的拒絕點名的是使用者仍能看見的那一行。共用的類名只承載已聲明的 token 寫法：`--dsw-alias-border-subtle`、`--dsw-alias-text-tertiary` 和 `--dsw-alias-text-primary` 均未聲明，寫出它們就會解析為各自回退槽位中的亮色模式字面值。現在有一個樣式測試會拒絕 token 表未聲明的任何 `--dsw-*` 名稱，因此下一個寫出這類名稱的編輯者會當場失敗，而不是交付一個只有亮色的介面。

**Models 頁是一次三領域聯接，應用語義與服務同形。**每一行是一個已設定的提供方；「新增」卡片的選擇框是可設定提供方目錄中剩餘的休眠條目。路由存活狀態仍用於就緒判定，並會使該聯接失效，但頁面不將其渲染為提供方狀態，因為設定存在與執行時期可用性是兩個不同概念。金鑰通道保持引用形態，卻從不展示任何引用：鍵入的金鑰經 `credentials.set` **只寫**存入 profile 的 `apiKeyEnv` 之下，引用不存在時便派生 `<ROUTE>_API_KEY`（僅在輸入金鑰時，pi-ai profile 才會記錄該派生），因此 `settings.yaml` 從不攜帶金鑰值；留空 pi-ai 金鑰會具化一個不帶引用的 profile，並保留提供方原生認證。profile 的編輯和刪除會針對脫敏後的使用者分節，以按路徑尋址的最小 `settings.mutate` 操作落地，絕不會點名頁面未收到的機密。刪除使用者層提供方時，會先打開本機化確認對話框，其行操作、標題、說明和最終操作都會點名同一個提供方；確認後會先清除與派生目標精確匹配且已設定、可寫的憑據，再刪除 profile，自訂目標、環境目標和無法識別的目標則保持不變。兩個階段都具備冪等性，部分失敗會留在對話框中供重試。DeepSeek 的模型清單是陣列替換設定：繼承而來的生效模型行會一直顯示，直到第一次編輯將完整清單具化到使用者層；重設則會取消設定該清單覆蓋。部分提交與憑據所有權的理由記錄在[提供方憑據生命週期 note](../bug-fix/2026-08-06-provider-credential-lifecycle.md)中。

## 曾考慮的替代方案

- **在 wire 上改發 JSON Schema**——schemastery 的 `toJSON()` 信封能往返保留 `role()`/meta，並還原成用戶端為草稿校驗本就自帶的那個校驗器；轉換成 JSON Schema 丟掉的恰恰是憑據控制元件與 secret 脫敏所相依性的角色註解。
- **通用的 schema 驅動程式表單渲染器**——先實作、後被替換：如實呈現欄位卻缺失視覺層級，產出的卡片醜陋且不可用；要把它做好，就意味著建置一套提示詞匯（主要／進階分組、逐欄位描述、陣列項卡片），成本堪比手寫編輯器，卻仍無法與任何設計稿完全吻合。今天存在兩份 schema（deepseek 的 `Config` 與共享的 pi-ai profile），手寫因此就是兩套以 namespace 為鍵的薄版面配置；漂移風險由保存時的 schema 校驗以及未知欄位在文件中的原樣保留共同約束。
- **逐欄位脫敏機密並在 `replace` 時回填哨兵值**——請求級 seam 的決策（機密是引用）已經為產品默認形態刪掉了「儲存字面量」這種情況；結構化脫敏加上只寫的憑據通道足以處理殘餘情形，無需讓每個寫入方都學會一套哨兵協議。
- **把鍵入的金鑰存成字面 `apiKey` 設定**——v1「單個 API 金鑰輸入框」的需求本可以把字面量直接寫進 profile，但 UI 的每條刪除路徑都會從*脫敏後的*各層重建使用者分節，任何重設或整行刪除都會靜默丟掉已儲存的兄弟金鑰；派生引用讓輸入保持單欄位，同時讓 `settings.yaml` 不含機密、每一次 replace 都安全。
- **由 `models` 橋接外掛程式持有提供方設定**——與請求級 seam note 相同的否決理由：按外掛程式劃分的 namespace 加上四欄位的目錄聲明已經給了 UI 需要的一切；橋接層的統一字典會把配接器對映那層間接重新引進來。
- **頁面側輪詢而非推送幀**——mux 已經承載 `host/commands-changed`；再加三個幀，每個只需增加一種形狀，就能讓第二個分頁標籤、外部的 `settings.yaml` 編輯和由設定催生的路由都以事件速度收斂。
- **在瀏覽器中硬編碼 `$DSH_HOME/settings.yaml`，或經 `host.openPath` 回傳 `documentPath`**——否決，因為 `settings-file.path` 可能選擇另一份 YAML/JSON 文件、非文件提供方沒有 Host 路徑，而且通用路徑請求會讓瀏覽器成為本機檔案系統目標的權威。提供方的準備操作纔是權威來源，由 Host 持有的操作會把結果交給現有打開器。

## 後果

整條閉環以無金鑰方式固定在瀏覽器測試通道（`apps/web/tests/models-settings.e2e.ts`）：「新增」卡片提供休眠的 pi-ai catalog，攜鍵入的金鑰新增 `minimax-cn` 會把只含引用的 profile 寫入 `settings.yaml`、把金鑰值存入 harness 家目錄 `.env` 中派生的 `MINIMAX_CN_API_KEY` 之下、路由隨拓撲幀註冊為存活，「自訂設定」摺疊區則把 `reasoning` 合併到引用旁邊——全程零模型呼叫，「新增」卡片態、已設定態與已點名目標的刪除確認態各有 ARIA golden，另有腳手架式的 `harnessHome`，測試絕不觸碰真實的 `~/.dsh`（受測提供方是派生引用不可能與開發者已匯出金鑰相撞的那一個）。設定外殼場景會截獲無路徑參數的原生意圖；Service Definition、提供方、wire、React 與原生打開器測試分別固定了提供方缺失、自訂路徑解析、缺失文件建立、僅屬主權限、遠端／不可用時隱藏、重複點擊合併、本機化失敗、macOS 文字編輯器分發，以及 Linux/Windows 桌面分發。刪除場景證明，取消會保留 profile 和金鑰，隨後的確認會同時刪除 profile 及其已識別的受管憑據。DeepSeek 首次使用 fixture 會把默認目錄編輯為使用者自有清單、持久化任意模型的 ID／名稱／上下文視窗、移除活動模型行，並觀察模型選擇器的空選擇回退。這次重新命名觸及 239 個文件（fixture（測試前置資料）、golden、文件、python），未保留相容別名。替換渲染器不需要任何 wire 變更：應用語義、脫敏與目錄聯接從一開始就與渲染器無關。延後事項：每行的模型預覽（選擇器已能列出模型）和為從未聲明可設定性的存活路由提供頁面地址。
