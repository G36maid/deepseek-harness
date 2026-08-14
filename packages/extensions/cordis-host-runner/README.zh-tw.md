# @deepseek-ai/dsh-cordis-host-runner

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由模型掛載的動態包在 host 側的那一半：定義登錄檔、host 半所用的 `node:vm` 沙盒與 fiber 生命週期、invoke handler 表，以及由某個瀏覽器頁面執行的 run 往返。以 `ctx.dynamicCordisRunner` 提供。面向模型的工具在 [`@deepseek-ai/dsh-tool-cordis`](../tool-cordis/README.md) 中；瀏覽器半由 [`@deepseek-ai/dsh-cordis-client-runner`](../cordis-client-runner/README.md) 裝載。

## 功能

分兩個階段：`define` 只做登記，一切帶副作用的動作都掛在一次 run 上。

- `define`／`undefine` 掌管一個定義的生命週期。`define` 對中繼資料做首尾去空白與必填校驗，透過編譯預檢每一半的文法（不執行任何程式碼），鑄出 `dyn-<n>`，並把該定義登記在發起呼叫的工作階段名下——它沒有任何可回滾的副作用，所以無法解析的程式碼在拿到 id 之前就被拒絕。`undefine` 先停掉正在執行的定義，再把它忘掉。兩者都不上 wire：只有模型自己的工具呼叫才會 define。
- `run` 回答模型「執行某個定義」的請求，它的兩種形態取決於這個包是誰的事。只有 host 半的包是本行程自己的事：host 半在 `cordis-dynamic` group fiber 之下於 vm 中求值，呼叫隨即返回。帶瀏覽器半的包必須由一個頁面來執行，於是 `run` 變成一次可作答的往返——它 emit `cordis/request-run`、掛起，並由某個人允許或拒絕來結束。這裡沒有定時器；呼叫方的 `AbortSignal`（提問的那一輪次被取消）是唯一的另一條出路，而且它會把這次取消播報出去，讓其他頁面不再提供作答入口。請求寄出時**並不知道**會不會有人作答——收到它的頁面也可能永遠不答，所以沒有頁面連線的部署與其他未作答請求一樣掛起，最終以 `cancelled` 收場。`run` 沒有 wire 面——`cordis_run` 在行程內呼叫它。
- `runHostHalf`／`getClientCode` 是獲得允許的頁面依次走的步驟，host 半在先，因此 host 半失敗會在瀏覽器還沒動作之前短路。`runHostHalf` 在約定上是冪等的：已在執行的包只做綁定，不再求值；針對同一個定義的並行呼叫只求值一次，`startedHere` 指出求值的是哪一個呼叫方。隨後 `getClientCode` 把瀏覽器半的原始碼交給這一個頁面；定義已消失、沒有瀏覽器半、或未在執行時期，它會拒絕。程式碼從不搭乘任何播報，所以這是它到達瀏覽器的唯一途徑。
- `resolveRequestRun` 用作答頁面的結論結束這次往返，並 emit `cordis/request-run-resolved`，讓其他每個頁面撤下待作答的入口。首答即成；更晚的或未知的 request id 會被接受並忽略。命名了登錄檔已越過的版本的成功結論會被拒絕而非應用（`accepted: false`，請求仍處於掛起），因為作答的那個頁面裝載的是一個已不再存活的下發。失敗的結論只會在 host 半正是由這次請求求值時才將它回退，因此某個頁面裝不上自己那一半，絕不會把其他頁面正在使用的包停掉。
- `stop` 回退一次存活的下發——丟棄 handler、把 host 半 fiber dispose（資源釋放）到完全靜止、emit `dynamicCordisRunner/retract`——並讓該定義仍然可執行。
- `inventory` 回答整個登錄檔，不按工作階段尋址，且每一行都指明擁有該定義的工作階段，因為執行控制面是全域性的。能列出不等於能操作：每個有實際動作的動詞仍會檢查這份歸屬。每一行還會指明該定義有沒有瀏覽器半，因此執行控制面只在確有可裝載的半時，才提供「裝入當前頁面」。`snapshot` 是它按工作階段限定的 host 本機對側，攜帶每個存活 host 半的 fiber，供 `cordis_inspect` 自行算繪 provides／waiting／state（fiber 無法跨 wire）。
- `reportRenderFailure` 記錄某個頁面看到一個**已裝載**的瀏覽器半在算繪時做錯了什麼。算繪嚴格發生在裝載成功之後，因此到那時 run 早已回答了 `ok`：這份上報是 fire-and-forget 的，不帶任何結帳權威，也絕不觸碰 `resolveRequestRun` 或 run 結論的任何部分——**它不是那個已退役的 v2 `report`／ack**。host 按定義保留跨所有頁面的最後一次失敗（第二個頁面上報即覆蓋），而一次全新的 run、一次 stop 或一次 undefine 都會清掉它，因此模型絕不會看到一次已不存在的下發留下的失敗。瀏覽器半的契約面自己保留一份「**這個頁面**當前正在顯示什麼」；兩者回答的是不同的問題，不是同一個問題的兩份答案。上報的工作階段若並不擁有該定義，這次上報會被丟棄，因為上報路徑絕不能讓一次算繪失敗。
- `invoke` 把一個包的瀏覽器半發起的一次呼叫，路由到它自己的 host 半用 `harness.handle` 註冊的方法。這套基礎設施只做路由：不存在 host 到瀏覽器的方向。

`run` 或 `stop` 的拒絕會給出 `definition-missing`、`host-half-failed`、`client-half-failed`、`rejected`、`cancelled`、`not-running` 之一；後三者是答覆而非缺陷——有人拒絕了、提問的那一輪次已結束，或本來就沒有在執行的東西可停。

別的工作階段登記的定義讀起來是不存在，而不是被禁止，因此不會跨工作階段洩漏任何東西。`invoke` 與 `resolveRequestRun` 完全不攜帶工作階段：元件的一次呼叫和頁面的一次作答都是頁面全域性的事實，不屬於某一個工作階段。

本功能擁有四條轉發事件，由本包在其 client-safe 的 [`./types`](src/types.ts) 子路徑上聲明，並由 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) 的白名單準許投遞——正是這一點讓瀏覽器能經 `ctx.remote.$on` 收到它們：`cordis/request-run`（`{requestId, agentId, id, name, purpose}`——只有中繼資料，絕無程式碼）、`cordis/request-run-resolved`（`{requestId, outcome}`）、`dynamicCordisRunner/package`（`{id, name, rev}`），以及 `dynamicCordisRunner/retract`（`{id, rev}`）。後兩者是對稱的一對執行狀態播報：每次全新啟動與每次停止都播，與該包有沒有瀏覽器半無關。

## 儲存立場

登錄檔就是行程記憶體，也是唯一真源。工作階段日誌只承載一次 define 呼叫的中繼資料，絕不承載它的程式碼：因此行程重新啟動後確實沒有任何定義，這是合理的；而 id 已無法解析的卡片會如實說明這一點，不會假裝自己還能執行。本包不向磁碟寫任何東西，也不會自動復原任何定義；刷新過的頁面手上什麼都沒有，直到有人再次執行某個包——正是這一步讓它綁定存活的 host 半並重新取回瀏覽器半。

## 信任立場

vm 沙盒隔離全域性變數，但不是安全邊界：Node 全域性變數不存在，或重定向到 Cordis 服務（`ctx.fs`、`ctx.web`、`ctx.bash` 以及定時器 helper），host 半收到的是不含框架內部機制的 façade，但它聲明的服務仍會觸達存活執行時期。應當像對待 bash 訪問一樣對待動態包，參見[自引用工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 設定

| 欄位 | 預設值 | 含義 |
|---|---|---|
| `vmTimeoutMs` | `5000` | host 半在 vm 中同步執行的那部分被中止求值前可執行的毫秒數 |

就這一個欄位：一次 run 請求等的是人，所以這趟往返本身沒有任何截止期限。

## 匯出形狀

服務包：預設匯出 `DynamicCordisRunnerService`（服務鍵 `dynamicCordisRunner`），`./types` 則承載 `dynamicCordisRunner` remote namespace 與其消費端共享的載荷形狀。`define`／`undefine` 的形狀留在包內部，因為它們從不跨 wire。

## 模型體驗

### 經 cordis 工具轉達的拒絕與教學式錯誤

#### 模型看到的內容

沒有直接可見的內容：本包不註冊任何工具，也不注入提示詞。它的拒絕經呼叫它的 `cordis_*` 工具結果到達模型——無法解析的半會指出出錯的那一行，缺失的定義會解釋定義只活在記憶體裡，`rejected` 或 `cancelled` 的 run 報告的是有人拒絕或該輪次已結束而非出了故障，瀏覽器半裝載失敗則帶上作答頁面自己的錯誤文字。

#### Token 影響

本包自身沒有：上述每則訊息都由呼叫它的那個工具的結果承載。

#### KV Cache 影響

註冊工具的 host 半會改變下一次請求的工具檢視表，從第一個變化的 schema token 起使前綴複用失效；執行或停止一個不註冊任何工具的包對前綴不產生影響。

## 已知限制與暫緩事項

- **run 成功不等於 UI 算繪成功。** 只要作答頁面**已裝載**瀏覽器半，`run` 就會返回；React 是隨後纔算繪的，因此一個拋例外的元件根本不可能出現在 run 的回執裡。該失敗經 `reportRenderFailure` 浮現，並透過 `cordis_inspect what:"temporary"` 讀回；run 的結果會把這一點說出來，而不是暗示成功。

- 帶瀏覽器半的包在**沒有頁面連線的地方會掛起**——headless 與 ACP（Agent Client Protocol）部署會把這次 run 一直掛到提問的輪次被取消，因為轉發事件不回報誰收到了它。只有 host 半的包不受影響。
- 掛起的 run 請求**沒有逾時**：它一直等人，直到提問的那一輪次被取消，因此無人值守的自動化用不了帶瀏覽器半的包。
- `vmTimeoutMs` 只約束同步求值；async 的 host 半函式體會逃出該上限，這與該工具集基於協作的信任立場一致。
- `runHostHalf` 不攜帶 request id，因此「這個 host 半是哪次請求求值的」由 host 側歸因到該定義最近一次掛起的請求；若同一個定義出現多個並行 run 請求，這條規則需要重新審議。
- 命名了已被取代版本的成功結論會被拒絕（`accepted: false`）並讓該請求繼續掛起，因此模型這次呼叫只能靠一次有效作答或自身被取消才結束。要把它結帳掉，需要對著存活版本重新走一遍編排，而當前沒有任何頁面會這麼做——[瀏覽器半](../cordis-client-runner/README.md)不讀這個 ack——所以這類請求實際上由別的頁面作答、或由呼叫方取消來收尾。
- 瀏覽器半聲明的 `inject` 是從它在頁面裡返回的外掛程式上讀出的，因此播報完全不攜帶服務聲明欄位。
- **`zod` 是生成的 TypeRT 契約面的執行時期相依性，不是 `src` 的相依性。** `./typert` 與 `./remote` 解析到 `lib/typert.*.js`，`tsc` 以不打包的形式產出它們，其中帶有裸的 `import { z } from 'zod'`，所以本包必須聲明它（沿用 `@deepseek-ai/dsh-goal` 的先例），而 `knip.json` 必須在這個 workspace 裡忽略它：knip 讀的是原始碼，而這些契約面是建置產物。`src` 裡沒有任何程式碼 import zod。
