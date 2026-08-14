# Client 模組

[English](client-modules.md) | [简体中文](client-modules.zh.md) | 繁體中文

Web 外掛程式表：[dsh-client-modules](../../packages/client/modules) 中 client 模組系統的 Node 半，以 `ctx.clientModules`（`ClientModuleRegistry`）形式提供。它掃描宿主 Loader 的 entry，找出聲明瞭 `dsh.client` 的包，組合出 `window.__DSH_BOOT__` entry 圖，在 `/plugins/<id>/client.js` 提供各個 bundle，並經 index 轉換（index tap）注入啟動 manifest（中繼資料清單）——這是同一個服務的四個面。它是 Web GUI 棧的一項選填能力，不屬於 agent loop（代理循環）主幹，並且是 [dsh-host-webserver](../../packages/host/webserver) 的消費端：[web-server.md](web-server.md) 所述的載體提供本服務註冊的前綴路由與 index 轉換。同一個包的瀏覽器半（`ctx.modules`，即拉取並物化這些 bundle 的 lazy CJS 模組表）屬於核心機件，記錄在[包 README](../../packages/client/modules/README.md)中，不在本頁。

原始碼：[`packages/client/modules/src/client/manifest.ts`](../../packages/client/modules/src/client/manifest.ts)

## wire

圖是 Node 半與瀏覽器半之間協議層的唯一真源：宿主從掃描到的包組合出 `WebBootEntry` 行，把圖作為 `<head>` 中的第一個指令碼注入（`window.__DSH_BOOT__`，其中 `<` 已轉義，外掛程式可控的字串因此無法逃出 script 元素），殼則在啟動任何東西之前先解析它。沒有有效 manifest 的頁面無法啟動——瀏覽器側的解析器在圖缺失或畸形時大聲拋錯。

```ts type-equiv
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
}
```

```ts type-equiv
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /** Composed entries; order carries no semantics (activation order is fiber inject waiting). */
  entries: WebBootEntry[]
}
```

每一行的 `rev` 是該 bundle 的內容雜湊，並作為使快取失效的查詢參數附在 URL 上；圖的 `rev` 對組合後的各行做雜湊，因此任何一行的變化都會改變它。`immediately` 標記第一階段預取檔位（在模組面啟動期間 fetch 並執行，只做登記）；惰性行在首次 import 時才拉取。

## 掃描

包加入這張表的方式，是在自己的 package.json 中聲明 `dsh.client`（`platform: 'web'`、選填的 `inject` 邊、選填的 `immediately`），並在 `exports["./client"]` 匯出建置好的 bundle。包解析錨定在設定樹的 `ctx.baseUrl`——即 cordis.yml 所在目錄，該目錄的包把每個被組合的外掛程式聲明為相依性——這一錨點未設定時，構造即拋錯。

掃描是單包增量的；不存在全量重掃程式碼路徑。fiber 構造或 dispose（資源釋放）時的每次 cordis `internal/plugin` 發射都把該 fiber 的 entry 名標髒，一次微任務 flush 把每個髒名與即時 loader entry 對帳。啟用趟以全部當前 entry 灌入同一個髒集合併同步 flush，因此初掃與穩態共享一條實作——但失敗姿態相反。啟用時，已載入 entry 中的畸形聲明或缺失 bundle 會聚合為一個大聲的 `AggregateError`，列出每個損壞的包：該 fiber 進入 FAILED，由啟動的大聲失敗 sweep 上報。穩態下，損壞的包只記錄一條警告，且不得殃及其他包。

包元資料——包括「非 client 包」這一否定結論——按名快取且永不過期：外掛程式集合的變更在重新啟動後生效。fiber 重新啟動原樣複用其行與 rev；bundle 內容變更只經 `rebuilt()` 到達圖。

## bundle 路由與 index 轉換

`GET`/`HEAD /plugins/<id>/client.js` 以 `no-cache` 從磁碟提供已註冊的 bundle（錨定一致性的是 rev 查詢參數，而非 HTTP 快取）；其他方法返回 405。未知 id——或已註冊、但 bundle 因尚未建置而不可讀的行——回應一個大聲的 404，而不是讓載體的 SPA 回退把 HTML 當作 JavaScript 寄出。index 轉換在每次 index 渲染時注入當前圖，因此重新整理頁面總是針對即時組合啟動。

## 服務

`ClientModuleRegistry`（`ctx.clientModules`，定義於 [`packages/client/modules/src/index.ts`](../../packages/client/modules/src/index.ts)）暴露讀取面與重建面；簽名見生成的[服務目錄](#ctxclientmodules--clientmoduleregistry)。`graph()` 返回當前組合出的圖（兩次變更之間是同一個穩定對象），`clientPath(id)` 返回該 bundle 的絕對路徑。`rebuilt(id)` 是 bundle 內容到達圖的唯一入口：它對文件重新雜湊，只有 rev 真正變化才會重新組合圖並行出通知。`onRebuilt` 按發生變化的 bundle 逐個觸發並攜帶新 rev；`onGraphChanged` 在任何一次重新組合了圖的 flush 之後觸發（行的增刪，或 rebuilt 帶來的 rev 變化），並採用拉取模型——監聽器自行重讀 `graph()`。兩條通知路徑都會兜住監聽器例外，因此一個拋錯的訂閱者既不能讓後續訂閱者被跳過，也不能殺死觸發這次 flush 的一方。

開發環境下，[dsh-client-hmr](../../packages/client/hmr/README.md) 是登錄檔的監視驅動：它的 Node 半從同步取得的基線出發，對圖中每一行的 bundle 做 stat 輪詢，變化時呼叫 `rebuilt(id)`，經 `onGraphChanged` 重新同步監視集合，並透過 SSE（Server-Sent Events）把 rev 變化廣播給瀏覽器半。生產環境的圖完全不含 HMR（熱模組替換）行；模組宿主自身從不監視文件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxclientmodules--clientmoduleregistry"></a>

### `ctx.clientModules` — `ClientModuleRegistry`

The web plugin table service: incremental `dsh.client` scan + wire composition + bundle route + index tap. Construction runs the activation scan synchronously — a malformed declaration or missing bundle among the already-loaded entries aggregates into one loud throw (FAILED fiber; the boot activation audit reports it).

```ts cordis-catalog
/**
 * Current composed entry graph (stable object between changes).
 * @returns the graph served as `window.__DSH_BOOT__`.
 */
graph(): WebBootGraph

/**
 * Absolute path of an entry's client bundle.
 * @param id - entry id (package name).
 * @returns the path, or undefined for an unknown id.
 */
clientPath(id: string): string | undefined

/**
 * Re-hash one bundle (the HMR watch's registration hook — the only entry
 * point through which bundle content changes reach the graph).
 * @param id - entry id (package name).
 * @returns the new rev, or undefined for an unknown id.
 */
rebuilt(id: string): string | undefined

/**
 * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
 * @param listener - receives the entry id and its new bundle rev.
 * @returns the unsubscriber.
 */
onRebuilt(listener: (id: string, rev: string) => void): () => void

/**
 * Fires after any flush that recomposed the graph (row added/removed, or a
 * rebuilt rev change). Pull model: listeners re-read {@link graph}.
 * @param listener - notified with no payload.
 * @returns the unsubscriber.
 */
onGraphChanged(listener: () => void): () => void
```

Source: [`packages/client/modules/src/index.ts:184`](../../packages/client/modules/src/index.ts)
<!-- END GENERATED cordis-surface -->
