# @deepseek-ai/dsh-cordis-client-runner

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

動態雙半外掛程式包的瀏覽器半。host 側 runner 把每個定義的程式碼留在行程記憶體裡，並經一條 `cordis/request-run` 事件向打開的頁面發問「要不要執行它」；本包回答這個請求、把定義變成活的瀏覽器外掛程式，並把 `dynamicCordisRunner/retract` 事件變回乾淨的頁面。

## 它做什麼

1. **事件訂閱** —— 四條公告是轉發的 host cordis 事件，所以本包經 `ctx.remote.$on` 消費 `cordis/request-run`、`cordis/request-run-resolved` 與 `dynamicCordisRunner/retract`，而 `$on` 的鍵面就是 api-remotes 的白名單。
2. **閉包求值** —— 瀏覽器半的原始碼作為一個 async 函式體執行，其參數即符號面（`React`、`console`、`styles`、`host`，外加遮蔽 `setTimeout`/`fetch`/`require` 的教學陷阱）。無 JSX、無 TypeScript、不能 import 模組。
3. **guard 門面** —— `apply` 收到的是真 fiber ctx 之上的白名單代理：生命週期動詞，加上**返回的 plugin 自己在 `inject` 裡聲明**的服務（所以要用對象形態 `{ inject: ['slots'], apply(ctx) {} }` 纔拿得到服務；裸函式沒有聲明位，拿不到任何服務）。`slots` 座位分配遮蔽 priority（註冊即遮蔽，最新一次執行者勝出）；`theme` 座位把覆蓋層的 source 釘成包 id，並把它的 disposer 掛到 fiber 上。
4. **loader entry** —— 加了 guard 的外掛程式被塞進模組表，再經 `loader.create` 掛載，於是動態包與靜態包共享同一套啟用門控、fiber effect 清理與狀態投影。解除安裝 = 移除 entry + 失效 factory + 撤下樣式。
5. **run 編排** —— 一條 `cordis/request-run` 事件問這一頁要不要執行某個定義。回答的那一方按順序把 run 跑完：先 host 半、再取原始碼、再瀏覽器半，最後一次回答帶上結果。使用者按下「執行」本身就是授權，同樣走這條編排，只是沒有要回答的對象；而純 host 定義的 run 到 host 半就結束了 —— 這裡沒有第二半可取、也沒有第二半可裝。
6. **包內 RPC** —— 包內的 `host.call` 經 `dynamicCordisRunner` Remote namespace（`invoke`）轉給它自己的 host 半，三種路由失敗碼各自變成對應的教學錯誤。兩個方向都只馱 JSON：省略入參會以 `null` 過線（所以 `host.call('listServices')` 合法，handler 收到 `null`），而生成的 codec 拒收的載荷（函式、`undefined`、類實例）會變成一條點明「哪次呼叫 + 約定是什麼」的教學錯誤，而不是 codec 那個光禿禿的欄位名。
7. **渲染期失敗迴流** —— 槽位登錄檔的 supervision 接縫（`slots.onEntryError`）對頁面上每一次 entry 邊界崩潰都會通知；凡屬於本 runner 落座過的包，那**一次**觀察會分兩個出口：一路上行給撰寫它的工作階段（`reportRenderFailure`，給模型看），一路發布到本包 face 上的 `renderFailures`（給面板那一行看）。歸屬以 component 身份為鍵，在 guard 的 `register` 代理落座時記下 —— 登錄檔原樣保存 component，所以不需要再維護一份與之同步的 entry 臺帳。這條通道純屬事後診斷：不馱任何 settle 權威、絕不觸碰 run 的最終回答，而且報告本身失敗時只吞不拋 —— 不讓一次崩潰變成兩次。

## 生命週期

裝載按 `(id, rev)` 對 live 態收斂：裝載這一頁已在執行的那個 revision 會**直接從 live 態回答**而不重裝（所以被重播的 run 不會看起來沒人回答），更新的 revision 頂替舊的，同一 revision 在 retract 之後再裝則重新裝載。同一定義的操作序列執行。

啟用時什麼都不裝，刷新之後也不復原 —— 一頁只在有人回答了一次 run 請求、或有人在這一頁主動要求時，才執行動態包。

## run 介面讀什麼、調什麼

`ctx.dynamicCordisRunner` 就是全部的面:

- `activeRuns` —— 每個定義唯一的運送中活動：`awaiting-approval`（要回答的 requestId，加上這次詢問的工作階段、包名與用途）或 `orchestrating`（這次 run 是為哪個工作階段在跑）。兩條臂都帶工作階段，因為歸組屬於這次 run 而不屬於它的階段；待確認那條還帶著詢問自己的文字，因為 `cordis_define` 什麼都不播 —— 一個請求可以點名上一次登錄檔讀取沒覆蓋到的定義，那時這條活動就是那一行唯一的來源。介面從它渲染、自己不留副本 —— 這正是控制元件能活過 remount 的原因。
- `renderFailures` —— **本頁**最後一次渲染崩潰，按定義索引（槽位、教學 message、以及這次崩潰是否已把 entry 從格位上摘掉），與 live 集合共用同一條通知通道。它按構造就是「本頁當前」：包 stop、被 retract、或重新裝載成功時即清空，所以介面可以直接照著渲染。host 那邊另存一份「跨頁面最後一次」給模型 —— 兩份的歸屬與壽命本來就不同，介面**不要**改成回讀 host 那份。
- `lastRunError` —— 本頁自己那次嘗試為何失敗，按定義索引。它比活動活得更久：host 只拆失敗請求自己啟動的那半，所以一個頁面可能看著 host 報告為「在跑」的定義，而自己什麼都沒裝上。
- `approve(requestId)` / `decline(requestId)` / `startUserRun({ agentId, id, hasClientHalf })` —— 兩條入口。三者都冪等（按 requestId，使用者自發的 run 按定義 id），所以連點兩次不會起兩次 run。`hasClientHalf` 是必填：純 host 定義沒有原始碼可取，所以由呼叫方從它正在操作的登錄檔行裡把這個事實說出來，而不是讓編排器從一次失敗的取碼裡反推。可回答的請求必然帶瀏覽器半 —— 純 host 定義是 host 自己起的，它不會去問頁面。
- `subscribe()` / `getSnapshot()` / `isLoaded(id)` —— 這一頁裝了什麼。`isLoaded` 是頁面本機的事實，永遠不等於 host 說的「在跑」。

## 模型體驗

### 由模型發起那次 run 的最終回答

#### 模型看到什麼

本包自己不貢獻任何工具、提示詞或上下文；它為一次 `cordis/request-run` 往返發回的回答，是它撰寫並到達模型的第一樣內容 —— host 把它變成那個被阻塞的 `cordis_run` 的結果。成功時帶上已裝載的 revision，以及（當瀏覽器半掛在這一頁沒有的服務上時）那些服務的名字。失敗時帶一個 reason：使用者拒絕的 `rejected`、`host-half-failed`、或 `client-half-failed`；後者還帶上本包自己的文字 —— 出錯階段（`evaluate` / `module-import` / `activate`）加上閉包、guard 或 fiber 的訊息。guard 的教學錯誤（未聲明的服務、被遮蔽的瀏覽器全域性、回傳值裡沒有 `apply`）正是經這個欄位到達模型的。而裝載之後、React 渲染時才發生的崩潰，走下面那條獨立的事後通道。

#### token 影響

有條件且有界：每次 run 請求最多一個回答，花在 host 本來就會發出的那個 `cordis_run` 結果裡。文字隨資料而定（某個定義自己的錯誤訊息），本包跨請求不留存任何東西 —— 一頁後續的裝載失敗是頁面本機診斷，在模型側沒有任何承載物。

#### KV cache 影響

只追加。回答只作為「本來就運送中的那次請求」的工具結果到達模型、延長歷史尾部；本包撰寫的內容不會重寫或重排更早的請求 token，因此原本可複用的前綴仍然可複用。同一定義的多次執行各自產出各自的結果，而不是替換更早那一個。

### run 落定之後的渲染期失敗

#### 模型看到什麼

一個裝載得幹乾淨淨的瀏覽器半，仍可能在 React 渲染時崩潰，而那次崩潰發生在 run 已經被回答之後 —— 否則模型只會被告知「ok」，永遠學不到。凡是本頁落座過的包，其 entry 邊界的每一次崩潰都會發回 host（`reportRenderFailure`）：點名槽位、說明這次崩潰是否已把 entry 從格位上摘掉（`abdicated`：包的 UI 是沒了、而不只是壞了），以及一條寫給作者的 message —— 崩潰文字，外加「文字裡點到了某個被摘掉的瀏覽器全域性、但文字自己沒教」時補上的那句教學：繞過閉包陷阱的 `window.setInterval` 只會崩成 `is not a function`，它自己什麼都解釋不了。host 每包只留最後一條，經 `cordis_inspect` 透給模型；這條通道上的任何東西都不會進入 run 的最終回答。同一次觀察還會落到 `renderFailures` 上給本頁介面用 —— 一個觀察者、兩個出口，因為「跨頁面最後一次崩潰（給模型）」與「這一頁此刻正在顯示什麼」是兩件壽命不同的事實。

#### token 影響

有條件，且其上界由 host 的留存策略決定、不由這一頁決定：每次崩潰一條報告，而 host 每包只留最新一條 —— 所以一個反覆崩潰的 entry 對模型的代價是一段話，而不是一張越來越長的清單。報告本身不會自帶任何工具結果：模型只在主動去問的時候才為它付費。

#### KV cache 影響

自身沒有。報告經 RPC 送出並被存起來，而不是追加進對話；模型是透過自己發起的一次查看讀到它的，那次查看與任何工具結果一樣只延長尾部。

## 已知限制與欠帳

- **被拒絕的回答不會重試。** `resolveRequestRun` 的 ack 不讀，所以當 host 拒絕一個過時的成功答覆（`accepted: false` —— 這一頁裝載期間定義的 revision 被頂掉了），這一頁會保留已裝的東西、也不再重新編排。那次請求仍可作答（別的頁面作答或呼叫方取消都能收尾），而頂掉 revision 的那次 stop 會 retract 掉這一頁的過時裝載。重試評估過、延後：競態視窗只是一次往返內的一次 revision 遞增。
- 外掛程式聲明瞭 `remote.dynamic`，因此在 host 側 namespace 存在之前一直掛起，而不是裝載一些永遠夠不到自己 host 半的包。
- 槽位準入（按部署的允許/拒絕清單）沒有載體：下發行聲明的是服務，不是目標槽位。
- guard 白名單是 host 側沙盒門面的手抄孿生；抽取共享規格留待後續。
