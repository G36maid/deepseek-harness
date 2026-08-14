# dsh-brand

[English](README.md) | 繁體中文

`Branded<B>` 名義類型原語：一個微小的**僅類型**包，無執行時期程式碼，也不相依性其他 harness 包；所有負責跨邊界 id 的包都會共享它。

## `Branded` 是什麼

品牌使 `SessionId` 和 `CallId` 這樣結構相同的字串在類型層面不可互換，儘管兩者在執行時期都是普通 `string`。

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

export type SessionId = Branded<'SessionId'>

/** Brand a string as a SessionId (a plain cast — zero runtime cost). */
export function SessionId(id: string): SessionId {
  return id as SessionId
}
```

構造操作透過所屬包中各 id 專用的工廠完成。比較、日誌記錄、JSON 序列化和協定格式（wire format）的行為與普通字串相同；品牌資訊會在編譯時被擦除。

## 策略：為跨包邊界的 id 新增品牌

包為自己擁有的 id 新增品牌：`CallId` 位於 `dsh-llm`，共享的 agent/工作階段 `SessionId` 位於 `dsh-session`，`JobId` 位於 `dsh-jobs`。為可能被混淆的跨包 id 新增品牌，但無需為每個字串都新增。

該包只負責這一原語。保持無相依性意味著，例如 `dsh-jobs` 可以為 `JobId` 使用品牌類型，而無需僅為使用 `Branded` 而匯入不相關的功能包。
