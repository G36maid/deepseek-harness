# 新增 Web Client Conversation Node

[English](adding-a-conversation-node.md) | [简体中文](adding-a-conversation-node.zh.md) | 繁體中文

本教學為 Web Client Chat 檢視表新增一行由業務自行擁有的內容。完成後的外掛程式會把一個持久 Session 事件族關聯成一個 Context，增量構造業務 State，發布類型化 Step 資料，再算繪 keyed Chat Node；整個過程不掃描 Session 視窗或其他已算繪節點。本教學假設 Host 已經記錄這些事件，且該 Client 外掛程式已組裝進 Web bundle；Host 側外部 UI 和 Trajectory 等額外檢視表目標不在本文範圍內。

[Conversation Node 組裝決策](../../.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md)記錄完整的引擎模型和設計理由；本文只說明實作路徑。

## 1. 設計可重播的事件族

編寫 Definition 前先選定穩定的業務 id。構成同一個 Node 的每條事件都必須攜帶該 id，或只憑自身 payload 獨立推匯出該 id；Client 絕不能把 update 猜測為屬於“最近一個未完成”的 Context。

以一個 review job 為例，事件約定可以是：

| 事件 | 角色 | 必須持久化的事實 |
|---|---|---|
| `review/start` | 唯一 start | `reviewId`、Turn/Step 坐標、標題 |
| `review/progress` | update | 相同的 `reviewId`、坐標、可重播進度 |
| `review/end` | update | 相同的 `reviewId`、坐標、最終摘要 |

跨行程邊界使用生產方擁有的 branded id 類型。把 `SessionEventMap` 合併和 payload 類型放在生產方的純類型匯出中，再由 Client 包透過僅類型副作用匯入該匯出。每個 `(kind, id)` 最多隻能有一條 start 事件。單事件業務可以把事件自身的穩定身份（例如 `event.seq`）作為 Definition 內部 id。

系統支援增量事件。如果生產方能以較低成本寄出 whole-value checkpoint，應優先採用，因為 start 位於已載入視窗之外時它仍可直接使用。每條 delta 都必須攜帶穩定 id，並且按照日誌 `seq` 升序重播時能夠確定性地產生 State；它不能相依性只存在於即時記憶體中的狀態。如果當前歷史視窗只有 update，Assembler 會保留一個 pending Context，並在更早分頁補齊 start 前不構造 State。如果產品必須在 start 尚未載入時算繪，terminal 或 checkpoint 事件就必須攜帶足夠的完整 fallback 狀態，讓 Definition 能直接構造結果；不要透過掃描無關事件復原它。

## 2. 實作 Definition 與類型化 Chat payload

為了完整展示關聯關係，下面把生產方聲明和 Client 貢獻寫在同一個程式碼塊裡。實際的包族中，branded id 與 `SessionEventMap` 聲明留在事件生產方，Definition、Chat data 合併與 renderer 留在 Client 外掛程式。

```ts ignore-check
import { createElement } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ClientContext, ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ReviewId = Branded<'ReviewId'>

interface ReviewStartData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly title: string
}

interface ReviewProgressData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly completed: number
}

interface ReviewEndData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly summary: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one durable review job.
     * @mode emit
     * @param data - stable identity, location, and initial display state.
     */
    'review/start': ReviewStartData
    /**
     * Records replayable progress for one review job.
     * @mode emit
     * @param data - stable identity, location, and latest progress.
     */
    'review/progress': ReviewProgressData
    /**
     * Closes one review job with its final summary.
     * @mode emit
     * @param data - stable identity, location, and final display state.
     */
    'review/end': ReviewEndData
  }
}

interface ReviewChatData {
  readonly title: string
  readonly completed: number
  readonly status: 'running' | 'completed'
  readonly summary?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'review-job': ReviewChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'review-job': ReviewChatData
  }
}

interface ReviewState extends ReviewChatData {
  readonly turn: number
  readonly step: number
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewData(state: ReviewState): ReviewChatData {
  return {
    title: state.title,
    completed: state.completed,
    status: state.status,
    ...state.summary === undefined ? {} : { summary: state.summary },
  }
}

const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'review/start') throw new Error('review-job requires review/start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      title: match.event.data.title,
      completed: 0,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed', summary: match.event.data.summary }
    }
    return context.state
  },
  publication: match => match.event.type === 'review/progress'
    ? 'animation-frame'
    : 'immediate',
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'review-job',
      value: viewData(context.state),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'review-job',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}

function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ?? `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'review-job',
  }, ReviewNodeView))
}
```

`match(event)` 是身份提取器，不是 fold：它只能收到當前事件，並返回 Definition 內部 id 與生命週期角色。命中後，Assembler 透過 `(kind, id)` 定位 Context，再呼叫一次 `start`，或把當前 State 交給 `update`。兩個函式都必須返回引擎隨後採用的 State；推薦返回新的 immutable value，但函式原地修改後返回同一對象時，採用語義也相同。

`buildLocationData(context, scope)` 可以把 Definition 擁有的資料發布到引擎擁有的 Turn 或 Step 上。透過 declaration merging 為每個 key 指定精確 value 類型。同一 Location 內的另一個 Node 可以使用受限 slot hook（例如 `useTurnData(key)`）讀取該值，無須取得 Session，也無須掃描 `snapshot.chat.nodes`。

`target` 與 `buildViewNode(context)` 必須同時聲明一項由 target 擁有的算繪貢獻。把 `context.key` 保留為 React 側身份，根據持久排序證據選擇 `anchorSeq`，並且只返回 renderer 可以直接使用的資料。某個 target Node 一旦發布，就要繼續返回同一個 key；需要暫時離開可見流時使用 `visibility: 'hidden'`，不要改為返回 `null` 撤回它。

## 3. 只在 start 時查詢更早的業務 Context

有些 Definition 需要另一個業務 kind 在當前位置之前的最新 State。`start` 會收到 `ConversationContextReader`；應在這裡呼叫 `reader.previous<State>(kind)`，不要接收 Context 集合或掃描事件。Reader 返回當前 start `seq` 之前最近一個已啟動 Context 的只讀資料。

Assembler 會記錄這項相依性。如果後續 older prepend 帶來了更近的前序 Context、補齊了原先未知的視窗缺口，或者前序 State 被修訂，引擎會從 `start` 重新執行相依性方 Context，並按 `seq` 升序重播其 update。被查詢的 Definition 仍負責把有用資訊寫入自身 State；Reader 不提供業務專用查詢方法，也不授予修改其他 Context 的權限。

## 4. 理解三條攝入路徑

歷史可能從尾部開始一頁一頁向前請求，但每個已接收分頁都會先按 `seq` 升序歸一化，再進入 State 重播。

| 路徑 | 引擎工作 | Definition 可觀察到的行為 |
|---|---|---|
| open、resync 或 gap repair 時 replace | 重建已載入視窗，每條事件對每個 Definition 匹配一次，再重播每個已有 start 的 Context | 先執行 `start`，再按 `seq` 升序執行其 update；只有 update 的 pending Context 仍沒有 State |
| prepend 一頁更早歷史 | 只匹配新增的更早事件，按 `(kind, id)` 合併進 Context，保留現有 keyed node，並只重放受影響的 Context 與相依性 | 新發現的 start 會啟用已收集 update；Location 或前序相依性變化也可能重跑 Context |
| append 一條即時事件 | 每個 Definition 各呼叫一次 `match`，按 key 尋找命中的 Context，只更新該 Context | 對 start 之後的匹配事件執行一次 `update` 並請求一次發布；不掃描已有 Context |

註冊 `D` 個 Definition 時，一條新事件會進行 `D` 次僅當前事件匹配；命中後的 Context key 查詢是常數時間。Definition 程式碼必須維持這個性質：正常 append 熱路徑不得遍歷完整事件視窗、所有 Context、`context.matches` 或已算繪 Node 集合。累計事實放進 State，同 Turn/Step 共享資訊放進 Location data，有索引的前序相依性使用 `reader.previous()`。

`publication` 控制發生 State 變更後何時物化。結構或 terminal 變化使用 `immediate`，高頻可見 delta 使用 `animation-frame`，只為後續發布積累 State 時使用 `none`。引擎仍會按日誌順序應用每條 update；該選項只合併檢視表發布頻率。

## 5. 驗證重播、分頁與算繪

新增聚焦測試，證明以下結果：

1. 完整視窗透過 replace 後產生預期的最終 State、Location data、Node payload 與 `anchorSeq`。
2. 只有 update 的尾部視窗保持 pending；prepend 唯一 start 後，結果與完整 replace 相同。
3. 初始歷史後繼續即時 append，與重播合併後的完整視窗得到相同結果。
4. prepend 更早分頁只增加更早的行；資料未變化的既有 keyed Node value 不被替換。
5. 重複的可見 delta 保持 `context.key`，並在請求 `animation-frame` 時每幀最多發布一次。
6. keyed renderer 只消費 `node.data` 與受限 Location hook，不掃描 Session 事件視窗、Context 或 Chat Node。

流式與中斷處理可參考 [`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts)，前序查詢可參考 [`inbox.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/inbox.ts) 與 [`message.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/message.ts)，只發布 Turn data 而不建立自有 Node 的例子見 [`packages/client/ui-deliverables`](../../packages/client/ui-deliverables)。
