# HTTP 伺服器

[English](web-server.md) | [简体中文](web-server.zh.md) | 繁體中文

[dsh-host-webserver](../../packages/host/webserver) 是 GUI 宿主的瀏覽器 HTTP 載體：它是一個提供 `ctx.webServer` 的 `node:http` 外掛程式，包含具名路由登錄檔、index.html 轉換回呼，以及一個可由外掛程式認領的回退處理器。它不屬於 agent loop（代理循環），也不是能力 seam；它不瞭解任何 harness 概念。其他外掛程式負責註冊所有功能路由，包括 `/api` 橋接、外掛程式 bundle 和 HMR（熱模組替換）事件串流（[分層說明](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)）。該伺服器只服務瀏覽器：Electron 透過 `file://` 載入已建置文件，並經 IPC 橋接傳送 fetch 請求，不使用本伺服器。

原始碼：[`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

## 路由

```ts type-equiv
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
type WebRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named route registration. */
interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

匹配順序固定：先查 exact 表，再取最長匹配前綴，最後落到已註冊的回退。註冊順序不攜帶任何面向請求的語義：具名路由在組合上互不相交，任何未被具名路由認領的請求都由回退席位應答；席位只有一個所有者，第二次註冊會拋出例外。發布的 Web 組合用 [`dsh-host-frontend-static`](../../packages/host/frontend-static/src/index.ts) 認領席位，即遵循固形容詞義的 SPA dist 伺服器：非 GET/HEAD 返回 405，越出 dist 根目錄的遍歷返回 403，任何未命中都以 HTTP 200 回退到 `index.html`（SPA 路由），未知擴充名按 octet-stream 傳送。

## 設定

```ts type-equiv
/** Gateway config: the listen address. */
interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

`host` 只接受 `127.0.0.1`（預設姿態）和 `0.0.0.0`（刻意的網路暴露）；沒有 TLS、驗證或 origin 策略，因此綁定到非回環地址會把伺服器暴露給該網路。dist 位置是認領席位的前端外掛程式的組裝事實。

## 服務

`WebServer`（`ctx.webServer`）在啟用時立即監聽；監聽失敗（EADDRINUSE 等）會使初始化被拒絕，啟動行程會報告失敗的 fiber。`register(route)` 新增一條具名路由並返回其 disposer；重複的 `(kind, path)` 拋出例外，因為路由模式是組合層約定，衝突即設定錯誤。`tapIndex(transform)` 新增一個純 HTML 到 HTML 轉換函式，按註冊順序應用於每個 index 回應（`/` 和每次 SPA 回退）；[dsh-client-modules](../../packages/client/modules) 用它注入啟動 manifest（中繼資料清單）。`port` 讀取監聽埠，包括 `config.port` 為 0 時作業系統分配的埠。

處理過程中拋出例外的請求（畸形的 % 轉義撞上 `decodeURIComponent`、用戶端在請求體中途中斷連線）會記錄為警告並應答 400（回應標頭已寄出時則銷毀 socket），絕不導致行程結束。dispose（資源釋放）把 `close()` 與 `closeAllConnections()` 配對使用，因為處理器可能像 SSE（Server-Sent Events）那樣保持回應打開，而這類連線永遠不會自行結束；沒有強制關閉，拆卸就會掛起。該包從不列印輸出：URL 行歸 shell 所有。逐包運維細節（含開發模式的 bundle 監視管線）留在 [README](../../packages/host/webserver/README.md) 中。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

The browser HTTP carrier service. Activation listens immediately. Route registration order does not affect requests because configured named routes must be distinct, and the fallback handler answers anything not yet claimed during startup with 404 until its owner registers. A listen failure rejects initialization, and the boot process reports the failed fiber.

```ts cordis-catalog
/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler.
 * @returns the disposer removing the route.
 */
register(route: WebRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler answering every request no named
 * route matches (the SPA dist server in the shipped Web composition). One
 * owner only — a second registration throws, because two fallbacks cannot
 * compose.
 * @param handler - owns the full response lifecycle of unmatched requests.
 * @returns the disposer releasing the seat.
 */
registerFallback(handler: WebRoute['handler']): () => void

/**
 * Register an index.html transform, applied by the fallback owner to every
 * index response ({@link applyIndexTaps}) in registration order.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string
```

Source: [`packages/host/webserver/src/index.ts:59`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
