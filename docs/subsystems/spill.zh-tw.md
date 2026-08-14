# spill 儲存

[English](spill.md) | [简体中文](spill.zh.md) | 繁體中文

spill 儲存 seam 是一項[能力 seam](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)，它持久保存工具的超大文字，並返回面向模型的定位符與檢索指引；該能力拆分到三個包：Service Definition（[dsh-spill](../../packages/spill/spill)，`ctx.spillStore`）、Service Provider（[dsh-spill-local](../../packages/spill/spill-local)，宿主檔案系統中工作階段作用域的私有文件）和 Consumer（[dsh-spill-policy](../../packages/spill/spill-policy)，`tools/post-execute` 策略）。spill 是**一項選填能力**，不屬於 agent loop（代理循環）主幹，因此其詞彙記錄在此處，而不在 [core.md](core.md) 中。預覽機制仍歸 [dsh-output-retention](../../packages/util/output-retention) 所有；該 seam 只保存策略交給它的最終文字。

原始碼：[`packages/spill/spill/src/types.ts`](../../packages/spill/spill/src/types.ts)

## 保存請求

`saveText` 是唯一的服務操作：原樣持久保存 `content`，並返回不透明的定位符、後端提供的檢索提示和準確位元組數。請求攜帶保存時的儲存命名空間（`owner`）、生成內容的工具和呼叫（`source`，用於命名和檢查，而非訪問控制）以及後端可用作命名提示的 `suggestedName`（它不是路徑）。

```ts type-equiv
/** One request to persist text to a spill artifact. */
interface SaveTextSpill {
  owner: SpillOwner
  source: SpillSource
  /**
   * A caller-suggested base name (e.g. `web_fetch.txt`). The backend sanitizes
   * it to a single safe path segment before use — it is a hint, never a path.
   */
  suggestedName: string
  /** The full text to persist (UTF-8). */
  content: string
}
```

```ts type-equiv
/**
 * Save-time storage namespace for a spilled artifact. The session id lets a
 * backend group storage under the producing session, but the returned
 * {@link SpillLocator} is the model-facing handle. Forked sessions inherit
 * locators already present in the seeded log; those artifacts are not copied or
 * re-owned, and spills produced after the fork use the child session id.
 */
interface SpillOwner {
  sessionId: SessionId
}
```

`SpillOwner.sessionId` 是保存時的儲存命名空間。fork 後的工作階段會從種子日誌繼承已有的 spill 定位符；這些產物不會被複制或重新取得所有權，fork 後產生的 spill 則使用子工作階段 id。保留期清理可以連同其他舊工作階段產物一起使舊定位符失效；spill seam 不定義逐工作階段的清理策略。

```ts type-equiv
/**
 * Tool and call that produced one spilled artifact — recorded by the backend for a readable
 * filename and inspection. Not interpreted for access control; purely
 * descriptive.
 */
interface SpillSource {
  /** The tool whose result was spilled (e.g. `web_fetch`). */
  toolName: string
  /** The model-issued call id the result belongs to. */
  callId: CallId
  /** A short human label for the artifact (e.g. `result`). */
  label: string
}
```

## 結果

```ts type-equiv
/** A saved spill artifact: its locator, byte length, and backend-specific retrieval guidance. */
interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

`SpillLocator` 是後端返回的[品牌化](core.md#branded-ids)面向模型控制代碼。本機後端將它算繪為檔案系統路徑；遠端或資料庫後端可以算繪 URI、鍵或命令 token。消費端將它視為不透明值，並使用 `retrievalHint` 算繪，而不是假定 `read` 始終是正確的檢索機制。

```ts type-equiv
/**
 * Opaque model-facing handle for one spilled artifact. A local backend may use a
 * filesystem path; a remote or database backend may use a URI or key. Consumers
 * render it with {@link SpillRef.retrievalHint}, but do not parse it.
 */
type SpillLocator = Branded<'SpillLocator'>
```

## 服務

`SpillStore`（`ctx.spillStore`，定義於 [`packages/spill/spill/src/index.ts`](../../packages/spill/spill/src/index.ts)）是隻有一個方法的抽象服務：`saveText(input) → Promise<SpillRef>`。它持久保存完整的 `content`，並在實際儲存失敗（權限、ENOSPC、後端不可用）時拒絕。該 seam 只負責儲存：不負責保留策略、工具結果替換或檢索／搜尋 API。

本機後端（[dsh-spill-local](../../packages/spill/spill-local)）寫入 `<root>/session-<hash>/<random>-<safeName>`：根目錄是已設定或延遲建立的私有（0700）目錄，工作階段子目錄採用 `sha256(sessionId)`，並透過排他且僅所有者可訪問的寫入（`open(path, 'wx', 0o600)`）防止預先植入的符號連結重定向寫入。其 `locator` 是本機路徑，`retrievalHint` 則告知模型在該路徑上使用 `read` 或 `grep`。策略消費端（[dsh-spill-policy](../../packages/spill/spill-policy)）會把超過 `maxInlineBytes` 的純文字最終結果替換為保留庫生成的首尾預覽和 spill 引用；該程序盡力而為：保存失敗時保留原始內聯結果，而不會把成功的呼叫變成 `isError`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspillstore--spillstore-abstract-seam"></a>

### `ctx.spillStore` — `SpillStore` (abstract seam)

Abstract spill storage service. Subclass, implement saveText, and load the subclass as a plugin — it registers as `ctx.spillStore` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- saveText persists the FULL `content` verbatim and returns an opaque locator, exact byte length, and model-facing retrieval guidance.
- Storage is scoped by the request's SaveTextSpill.owner session; the backend chooses a private (not world-readable) location and a collision-free name derived from — never equal to — the caller's `suggestedName`.
- `saveText` REJECTS on a real storage failure (permissions, ENOSPC, backend unavailable); the caller decides how to degrade (the spill policy treats a rejection as best-effort and keeps the inline result).

```ts cordis-catalog
/**
 * Persist `input.content` to a session-scoped spill artifact.
 * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
 * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
 */
abstract saveText(input: SaveTextSpill): Promise<SpillRef>
```

Source: [`packages/spill/spill/src/index.ts:45`](../../packages/spill/spill/src/index.ts)
<!-- END GENERATED cordis-surface -->
