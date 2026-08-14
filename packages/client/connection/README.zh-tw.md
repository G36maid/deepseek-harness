# @deepseek-ai/dsh-client-connection

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

協議消費層：用戶端外掛程式的 apply 會掛載 `ctx.connection`（共享 API 用戶端 + 當前頁面的 loopback 狀態 + 可觀察且按 generation 生效的 `hostDescription` + 單消費端流迴圈啟動器）；匯出表層攜帶協議約定類型、`AbstractApiClient` 抽象，以及迴圈的 sink／設定類型。每次就緒握手成功後，都會在 `onConnected` 之前發布完整的 `host.describe` 值；generation 失效或顯式 stop 會清空它，因此原生能力消費者不會保留已經斷線的判斷。瀏覽器載體以 HTTP POST 傳送 unary／respond，並為 `events.mux` 與 `events.host` 各開一條只下行的 WebSocket；行程內載體滿足同一雙流抽象。Host half 持有唯一 `/api` route 及其 Fetch bridge；已註冊的 Typert interceptor 會先認領自己的 Remote endpoint，未認領請求再回退 API Proxy。Loopback hostname 判定邏輯留在包內部：`/api` Host fence 與 WebSocket upgrade 會直接使用它，其他用戶端外掛程式則消費派生的 `ctx.connection.isLoopback` 狀態。node 半側的 `/api` 路由讓特權方法集（`host.pickDirectory`、`host.openPath`，以及整個設定面——`settings.describe`/`openDocument`/`update`/`replace`/`mutate` 與 `credentials.describe`/`set`/`unset`；讀取與原生操作也在內，因為 describe 會返回已暴露的設定、打開操作會作用於 Host 桌面，而探測任意引用會報出某條憑據來自何處——以及 agent（代理） preset 的創作面 `agentPreset.read`/`copy`/`openDocument`/`remove`，因為組裝指明瞭一個工作階段所執行的外掛程式，讀取它是偵察，而 copy/remove/openDocument 管理名單並驅動宿主桌面（創作只有複製一種寫入，因此這些方法都不接收組裝文字或路徑）；`agentPreset.list` 與 `agentPreset.select` 不在其中——名單只攜帶 id 與信任等級，而選擇一個 preset 並不比 `session.create` 自帶的 `agentPreset` 多給任何能力，何況默認 preset 本就帶著 bash）以空信任表過信任 fence，從而釘在回環——已聲明的 `trustedHosts` 授權可達其餘全部方法，而這些方法在真正的認證層出現之前仍只限回環本機。平臺載體與 ConnectionController 迴圈屬於包內部；apply 負責選擇並驅動它們。下行邊界見 [WebSocket 下行載體 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md)。

## /api 瀏覽器信任柵欄

node 半側在橋接或 upgrade 前守衛 `/api` 下的每個入口（`src/api-request-trust.ts`）。每個請求——無論是否帶瀏覽器標記——`Host` 都必須是回環地址權威，或與某個 `trustedHosts` 條目匹配：帶埠的 `host:port` 條目精確匹配，不帶埠的條目匹配任意埠，兩側均經 WHATWG 歸一化後比較（DNS rebinding 防禦）。刻意不為無瀏覽器標記的 HTTP 請求開捷徑：明文 HTTP 下瀏覽器的圖片與導覽讀取既不帶 `Origin` 也不帶 Fetch-Metadata，因此無標記請求仍可能是被重綁頁面發起的、回應可被讀走的讀取，而 Host 是重綁唯一偽造不了的請求標頭；WebSocket 瀏覽器握手會帶 `Origin` 並透過同一道比較。非瀏覽器用戶端經由回環地址、部署推導的 LAN IP 字面量或已聲明的權威透過同一道柵欄。當標記存在時，如附帶 `Origin`，則它必須與 Host 權威完全一致；顯式的 `sec-fetch-site: cross-site` 標記一律拒絕。不是純的、規範形 `host[:port]` 權威的 `trustedHosts` 條目——即 WHATWG 解析讀回後與原文不完全一致的——會讓外掛程式載入明確報錯：否則解析會悄悄授權 `harness.internal/path` 這類筆誤裡的 hostname，或把懸空冒號、補零埠放大成任意埠授權。HTTP 失敗在任何 RPC 分發之前以純 403 應答，upgrade 失敗在啟動任何事件串流前拒絕握手。非回環組合必須顯式信任其服務權威：Web 執行時期從全介面伺服器設定推導 LAN IP 字面量，cordis.yml 中的 `trustedHosts` 與 CLI（命令列介面）的 `--trusted-host` flag 則聲明具名權威。`dsh web --host 0.0.0.0` 在遠端訪問具備認證層之前有意不受支持。這道柵欄是可達性策略，而不是認證；Web 載體不提供認證層。決策記錄：[api 瀏覽器信任邊界 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md)。

## `/api` WebSocket 下行

`/api/events.mux` 與 `/api/events.host` 各接受一條 WebSocket upgrade，並只向瀏覽器傳送對應的 `ServerRequest` 文字訊息；用戶端不會在這些 socket 上傳送業務資料。任一 socket 結束都會使當前 connection generation 失敗並重建兩條流，連線就緒仍要求兩條 socket 均已打開且 `host.describe` HTTP 呼叫成功。Host teardown 會終止兩條 socket、中止各自的 source，並等待 source 清理完成後再返回。普通網路 GET 這些路徑會返回 426，不保留 SSE（Server-Sent Events）回退；`toFetchHandler` 的 SSE 編解碼只服務行程內同構載體。

## 模型體驗

無。協議消費層只在瀏覽器與主機之間搬運已經組合好的訊息；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **History 會復原未附加的工作階段**：打開 history 可能建立宿主側 agent，並增加首次打開的延遲；沒有僅從持久化讀取的路徑。
- **`/api` 橋把每個請求體整體緩衝在記憶體裡**：`maxRequestBodyBytes`（默認 160 MiB，按默認 100 MiB 圖片總量上限經 base64 膨脹加信封餘量得出）因此同時是單請求的駐留記憶體上界；要降低它而不縮小圖片限額，需要流式請求體路徑。
