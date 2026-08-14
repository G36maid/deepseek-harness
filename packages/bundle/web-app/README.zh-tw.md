# `@deepseek-ai/dsh-web-app`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

dsh 瀏覽器表層組合包。[`cordis.patch.yml`](cordis.patch.yml) 疊加在 [`dsh-base`](../base/README.md) 之上：設定 coding persona，插入 Web 宿主行（webserver、API 閘道、workspace、投影快取、儲存）、瀏覽器外掛程式名錄與始終掛載的用戶端外掛程式重載鏈（[`dsh-client-hmr`](../../client/hmr/README.md)，在重建 watcher 改寫用戶端 bundle 之前保持空閒），並掛載本包的 `web-runtime` 粘合外掛程式（設定為 `{printUrl, surfaceContext, trustedHosts}`）。該外掛程式透過 `@deepseek-ai/dsh-web-frontend` 的 exports 解析已建置的前端 dist，只採樣一次相依性 bind 的 LAN 信任資訊並將其作為 `webRuntime` 提供給瀏覽器信任柵欄和用戶端名錄，掛載 [`frontend-static`](../../host/frontend-static/README.md) 回退席位所有者，在 `surfaceContext` 為 true 時註冊 Harness 原始碼與 Web 表層提示詞段落，以及 bash 可見的 `DSH_WEB_URL` 執行時期變數，並在 `printUrl` 為 true 時等自身的 Loader 設定樹結帳後再列印 `dsh web:` URL 行，避免兄弟行失敗時公告一個已失效的應用。本組合包還持有應用命令列：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析 `--host`、`--port`、可重複的 `--trusted-host` 以及應用自己的 `--help`，再提供 `webStartup`。它會在發布該服務前拒絕 `--host 0.0.0.0`，因為 CLI 目前有意不支持綁定所有網路介面。由 flag 設定的行會注入該服務，並在惰性設定中直接讀取它，因此參數解析完成前不會有任何東西綁定埠，`dsh --profile web --help` 也不會啟動伺服器。[`dsh-headless`](../headless/README.md) 是同一 base 之上的同級表層，不掛載本組合包。

## 模型體驗

### Harness 原始碼與 Web 表層上下文

#### 模型看到的內容

當 `surfaceContext` 為 true 時，`harness:source` 段落標明磁碟上的 Harness 實作，但不會聲稱它就是工作目錄；全域性段落 `app:web-surface`（順序 −98）則向模型說明 GUI：規範的本機 URL、「this page」指代什麼、更新約定（重載接收端始終開啟；無刷新重載還需要 `pnpm run dev:web` watcher），以及不要啟動替代伺服器的指令。`DSH_WEB_URL` 還會連同描述出現在受管 bash 環境中，每次呼叫時從執行中的伺服器解析。當它為 false 時，這兩個段落和該變數都不會註冊。

#### Token 影響

每個工作階段一行原始碼說明和一段提示詞，外加兩行受管環境變數；每個行程內保持恆定。

#### KV Cache 影響

該提示詞段落位於系統提示詞靠前位置，且在行程整個生命週期內穩定（埠是啟動期事實），因此不會使跨輪次快取失效。

## 已知限制與延期工作

- **前端 dist 必須已建置**：對 dist 的 `require.resolve` 在啟用時明確報錯並給出建置提示；沒有從原始碼直接服務的回退路徑。
- **`lanAddresses` 是啟動期快照**：啟動後的網路卡變化不會重新公告；列印的 LAN URL 始終與設定的信任柵欄一致。
