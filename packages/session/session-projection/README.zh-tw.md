# @deepseek-ai/dsh-session-projection

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工作階段投影 Service Definition 與驅動登錄檔。它擁有 `ctx.sessionProjections`：該登錄檔在已提交的工作階段事件上驅動每個已註冊的投影單元，並向載體提供完整的最終值，目前包括 api-proxy 歷史尾頁和 `session/projection` 推送幀。領域註冊的只是純數學；驅動權歸框架。[session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md) 記錄了設計理由。

## 服務：`SessionProjectionRegistry`（ctx 鍵：`sessionProjections`）

### 公開 API

- `ctx.sessionProjections.register(definition): () => void` 註冊一個領域的單元。key 重複或 `stateVersion` 非法都會 throw；註冊是掛在呼叫方 fiber 上的 effect，領域外掛程式解除安裝後其 key（連同快取的 cell）從後續驅動與快照中消失——用戶端將其讀作能力缺失。
- `ctx.sessionProjections.onChanged(listener): () => void` 訂閱變更流：每個已提交事件、每個狀態引用發生變化的單元各回呼一次，攜帶經 schema 校驗的 view 與致因 seq。與 `register` 一樣綁定 effect。
- `ctx.sessionProjections.snapshot(session): ProjectionSnapshot` 對全部已註冊單元做一次一致的同步切面——`{ asOfSeq, values }`，其中 `asOfSeq` = 所有值共同反映到的最後一個事件的 seq（空日誌為 `-1`）。

### 關鍵類型

- `SessionProjectionMap`——整條鏈路唯一的 merge-extensible 類型表（host 側單元、協定塊、React 掛鉤）。值是協定層 JSON 全量值；算繪歸 slot 體系管，永遠不歸本層。
- `ProjectionDefinition<K, S>`——`{ key, schema, init(), apply(state, event), view(state), stateVersion }`：由三個純同步函式外加若干聲明構成的狀態驅動計算單元（state-driven computation unit），絕不是一個不透明的 getter。

## 約定

- **框架負責驅動，領域負責計算。** 登錄檔只訂閱一次 `session/event`；每個已提交事件都會主動經過每個單元的 `apply`。領域不持有任何訂閱。cell（每工作階段每單元一份 `{state, observedSeq}`，以 WeakMap 為鍵）惰性建置——在事件串流過之後才註冊的單元，或讀取一個早於該註冊的工作階段，都在首次觸達時從 `init` 出發在記憶體日誌上摺疊。
- **同引用即無工作。** 對與單元無關的事件，`apply` 必須返回同一個狀態引用；驅動以 `Object.is` 把守變更流，因此不匹配的事件只花一次呼叫，不產生任何下游工作。
- **全量值事件規則（承重）。** 攜帶狀態的日誌事件必須攜帶變更後的完整狀態，絕不攜帶裸增量——這讓每次狀態轉移始終足夠廉價，也讓每個被供給的值自描述（對消費端即 last-wins）。
- **單元的同步紀律。**`init`/`apply`/`view` 必須是同步的；載體在切出頁面切片的同一 tick 內讀取 `snapshot()`，`asOfSeq` 之所以是一個一致切面正繫於此。誤寫成非同步的 `view` 會返回 Promise，讓邊界的 `schema.parse` 當場大聲失敗。
- **狀態是純 JSON，`stateVersion` 是其失效錨點。** 持久投影快取（persisted projection cache）儲存 `(sessionId, key, ver, seq, val)` 行；狀態形狀或摺疊語義一旦變化就遞增 `stateVersion`，使過時行被丟棄，而不是被正向 apply 成垃圾。
- **本層沒有協定詞彙。** 登錄檔只暴露變更流與快照讀取面；載體（api-proxy）據此自鑄各自的幀（`session/projection`）與塊。
- **選填能力。** 領域外掛程式在 `ctx.inject(['sessionProjections'], …)` 下註冊，因此不帶登錄檔的 headless 組裝完全不受影響；載體使用 `ctx.get('sessionProjections')`，登錄檔缺席時完全省略自己的塊與幀。

## 職責

本包承擔能力 seam 的 Service Definition 與驅動角色：領域 host 外掛程式（如 `dsh-tool-todo`）貢獻單元，載體（`dsh-host-apiproxy`）消費快照與變更流，兩側互不相識。

## 模型體驗

無——登錄檔只對已入日誌的工作階段狀態計算面向用戶端的讀模型，不觸碰任何提示詞、訊息、schema、流或工具結果。

#### KV Cache 影響

無；投影從不組裝或傳送提供方請求。

## 已知限制與暫緩事項

- **每個尾頁攜帶每個已註冊的 key**——尚無逐 key 的 opt-out 或惰性 key 請求形狀；在值都是 UI 量級的全量狀態（一張 todo 清單、一份 goal 快照）時可以接受，若某領域的值變大再重議。
- **單元表是行程級的，因此 key 是否存在不能當作逐工作階段的能力訊號**——只要**任何**一個 agent preset 註冊了某個 key，它就出現在每個工作階段的快照裡，包括自身組裝完全不產出該值的工作階段。用戶端必須讀**值**（`plan.active`、空的 todo 清單），不能把 key 缺席當作功能缺席；如果某個單元的空值與真實值無法區分，它就該待在宿主平面——`dsh-token-meter` 正因如此留在那裡。
- **主動驅動（eager drive）逐事件觸達每個單元**——按構造開銷很低（全量值規則、同引用閘門），但若出現熱點路徑，可加按單元的事件類型預過濾，約定不變。
- **登錄檔 cell 只活在記憶體裡**——重新啟動後首次觸達時靠摺疊日誌重建；掛載了 `dsh-session-projection-cache` 的組合改由持久行播種該摺疊。
- **單元同步紀律只有部分可機械把關**——邊界 `schema.parse` 能拒絕返回 Promise 的 `view`，但阻塞的 `apply`、或讀取撕裂的非工作階段狀態的 `apply`，只能靠評審把關；invariant 配套項記載了為何不存在執行時期檢查。
