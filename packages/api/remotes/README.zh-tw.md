# @deepseek-ai/dsh-api-remotes

[English](README.md) | 繁體中文

為本應用選定的 Host Remote 能力提供雙側 BFF。Host 入口負責 Agent/Session 身份策略；Client 入口以執行時期值形式匯入生成的 `/remote` 產物，透過 `ctx.remote.$mount()` 掛載每項貢獻，並重新匯出對應的聲明合併。Client 業務包相依性該外觀，而不相依性 Gateway 實作或單獨的 Remote 執行時期入口。

`createApiRemoteAgentResolver()` 會複用 live Agent、復原普通冷工作階段、對並行復原去重、保留 subagent ownership fence，並為 Typert `agent` 和 `session` lookup 設定同一個 resolver。標準 Web API Proxy 提供 Agent 預設值和 scope 設定，再將返回的 resolver 用於舊方法，使已遷移與未遷移方法共用同一份策略實作。

當前 Client 組合掛載 Goal Remote 貢獻和只讀 Host 外掛程式清單貢獻（`pluginInventory/list`）。該組合解除安裝時，Cordis effect 的所有權機制會撤回所有貢獻；`@deepseek-ai/dsh-api-gateway/client` 負責描述符校驗、可追蹤 namespace Service、直接與作用域方法、呼叫與取消。Client 入口透過 Cordis 消費共享的 `TypertClientRemote` 介面，不匯入具體 Gateway；它只以 type-only 形式重新匯出 Gateway Client face 的聲明合併，因此消費端經由本外觀取到轉發事件詞彙時，執行時期不會多出一條通往 Gateway 實作的邊。

本包不包含傳輸邏輯或 Host 服務發現邏輯。Web 或未來的 TUI 只要提供同一份不相依性 React 的 `ctx.remote` 約定，均可複用其 Client face。

## 轉發的 Host 事件

`src/remote-events.ts` 持有 `API_REMOTE_FORWARDED_EVENTS`——本應用原樣轉發給消費端的 Host cordis 事件名單（無投影、無脫敏、無改名），它同時就是 `ctx.remote.$on` 的合法鍵集；只含類型的 `src/types.ts` 派生其選擇面。多轉發一個事件只需在該陣列裡加一行：類型投影、消費端鍵面與 Host 轉發迴圈全部由它派生。

監聽器簽名不在此處重寫。名單內每條事件的 cordis `Events` 聲明都住在其 owner 包 client-safe 的 `./types` 出口（`dsh-agent-presets`、`dsh-commands`、`dsh-credentials`、`dsh-llm`、`dsh-settings`），本包兩個 face 都把那些聲明納入編譯面，因此「原樣轉發」是構造性成立的，不需要另立證明。Host face 還額外把名單斷言給 `TypertForwardableEvent`：未聲明的事件名、綁定 AgentScope 的事件、以及形狀不是單向的事件都會在此被拒絕。

## 建置邊界

倉庫中的普通包只屬於一個 TypeScript face：Host 包登記在根 `tsconfig.host.json`，Client 包登記在根 `tsconfig.client.json`。`api-remotes` 是唯一刻意拆分的特例，因為它的 Host 入口要參與 Host Typert 圖，而 `src/client/index.ts` 必須等 Host tsdown 生成業務包的 `/remote` 聲明後才能編譯。

本包根 `tsconfig.json` 只是引用 `tsconfig.host.json` 與 `tsconfig.client.json` 的 solution。Host aggregate 和 Host 直接消費端引用前者，Client aggregate 和 Client 直接消費端引用後者；禁止把包根 solution 放進任一 aggregate 的相依性圖。兩個 project 擁有互不重疊的原始碼和 `.tsbuildinfo`，但共享 `lib/types` 輸出目錄——只有一處刻意的例外：`src/remote-events.ts` 與 `src/types.ts` **同時**列進兩個 face 的 `files`，因為轉發事件名單是「消費端能收到什麼」的唯一控制點，Host 轉發迴圈與 Client 的 `ctx.remote.$on` 鍵面必須讀同一份聲明，而不是兩份可能彼此漂移的聲明。

這條例外不止是一行 `files`。根 `tsconfig.base.json` 把 `@deepseek-ai/dsh-api-remotes/types` 對映到 `src/types.ts`——**源平面**，與其餘所有 workspace 子路徑一致，也與生成的 `/remote` 產物相反（後者沒有 `paths` 條目，靠 `exports` 命中建置產物）。於是兩個 face 都把同一份名單與類型投影收進各自的 program，並向 `lib/types` 發射逐字相同的 `remote-events` 與 `types` 輸出；`.tsbuildinfo` 仍各自獨立。沒有任何閘門強制兩個 face 的原始檔互不重疊——`scripts/project-reference-faces.ts` 只校驗「引用一個 split project 必須指到對應 face」——因此本段記錄這次雙列為何是有意的。


包內 `clientBundle(..., { hostPhase: true })` 讓 Host tsdown 打包 Host 入口，讓後續 Client tsdown 只打包 browser 入口。普通 Client 外掛程式仍使用單一 Client project，並在 Client tsdown 階段一起生成 Node loader 入口和 browser bundle；不得因一個包同時存在 `src/index.ts` 與 `src/client/index.ts` 就複製本包的拆分。

## 模型體驗

無，因為該 BFF 只選擇 Remote 應用方法和身份策略，不註冊任何模型介面。

#### KV Cache 影響

無直接影響；其觸發的任何模型可見行為均由已掛載的 Host 能力負責。

## 已知限制與暫緩事項

- 能力集合由建置時顯式匯入的值固定確定；Client 不會在執行時期發現 Host 中已啟用的服務或 Remote 定義。
- 若要增加能力，必須顯式匯入相應的 `/remote` 值並在此組閤中掛載。
- 在剩餘 BFF 設定遷移到 `api-remotes` 之前，標準 Web Host 仍從舊 API Proxy 提供復原預設值與 Agent scope 設定。
