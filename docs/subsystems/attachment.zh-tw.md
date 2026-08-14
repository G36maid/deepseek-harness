# 持久圖片附件

[English](attachment.md) | [简体中文](attachment.zh.md) | 繁體中文

附件 seam 將二進位圖片的所有權與工作階段日誌分離。生產方把經過校驗的編碼位元組交給 [`ctx.attachments`](#ctxattachments--attachmentstore-abstract-seam)；只有對象完成持久化後，該服務才會發布不可變的內容尋址引用。工作階段事件和模型可見的 `ImageBlock` 包含該引用及其元資料，絕不包含瀏覽器對象 URL、宿主臨時路徑、提供方 URL 或 base64 資料。

未傳送的瀏覽器草稿可以保留在記憶體中，原生用戶端也可以將其暫存於作業系統臨時儲存。宿主接受使用者訊息後，會先把訊息中的圖片移到 `<DSH_HOME>/attachments/v1` 下，再追加使用者事件。結構化模型圖片輸出遵循同樣的先持久化、後追加事件規則。

來源：[`packages/attachment/attachment/src/types.ts`](../../packages/attachment/attachment/src/types.ts)

## 標識與經過校驗的元資料

`AttachmentId` 是帶類型標記的不透明字串。本機後端目前生成 `sha256:<digest>`，但消費端既不能解析這種表示，也不能據此派生檔案系統路徑。

```ts type-equiv
/** Raster image formats accepted by the version-one attachment path. */
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
```

```ts type-equiv
/** Durable, serializable metadata for one immutable image object. */
interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
}
```

```ts type-equiv
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}
```

引用記錄固有尺寸和編碼長度，使用戶端無需先解碼即可排布歷史記錄；每次權威讀取仍會根據對象重新校驗摘要、媒體簽名、尺寸和元資料。

## 提交與經校驗讀取的資料

```ts type-equiv
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}
```

`saveImage()` 校驗位元組並以原子方式提交一個對象，之後才返回其引用。`validateImage()` 執行相同的准入檢查，但不持久化任何內容；批次呼叫方會在保存任何成員前透過它校驗所有成員，因此校驗拒絕不會留下部分對象。`readImage()` 接受來自已授權工作階段路徑的引用，只在完整性校驗透過後返回位元組。該服務刻意不規定保留策略：復原和 fork 後的工作階段可能共享對象，因此基於引用的垃圾回收會延期實作，而不是與任何一個工作階段的刪除綁定。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxattachments--attachmentstore-abstract-seam"></a>

### `ctx.attachments` — `AttachmentStore` (abstract seam)

Immutable binary attachment service. Implementations validate bytes before publishing a reference.

```ts cordis-catalog
/**
 * Validate one image without persisting it.
 * Batch callers validate every member before saving any member.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns completion after the encoded raster has been fully decoded.
 */
abstract validateImage(input: SaveImageAttachment): Promise<void>

/**
 * Validate and durably commit one image before its owning session event is appended.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns a durable content-addressed reference.
 */
abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

/**
 * Read one image and verify that bytes still match the recorded reference.
 * @param ref - durable reference from the session log.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns the verified bytes and canonical reference.
 * @throws the signal reason when aborted, or a storage error when verification fails.
 */
abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts:29`](../../packages/attachment/attachment/src/index.ts)
<!-- END GENERATED cordis-surface -->
