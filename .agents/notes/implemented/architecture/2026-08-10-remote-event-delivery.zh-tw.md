# Agent Note: Remote 事件投遞（ctx.remote.$on）

Status: implemented

[English](2026-08-10-remote-event-delivery.md) | [简体中文](2026-08-10-remote-event-delivery.zh.md) | 繁體中文

## 問題

[Typert Remote 方法呼叫](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md)只覆蓋「一次請求一個結果」的定向呼叫，明確把 Session 事件串流與有狀態互動留在別處；Host 向消費端的**單向事件推送**因此仍然全部壓在殘留的 API Proxy 上。

Host 擁有 `agent-preset/selected`、`commands/change`、`credentials/updated`、`llm/adapters-updated`、`settings/document-updated` 這五條單向事件；它們既不相依性 AgentScope，載荷也本來就是 JSON。過去每條都要穿過 host cordis 事件、apiproxy 手寫幀、client/runtime 手寫橋和 Client 事件別名才能抵達 UI，而這些層沒有陳述 owner 事件之外的新事實。

那份重複聲明還是**有損**的：client 側寫成 `settings/changed(ns: string)`，brand 類型在這一跳被拍平成裸 `string`，與 Remote 方法側「消費端類型指向業務包唯一符號」的既有契約相反。

## 決策

消費端 Remote 面持有一個單向事件訂閱動詞 `ctx.remote.$on(event, listener)`；**名單驅動程式、原樣轉發**：

- `packages/api/remotes/src/remote-events.ts` 持有一份可轉發 host 事件名單，它同時是「消費端能訂閱什麼」的唯一控制點。旁邊的 `src/types.ts` 由它派生類型投影並填充 selection 座位，按包約定保持純類型。兩個文件**都同時列進本包 host 與 client 兩個 face 的 `files`**，兩側讀同一份。
- wire 上的事件名 **就是 host cordis 事件原名**（`settings/document-updated`），不加 `host/` 前綴；載荷 **就是 host 的實參清單**，逐元素原樣過 JSON，無投影、無脫敏、無改名。
- 載體**寄生現有 host 流**：`HostFrame` 加一個包裹幀 `host/remote-event`，不新開下行通道。
- 事件**簽名**不另立表：owner 包把自己的 cordis `Events` 聲明搬進 client-safe 的 `./types` 純類型出口，兩側讀**同一份**——`$on` 的 listener 類型就是 `Events[Event]` 本身。「原樣」不需要證明，是構造性成立的。
- 但**只借 cordis 的類型形狀，不接 cordis 的事件系統**：投遞語義、登錄檔、例外處置全歸 Typert 自己。

一條 `Events` 條目若簽名裡夠到了 host-only 符號（Service、`Agent`、Context 等），處理方式是**把程式碼拆到能幹淨落進 `./types` 為止**；不接受「一半留 index、一半搬走」的分裂聲明，也不接受在 `./types` 裡造結構等價的影子類型。這五個包都不需要拆：它們的條目只夠到純類型。agent-presets 把原詞彙模組改名為 `preset.ts`，讓匯出的 `types.ts` 專門承載 client-safe 事件聲明。

五條事件全部走這條路徑，專用幀與 Client 別名都已刪除。模型消費端直接訂閱 `llm/adapters-updated` 和 `settings/document-updated`；preset 消費端訂閱 `agent-preset/selected`。真正需要投影或去重的資料仍保留專用幀。

`skills/change`、`tools/change`、`system-prompt/change` 是同形狀的純失效事件但目前**沒有任何消費者**，按「每個抽象都要有當前 owner 與需求」不進名單，只作為擴充位記錄在此。

### 消費端契約（dsh-typert-protocol）

type-meta 加一個**形狀謂詞**、一個**選擇座位**和 `TypertClientRemote` 的**一個**成員；零執行時期程式碼：

```ts
import type { Events } from '@deepseek-ai/cordis'

/** Cordis events shaped for one-way remote delivery: no Scope binding, void return. */
export type TypertForwardableEvent = {
  [Event in keyof Events]: unknown extends ThisParameterType<Events[Event]>
    ? ReturnType<Events[Event]> extends void ? Event : never
    : never
}[keyof Events]

/** The Host assembly's forwarding selection; api/remotes' allowlist fills it, no other package does. */
export interface TypertRemoteEventSelection {}

/** `$on`'s legal keys: selected, and present in the current compilation face. */
export type TypertRemoteEvent = Extract<keyof Events, keyof TypertRemoteEventSelection>
```

```ts ignore-check
/** Subscribe to one forwarded Host event; the returned disposer belongs to the calling fiber. */
$on<Event extends TypertRemoteEvent>(event: Event, listener: Events[Event]): () => void
```

`Events` 按程序解析：host 程序裡是 host 事件全集，client 程序裡是 client 編譯面看得見的那些——同一個謂詞在兩側各自成立，不需要把 host 聲明拖進 client。

**契約把消費動詞與載體交接分開**：消費端用 `$on` 訂閱，持有 host 幀 sink 的一方用 `$dispatch` 把解碼後的幀交進來。它**不能**是一個跨外掛程式的模組級函式：client bundle 純度閘門（`packages/client/tsdown.client.ts`）只放行 `CLIENT_EXTERNALS`、`INLINE_SAFE` 那層 wire 契約與 `/remote` 生成物三類值匯入，而靠 inline 繞過會把 `ClientRemoteService` 複製一份進 runtime bundle、令 `instanceof` 恆假。cordis 服務方法正是該閘門指定的協作形態：

```ts ignore-check
$dispatch(event: string, args: readonly unknown[]): void
```

持有 host 幀 sink 的 client/runtime 直接呼叫它，幀不經中轉事件即到達訂閱表。`event` 形參是 `string` 而非 `TypertRemoteEvent`：這是 wire 邊界，收到無人訂閱的名字即靜默丟棄。

投遞語義與 cordis 事件系統不共用實作：只有單向投遞，沒有 waterfall / bail / parallel / serial 模式，也沒有 `@mode` 概念（`ReturnType extends void` 是這條紀律的靜態表達）；不綁 `this`；沒有 `EventOptions`、`prepend`、優先級；按註冊順序逐個呼叫，單個 listener 拋錯就地隔離並記日誌——它絕不能拖垮幀泵（沿用 `ConnectionController` 對 sink 例外的既有處置）。

### 名單：兩個 face 共讀的同一份聲明

`packages/api/remotes/src/remote-events.ts` 同時列進 `tsconfig.host.json` 與 `tsconfig.client.json` 的 `files`，是名單的**唯一家**；`src/types.ts` 由它派生類型面：

```ts
// remote-events.ts — the value
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'llm/adapters-updated',
  'settings/document-updated',
] as const

// types.ts — the type face, derived
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
```

於是**加一個事件只改這一行陣列**：類型投影、`$on` 的鍵面、host 的轉發迴圈全部從它派生。`ctx.remote.$on('slots/changed', …)`（client 本機事件）或 `$on('skills/change', …)`（名單沒開）都是**編譯錯誤**。

host 半再加一處形狀斷言，把 host 事件詞彙的約束落到同一份名單上：

```ts ignore-check
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]
```

寫成表達式語句而不是命名常數：後者會被 `noUnusedLocals` 判為未使用（底線前綴只豁免參數）。它卡住三件事：**名字合法**（謂詞以 `keyof Events` 為基）、**不綁 Scope**（`goal/changed` 那族的 `ThisParameterType` 不是 `unknown`，被排除——「不相依性 AgentScope」的靜態表達）、**單向**（非 `void` 返回的 waterfall/bail 形狀被排除）。

**「原樣」不在任何地方證明，而是構造性成立**：`$on` 的 listener 類型取自 owner 包 `./types` 裡那一份 cordis `Events` 聲明，host 轉發讀的是同一份，不存在可以彼此偏離的第二份聲明。

載荷 JSON-safe 交給執行時期：apiproxy 轉發前用 `dsh-session` 的 `isJsonValue` 逐元素校驗，不合格**拋錯 fail loud**（這是名單設定錯誤，不是外部輸入）。

### 線協議（apiproxy）

```ts ignore-check
| { type: 'host/remote-event'; event: string; args: JsonValue[] }
```

zod 側 `args: z.array(z.unknown())`：幀本身來自 `JSON.parse`，元素必然已是 JSON 值，結構契約由 owner 包的 `Events` 聲明承擔——與既有 `session/projection` 幀的 `value` 同 posture。

`events.host()` 打開時按名單掛監聽；每條流自持 disposers，無需新增廣播集合或派生失效 listener。


`api/events.ts` 是瀏覽器側也要編譯的 wire 契約文件，所以它引用的每個類型都必須走 owner 包的 **client-safe type-only 子路徑**，絕不能走包根出口。實證：從 `@deepseek-ai/dsh-session` 根引一個類型，就把根出口的 `declare module 'cordis' { interface Context { sessions: SessionStore } }` 拖進 client 編譯面、把 client 的 `ctx.sessions: ISessions` 頂掉，在完全無關的 `ui-input-trigger` / `ui-conversation` 裡炸出 18 條錯。`JsonValue` 因此需要 `dsh-session/src/types.ts` 補一條 re-export。

### apps/web 的 browser e2e 屬於 Host 面

`apps/web/tests/**` 那批 e2e 在**根 `tsconfig.host.json`** 做型別檢查：它們在行程內起真 harness、直接摸 `ctx.apiProxy`、host `SessionStore.get/create/flush`、`ctx.sessionProjectionCache`。**執行時期用瀏覽器 ≠ 類型上屬於 client 程序**——把它們搬進 client 聚合會立刻報 21 條錯，因為一個 program 裝不下兩個 face 對同一個 Context key 的合併。

由此得到一條對本設計要緊的連帶紀律：**這些測試從用戶端包 import 值或類型，會把該包的整個 project——以及它引用的每個 project——拖進 Host 建置圖**。`ui-settings-general`/`ui-settings-models`/`ui-permission`/`ui-commands` 四個消費者 references `api/remotes` 的 client face，而該 face 必須等 host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 才能編譯，於是形成建置期死結：host tsc → api/remotes client face → `goal/remote` → host tsdown → 排在 host tsc 之後。

所需的用戶端符號在測試側**映像檔**了一份（`scaffold.ts` 匯出映像檔後的 welcome-notice 常數，兩個 chat e2e 直接引 `dsh-client-runtime/client` 因為 `runtime` 工程本來就在 host 圖裡），從而讓那 4 個消費者離開了 host 圖；`apps/cli/tsconfig.json` 裡 15 條 client 工程引用隨之失去 owner-map 職責，已一並刪除。映像檔值與源逐字一致，漂移的表現是選擇器失配或通知未被抑制，都是響亮失敗。

### 改動清單

| 位置 | 改動 |
|---|---|
| `dsh-typert-protocol` | `src/types.ts` 加 `TypertForwardableEvent`、`TypertRemoteEventSelection`、`TypertRemoteEvent`；`TypertClientRemote` 增 `$on` 與 `$dispatch`。純類型，零執行時期 |
| `api/gateway` client 半 | `ClientRemoteService` 實作 `$on`（訂閱按註冊項尋址、`ctx.effect` 歸屬呼叫方 fiber）與 `$dispatch`（快照後按註冊順序派發，收容拋出或拒絕的 listener） |
| `api/remotes` | 新增 `src/remote-events.ts`（名單值）與 `src/types.ts`（類型投影 + 選擇座位），兩者都雙列進兩個 face 的 `files`；`./types` 出口 + `files` 補 `lib/types/**/*.js`；host 半加形狀斷言並 `import type {}` 三個 owner 包的 `./types`；client 半 `export type {}` 那三個 `./types` 與 `@deepseek-ai/dsh-api-gateway/client` |
| 根 `tsconfig.base.json` | 加 `dsh-settings/types`、`dsh-credentials/types`、`dsh-api-remotes/types` 三條 `paths`，全部指向**源**平面 |
| `dsh-commands` / `dsh-settings` / `dsh-credentials` | `interface Events` 子塊移入各自 client-safe 的 `./types`（settings/credentials 新建該出口，brand 與純類型一並移入，index 繼續 re-export 並留住構造器；`files` 補 `lib/types/**/*.js`） |
| `host/apiproxy` | `HostFrame` 增 `host/remote-event`、刪除五個專用變體及其 zod；`events.host()` 按名單掛監聽並透過 `assertJsonArgs` 校驗 |
| `dsh-session` | `src/types.ts` 補 `export type { JsonValue }`，讓 wire 契約文件能走 client-safe 子路徑 |
| `client/runtime` | 五條 Client 事件橋分支收斂為 `ctx.remote.$dispatch(frame.event, frame.args)`，並刪除重複聲明 |
| 5 個消費者 | ui-commands / ui-settings-models / ui-settings-general / ui-permission / ui-agent-preset 改訂 `ctx.remote.$on(...)`；照 `ui-goal` 先例 type-only 引 `@deepseek-ai/dsh-api-remotes/client` 並把 `'remote'` 加進 `inject` |
| `client/connection` | fixture 的 `emitHost` 造 `host/remote-event` |
| `apps/web/tests` + `apps/cli` | 用戶端符號映像檔（見上節）；`apps/cli/tsconfig.json` 刪 15 條 client 工程引用 |

## 備選方案

**給 Remote 事件新開一條通用下行通道**（`ctx.connection.rpc` 的推送對偶，第三條 WebSocket）。最符合「Connection 獨佔載體、Gateway 不碰傳輸」；但要同時改 host 下行、`WebApiClient`、`ConnectionController`、fixture 與 web e2e 各一條流，代價與本次收益不匹配。寄生 host 流的代價是新契約暫時寄居在 legacy 幀聯合裡——host 流將來整體搬家時它隨之搬走，消費端契約不變。

**在 type-meta 立一張獨立的 `TypertRemoteEventMap`，讓 owner 包 declare-merge 進去**。消費端鍵集會精確等於「被聲明為可遠端投遞的事件」；代價是每條事件的簽名要在 cordis `Events` 之外**再寫一遍**，於是需要一條雙向 `extends` 的等價性證明來防漂移，還要給三個 owner 包新增 type-meta 相依性。共用同一份 `Events` 聲明讓等價性變成構造性成立，這張表因此不立。

**讓 typert generator 從 host `Events` 聲明生成事件投影**（codec + `.d.ts` + 聲明對映，與 `/remote` 同族）。generator 已經在分析 host 事件；但它拿不到投影與脫敏語義，且要動生成器與建置面。原樣轉發這條路本就不需要投影。

**給可轉發事件載入荷投影函式**（`{ 事件名, 投影, zod }` 轉發表）。能一舉覆蓋 `models-changed` 的 fan-in 與 workspace 的 view 派生；代價是投影邏輯與載荷類型手工對齊，回到方法側剛剛消滅的中心表形態。

**把 apps/web 的 browser e2e 搬進 client 聚合**。看似「用戶端測試歸用戶端面」，實測立刻 21 條錯：它們用 host 服務，而 client 程序裡 `ctx.sessions` 是 `ISessions`。已否。

**給 `directory-picker-browse`/`-native` 做 host/client 雙 face 切分**，從根上讓用戶端包不進 host 圖。方向正確（它們確實是未切分的雙半包），但改動落在別人屬地，而收益只是「建置圖更乾淨」——本設計在測試側映像檔用戶端符號之後已經不需要它。**已評估不做**。

## 驗證

釘住該行為的東西：

- 一個真組合測試：host 每 emit 一次，真實 host 流就出一幀 `host/remote-event`，`event` 為 host 原名、`args` 與實參逐元素相等。
- 類型層負例拒絕三類候選：不是事件的名字、綁 Scope 的事件（`goal/changed`）、回傳值非 `void` 的事件。`$on('slots/changed', …)`（client 本機事件）與 `$on('skills/change', …)`（已聲明但未選中）都編譯失敗——因此 `$on` 的鍵面恰好等於名單。
- 消費端 `$on('settings/document-updated', …)` 把 `ns` 解析為 `SettingsNamespace`：brand 穿過 wire 存活。
- `$on` 的 disposer 歸屬呼叫方 fiber；同一個函式對象訂閱兩次時兩條註冊各自獨立退訂——按 listener 身份做鍵的表會把它們合併，所以訂閱按註冊項尋址。
- 投遞同時收容拋出的 listener 與拒絕所返回 promise 的 listener：聲明回傳值是 `void`，沒人 await 非同步 listener，其拒絕否則會完全逃出這層收容。投遞遍歷快照，因此派發中訂閱或退訂都不會改變本幀的接收者集合。
- `assertJsonArgs` 直接單測，而不是從事件總線造畸形 emit：類型化的 `ctx.emit` 造不出來——名單內每條事件的載荷在靜態上都是 JSON-safe 的。
- 五個專用幀、五條 Client 別名及其橋分支都不存在；各消費端直接觀察 owner 事件。

## 後果

- **寄居在 legacy 幀聯合裡**：契約住在 apiproxy 的 `HostFrame` 中，讀者可能誤以為 apiproxy 擁有 Remote 事件。該幀的 JSDoc 點名名單歸 `api-remotes`，apiproxy README 在 known limitations 記錄這項寄居。host 流將來整體搬家時，包裹幀隨之搬走，消費端契約不變。
- **兩個文件打破了 api/remotes 的 face 互斥約定**：`src/remote-events.ts` 與 `src/types.ts` 同屬兩個工程，各自向共享的 `lib/types` 發射一份相同聲明。內容逐位元組相同、`.tsbuildinfo` 各自獨立，實踐上無害；README 的建置邊界節陳述了這個例外及其成因（`paths` 指向原始碼面）。
- **載體交接是開發者可見的**：任何持有 `ctx.remote` 的 client 外掛程式都能調 `$dispatch` 合成一條轉發事件。這個暴露面早於該動詞存在——先前由內部事件中轉幀時，`ctx.emit` 同樣可達——與 `connection/reset` 可被偽造成重連同一量級（client 是單一信任域）。測試只釘「交接到 `$on` 的轉換」，不假裝該埠鑒別調用方。
- **畸形實參在發射方的收容裡失敗，而非載入期**：`assertJsonArgs` 在轉發監聽內拋出，因此由發射 seam 自己的 listener 收容記錄並丟棄該幀——響亮地出現在 host 日誌裡，而不是載入時或 emit 點。
- **測試側映像檔值可能漂移**：沒有任何機制核對 `apps/web/tests` 中映像檔的 client 常數與其源；安全網只是漂移會讓選擇器失配。規則寫在 `apps/web/tests/README.md`，由 review 守；grep 級閘門經評估後刻意不做。
- **放棄的能力**：不支持投影或脫敏載荷、不支持 Scope 化事件（`agentCtx.remote.$on`）、重連不重放——這些都是純失效訊號，且 `connection/reset` 已覆蓋重連後的重新拉取。mux 流的工作階段事件、可應答幀與快照基線不在範圍內。
- **仍有 client 包留在 host 圖裡**：12 個工程（`connection`、`runtime`、`ui-slots` 等）經未拆分的 `directory-picker-browse`/`-native` 與 `api/gateway → client/connection` 仍可達 host 圖。它們都能編譯且不再牽連 api/remotes 的 client face，因此沒有阻塞本次改動；拆分那些包能減少幾個，但經評估後不做。兩個 chat e2e 直接引 `dsh-client-runtime/client` 相依性 `runtime` 本來就在圖裡——屬偶然而非保證。
- **invariant companion 不做執行期檢查**：早先的修訂曾在活事件總線上斷言投遞形狀（`thisArg === null`、`mode === 'emit'`），這讓 companion 與名單值耦合，並使 rolldown 把它提成第三個 bundle chunk——而機械推導的發布文件清單並不攜帶它。host 面的 `TypertForwardableEvent` 斷言在編譯期已拒絕這兩種偏離，因此該 companion 是一個帶說明的空 installer。
