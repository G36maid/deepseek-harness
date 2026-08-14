# 僅限 Session 內的 Schedule

[English](schedule.md) | [简体中文](schedule.zh.md) | 繁體中文

Schedule 擁有持久提醒；這些提醒會作為普通的後續對話輪次返回原 live Session。[持久 Schedule Agent Note](../../.agents/notes/implemented/feature/2026-08-05-durable-web-schedule.md) 負責持久化與生命週期決策，[對話式交付](../../.agents/notes/implemented/simplification/2026-08-09-conversational-schedule-delivery.md) 負責無回執邊界，[顯式時區邊界](../../.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md) 負責瀏覽器本機解釋，[有界固定速率 Schedule](../../.agents/notes/implemented/simplification/2026-08-09-bounded-fixed-rate-schedule.md) 負責重複調度。本頁記錄 [`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts) 中的持久資料形狀和麵向模型的資料形狀；[包 README](../../packages/schedule/schedule/README.md) 負責組合、工具行為與確切的提醒 framing。

## 持久記錄

`ScheduleId` 是[品牌化 id](core.md#branded-ids)，在單個 Session 內唯一且絕不複用。版本 1 支援正的安全整數 `after_seconds` 延時、顯式的絕對 `at` 目標，或至少五分鐘的安全整數 `every_seconds` 間隔。建立操作會將每個初始目標規範化為使用四位年份的 RFC 3339 UTC `scheduledAt`；`after` 記錄會保留提交的延時，`at` 記錄只儲存結果時點，`every` 記錄則保留固定間隔和下一個目標。

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot record variants that terminate on an id-only dispatch. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** The v1 durable reminder record union. */
type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord
```

## 絕對時間輸入

`at` 選擇器可以是嚴格且帶偏移量的 RFC 3339 字串，也可以是精確的本機日曆對象。本機形式讓這種解釋在工具邊界保持顯式：

```ts type-equiv
/** Structured local-calendar input accepted by `schedule_create`. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by `schedule_create`. */
type AtInput = string | LocalAtInput
```

官方 Web overlay 會為每條提示詞取樣瀏覽器的 IANA 時區。當 open turn 只有一個無歧義的瀏覽器時區時，Time-context 會告訴模型按該請求本機時區解釋未明確限定時區的自然語言日期和時間；provenance 混合或缺失時，則告訴模型詢問使用者。該指引不是持久 Session 預設值：模型仍必須在字串形式中傳入偏移量，或在本機形式中傳入 `time_zone`；Schedule 絕不會讀取瀏覽器、Session、行程或模型上下文。

Schedule 會拒絕無效偏移量與時區、不帶偏移量的字串、非未來目標，以及落在夏令時缺口內的本機時間。遇到夏令時重疊時，會選擇第一次出現的較早時點。建立成功後只儲存規範化後的 UTC `scheduledAt`，因此重播絕不相依性環境時區狀態。

## 固定速率輸入與補償

`every_seconds` 是每條記錄單獨擁有且至少為 300 秒的間隔，以建立時間為錨點。它只提供固定速率重複調度：協定不包含日曆規則或 Cron 運算式、重複調度時區、共享冷卻時間或跨記錄准入閘門。

如果一個 Session 在多個目標到期期間處於 cold 或 busy 狀態，一條 Every 記錄只會貢獻其中最新的一次到期觸發。dispatch 會直接將記錄推進到 dispatch 判斷時刻之後第一個與建立錨點對齊的目標，而不會枚舉、持久化或重播錯過的間隔。如果下一個目標無法落在四位數年份的 UTC 範圍內，最後一次 dispatch 將終結該記錄。

當多條彼此不同的 Every 記錄均已到期，且沒有一次性提醒到期時，每條記錄都會向同一個 follow-up 批次貢獻一次觸發，並按目標時間和建立順序排列。每條 Every 記錄的狀態互相獨立，但該獲準批次中的所有 dispatch 都使用同一個判斷時刻。批次處理限制模型輪次數量；五分鐘下限限制每條記錄的 timer 頻率。

## 持久變更與重播

版本 1 的 `schedule/change` 工作階段事件是 Schedule 唯一的持久權威。create 保存完整記錄，delete 是終結性且僅含 id 的轉換。一次性提醒的 dispatch 同樣是終結性且僅含 id。Every dispatch 攜帶用於選擇最新到期觸發的牆鐘判斷時刻，通常推進活動記錄而不終結它。dispatch 表示 follow-up 已同步入隊，而不表示模型答覆成功或使用者已讀取答覆。

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

嚴格 decoder 與 fold 會拒絕未知版本、額外欄位、複用 id、不匹配的一次性提醒或 Every dispatch 形狀，以及針對非活動記錄的 delete 或 dispatch 轉換。普通 Session 摺疊完整事件串流。fork 只摺疊 `SessionHeader.seedLength` 位置及其後的事件，因此保留歷史，但不會接管父 Session 的活動提醒。`schedule/change` 聲明和原始碼位置也編入[持久化目錄](../persistence-catalog.md#schedulechange--log-only)。

## 活動檢視表與管理

工具值將持久記錄與根據當前牆鐘派生的交付狀態組合起來。`session-local` 表示原 Session 必須處於 live 狀態：不存在外部通知渠道或 cold Session scheduler。

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Fixed v1 delivery boundary: the original session must be live. */
type ScheduleDeliveryMode = 'session-local'
```

```ts type-equiv
/** Complete model-facing view of one active reminder. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

生成的[工具目錄](../tool-catalog.md#deepseek-aidsh-schedule)負責 `schedule_create`、`schedule_list` 和 `schedule_delete` 的參數與結果 schema。一條 Agent-scoped 佇列將管理呼叫與到期工作序列化。每次讀取或判斷都會先等待共享的 Session 持久化 barrier；create 與實際執行的 delete 在追加後還會再次等待。barrier 失敗會報告 `persistence_uncertain`，而不是猜測 eager write 是否已提交。其他穩定錯誤程式碼是 `invalid_prompt`、`invalid_selector`、`invalid_rule`、`invalid_time_zone`、`not_future`、`time_out_of_range`、`frequency_too_high`、`corrupt_schedule_log` 和 `internal_error`。

## Live 交付

行程內 owner 根據持久 fold 派生最早的 timer，並在每次有界等待後重新讀取牆鐘。cold Session 不執行任何工作；重新打開後會重建 timer，並使已經過去的目標進入 overdue 狀態。到期的一次性提醒享有優先級，每次只進入一個後續輪次。當沒有一次性提醒到期時，所有 overdue 的 Every 記錄會組成上述單個批次。

到期工作會先等待 Agent 完全 idle 並認領 maintenance phase，再重新摺疊狀態、取樣本次判斷、將一個 `followup()` 排入佇列，並追加對應的 dispatch 變更。它絕不會呼叫 `steer()`，也絕不會中斷當前輪次。

獲得准入的一次性提醒或固定速率批次會啟動一個普通的後續輪次，且只透過普通對話 transcript（文字記錄）出現；Schedule 不提供獨立的持久 Web 回執或瀏覽器算繪器。如果 framing 構造或同步佇列准入失敗，則不會記錄 dispatch，提醒仍保持活動。佇列准入後、持久 dispatch 前的狹窄崩潰視窗可能使提醒內容在復原後重複，因此該邊界提供的是盡力而為的至少一次交付，而非恰好一次交付。
