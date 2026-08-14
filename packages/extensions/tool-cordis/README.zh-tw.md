# @deepseek-ai/dsh-tool-cordis

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

自引用 Cordis 工具集：五個面向模型的工具，操作當前 DSH 行程中的即時執行時期。登錄檔、vm 沙盒與瀏覽器廣播屬於 [`@deepseek-ai/dsh-cordis-host-runner`](../cordis-host-runner/README.md)（`ctx.dynamic`），本工具集註入它——只裝這些工具而不裝 runner 的組合永遠不會啟用它們。沙盒語義、動態包生命週期與組合及既定決策詳見[工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 功能

兩組配對動詞，外加只讀報告。

- `cordis_inspect`：當前行程執行時期的只讀報告，包括服務、全部存活外掛程式 fiber、已註冊工具、本工作階段的動態包、反射支援的 `api`／`events` 參考，以及瀏覽器半可以向其貢獻 UI 的編譯期 `client` 槽面。精確的 `name` 配合 `what: "api"`、`what: "events"` 或 `what: "client"` 可縮窄報告，並附上完整約定。
- `cordis_define`：在文法預檢兩個半之後登記一個包（`name`、`purpose`，以及 host 半 `code` 和／或瀏覽器半 `client`）。此時不執行任何東西；使用者會在工作階段裡看到它的卡片和一個啟動控制元件。鑄出的 `dyn-<n>` 標識同時進入結果 value **與**持久的呈現中繼資料，卡片正是靠後者在 replay 中尋址執行動詞。
- `cordis_run`：在沙盒中求值 host 半，並把瀏覽器半投遞給每個打開的網頁。對已在執行的包再次執行不會失敗，而是重新投遞當前版本——這正是被刷新過的頁面把包取回來的方式。
- `cordis_stop`：把 host 半 dispose 到完全靜止，並從各頁面撤回瀏覽器半；定義存續，可以再次執行。
- `cordis_undefine`：必要時先停止該包，再忘掉定義；它的卡片作為一條已解除安裝記錄留在工作階段裡。

面向模型的確切 schema 見[生成的工具目錄](../../../docs/tool-catalog.md)。

動態包只存在於共享 DSH 行程記憶體中。它可跨後續輪次保持活躍，也可能影響同一行程中的其他工作階段，但會在 `cordis_stop`／`cordis_undefine`、工具集解除安裝或 DSH 重新啟動後消失。它不會建立外掛程式文件、安裝任何包、修改 `cordis.yml` 或個人／項目設定、跨重新啟動存續，也不能自動轉為正式外掛程式。若要保留實驗結果，應讓 agent（代理）透過常規開發流程實作普通的本機、項目或倉庫外掛程式。每個動詞都以工作階段為界：一個包只在定義它的那個工作階段裡可見、可控。

## 信任立場

該沙盒隔離全域性變數，但不是安全邊界。Node 全域性變數不存在，或會重定向到 `ctx.fs`、`ctx.web`、`ctx.bash` 等 Cordis 服務；寫入 `globalThis` 的內容保持區域性，但 host realm helper 使逃逸成為可能。執行中的 host 半收到不含框架內部機制的 façade，但獲準服務仍會影響存活執行時期。動態工具 schema 與 annotation 透過迭代式 JSON 克隆和 schema 規範化跨越 realm，因此有效的深層聲明受記憶體而非呼叫棧限制；含 JSON 不可見 key 的 record，以及子類化或裝飾過的 schema array，會在規範化前被拒絕。應當像對待 bash 訪問一樣對待該工具集；參見[設計與信任立場](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 設定

無。vm 求值邊界（`vmTimeoutMs`）與瀏覽器確認視窗（`ackTimeoutMs`）屬於擁有沙盒與廣播的 runner 服務——見 [`@deepseek-ai/dsh-cordis-host-runner`](../cordis-host-runner/README.md#config)。

## 生成的 client 槽目錄

`src/client-catalog.ts` 描述瀏覽器半的座位，由 `scripts/gen-client-catalog.ts` 生成（新鮮度閘門為 `doc-sync` 中的 `pnpm run verify-client-catalog`），資料來自對每一處 `SlotMap` 聲明合併與每一個 `slots.register` 呼叫點的詞法掃描。它承載瀏覽器半唯一能動的那個面——槽鍵、每個 register 呼叫的選項、元件會收到的 props、誰已經佔著這個座位、以及哪個 owner 掛著這個座位才存在——並且只以純資料承載：本包始終在 host 側、不 import 任何 client 模組，跨越兩平面的只有這些字串。生成器寧可高聲失敗也不吐出一條模型無法照做的條目：槽缺少面向 registrant 的 JSDoc 正文、`kind`／`scope` 不是字面量、owner props 沒有任何匯出聲明、鍵重複、或註冊進了沒人聲明的槽，都會讓閘門變紅。owner props 只展開一層——owner 聲明本身連它的成員文件,加上其欄位所引用的那些形狀的名字——而單個槽的整份報告有行數上限:收窄到一個槽的意義是少花上下文,不是多花。

一個槽的教學文案就是它聲明處的 JSDoc，所以要改模型讀到的內容，改的是聲明它的那個包裡的約定，而不是這份目錄。

## API 報告從哪裡來

`cordis_inspect what:"api"`／`what:"events"` 算繪的是 `src/api-catalog.ts`，即工作區 Cordis 聲明的生成投影：算繪好的方法簽名、原始碼 JSDoc、帶分發模式的 harness 事件，以及這些簽名引用到的類型形狀——全部由與 `docs/subsystems` 同一次 AST 遍歷產出，因此模型讀到的資料與算繪出的文件不可能彼此偏離。它是關於**倉庫**的編譯期事實，所以用 `pnpm run gen-cordis-api` 重新生成、用 `pnpm run verify-cordis-api` 守它的新鮮度。

`src/inspect.ts` 把這份目錄與**活的**服務儲存取交集：**誰在跑**由儲存回答，**每個服務能做什麼**由目錄回答；目錄沒覆蓋到的活服務會被報成可達但沒有簽名，而不是被省略。包程式碼若要在自己原始碼裡用這份清單，就從報告裡抄出來——目錄是關於倉庫的編譯期事實，所以對任一個部署而言，抄出來的清單與現讀的清單說的是同一件事。

有兩項面向模型的判斷住在本包裡，而不住在產物裡，因為反射資料忠於程式碼，而報告必須有用：

- **只展示可呼叫的方法。** 非方法成員是狀態而不是動詞，而它們算繪出來的形式會帶上實作體裡的初始值；以 symbol 為鍵的成員是外掛程式之間的內部 seam，包的 façade 刻意無法觸達，所以點出其中任何一個，都等於宣傳一次根本發不出的呼叫。
- **只有 host 半夠得到的鍵，才會被點名給模型。** 反射模型覆蓋包聲明的每一個 `ctx.<key>`，其中包括 launcher 提供的 boot 值（`agent`、`headlessIo` 等）與瀏覽器半的服務（`connection`）。`src/curation.ts` 會為每一個這樣的鍵歸類它的 `reach`——`injectable`、`not-a-service` 或 `other-face`——而只有 `injectable` 的鍵能進報告：點名一個包夠不到的鍵，就等於宣傳一次根本發不出的呼叫。這份歸類是作為每條目錄條目上的資料攜帶的，而不是在算繪時才施加，因此這項排除可以單獨測試；同時 `verify-cordis-catalog` 把被歸類的集合釘成「文件投影不算繪的鍵」這個集合本身——新聲明一個鍵會把閘門攔下來，而不是悄悄引誘模型去 `inject` 一個永遠不會到來的東西。一個被歸類、但確實有存活提供方的鍵，仍然會被報成在跑且可 inject：服務 store 纔是「什麼存在」的權威。

生成常數 `INHERITED_CTX_API` 為 `api` 報告收尾，列出框架繼承來的 `ctx` 面（`ctx.on`、`ctx.effect`、`ctx.loader`、各 timer 輔助方法）：這些成員本身就是 Context，不是某個服務鍵；而框架層住在 pinned vendor 包裡，位於每一個被分析的契約面之外——所以生成器策展這**一層**，並把它同時算繪進本目錄與 `docs/cordis-api/inherited.md`。一個活著、但目錄並不描述的服務，會被報成“在跑、且仍可 inject”，而不是報成不存在。寬泛的 `api`／`events` 報告只算繪摘要與簽名；精確 `name` 會選擇保留的方法／事件 JSDoc，未知或未執行的服務目標會高聲失敗。

## 算繪

每個工具都算繪 `generic` 卡片（`read`／`execute`／`delete`）；`cordis_define` 以 `rawInput` 攜帶提交的兩個半，並用標籤與用途作為卡片標題。presenter 是 args 的純函式，結果保留預設文字算繪。Web 用戶端註冊自己的 keyed `cordis_define` 行（`@deepseek-ai/dsh-client-ui-cordis`），從呼叫參數與結果中繼資料裡取標籤、用途和鑄出的標識；沒有該註冊的介面則退回到這張 generic 卡片。

## 匯出形式

Namespace 外掛程式：命名匯出 `name`／`inject`／`apply`，無預設匯出（[docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。它注入 `tools` 與 `dynamicCordisRunner`。

## 模型體驗

### 工具 schema

#### 模型看到的內容

該外掛程式可見時，工作階段模型會看到生成的 [`cordis_inspect`、`cordis_define`、`cordis_run`、`cordis_stop` 和 `cordis_undefine` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis)。

#### Token 影響

該工具檢視表中的每次請求承擔固定 schema 成本。

#### KV Cache 影響

只要該工具檢視表不變，前綴就保持穩定。隱藏這些定義的 scope 或外掛程式生命週期變更，可能使從第一個變化的 schema token 起的複用失效。

### 工具呼叫歷史與結果

#### 模型看到的內容

檢查會精確地用 `## <section>` 加換行及取決於資料的正文來拼接選中區段，各區段之間留一個空行；`what: "temporary"` 使用 `## Dynamic Packages` 標題。每一行都會報告標識、標籤、用途、存在哪些半、執行狀態與版本號、提供和等待的服務、已註冊的 host 方法，以及最後一次瀏覽器半裝載上報；空狀態說明定義只存在於本行程記憶體中。寬泛的 API／事件報告省略 JSDoc；`name` 配合 `what: "api"`、`what: "events"` 或 `what: "client"` 返回一個精確目標及其完整約定。`client` 區段每個座位一行，給出其基數、作用域、摘要，以及註冊進去是否會替換出廠 UI，隨後是跨座位通用的 registrant 紀律；每個座位的 register 選項、owner 與框架 props、可直接執行的示例，只在精確 `name` 時才吐出。define 回答該包已定義、尚未執行，並給出用於執行的標識；run 報告版本號、host 半提供或等待什麼，以及是否有頁面確認了瀏覽器半；stop 與 undefine 各以一行確認。每一次拒絕都是攜帶 runner 教學文案的工具錯誤。提交的程序保留在 assistant 工具呼叫歷史中。

#### Token 影響

檢查輸出與提交的包程式碼取決於資料，並在壓縮（compaction）前重複傳送；生命週期確認文字很短。`client` 區段的體量由出廠槽數量決定（每座位兩行），每座位細節按需索取，因此預設報告隨槽面成長，而不是隨其文件量成長。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### cordis_run 後的後續請求

#### 模型看到的內容

執行中的包可以註冊工具、提示詞貢獻或監聽器，改變其目標 scope 的後續請求；`cordis_stop` 與 `cordis_undefine` 會在完全靜止後移除這些貢獻。

#### Token 影響

間接 token 影響等於執行中包的貢獻，且只在其行程內生命週期內持續。

#### KV Cache 影響

執行或停止提示詞／工具貢獻會改變後續請求前綴，並可能使從第一個變化的貢獻起的複用失效；執行集合不變時，前綴保持穩定。

## 已知限制與暫緩事項

- **沙盒只用於約束誠實程式碼，並非安全邊界**：可以訪問沙盒全域性變數上的 host realm helper，因此包程式碼可以觸達 Node；載入該外掛程式時，應當像授予 bash 工具一樣慎重（見 § 信任立場）。
- **`ctx` façade 不公開 `effect()`**：包程式碼無法註冊訂製 disposer；`on`／`provide`／`tools.register` 是受支援的清理路徑。
- **vm 與確認視窗這兩個邊界屬於 runner**：見它的[已知限制](../cordis-host-runner/README.md#known-limitations-and-deferred-work)；async 的 host 半主體可逃出 `vmTimeoutMs`。
