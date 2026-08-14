# Agent Note: 將上下文注入與輪次執行分離

Status: implemented

[English](2026-07-24-separate-context-injection-from-turn-execution.md) | [简体中文](2026-07-24-separate-context-injection-from-turn-execution.zh.md) | 繁體中文

## 問題

agent（代理） API 曾用三種相互重疊的方式表示面向模型的補充輸入：呼叫方透過 `SendOptions.contexts` 附加 `HookContext[]`，攔截掛鉤和工具掛鉤返回 `additionalContexts`，外掛程式則呼叫 `agent.inject()`。這些路徑最終都把上下文寫入同一份模型歷史，但各自攜帶不同的放置、元資料、准入、佇列和輪次生命週期規則。

將上下文原子附加到收件箱訊息後，agent loop（代理循環）曾被迫讓上下文跟隨提示詞准入、steering（中途引導）轉換、取消和終止丟棄的完整生命週期。`prompt-prefix` 放置方式又曾把上下文與直接提示詞合併為一個事件，因此 transcript（文字記錄）消費端不得不相依性模型不可見的封套，才能還原使用者實際輸入。這樣一來，outbox 條目、工作階段投影和 UI 重播都曾負責處理本應由生產方負責的區分。

空閒狀態下的 `inject()` 還暴露了另一處語義錯位。注入當時並不請求模型執行，但實作僅為了滿足輪次封閉不變數並獲得持久性檢查點，就會打開並關閉一個零步驟的 `injection` 輪次。於是，當時的輪次有時表示「執行 agent loop」，有時卻表示「不執行 agent，僅持久化上下文」。

`HookContext` 的名字也描述了生產方，而非該值的職責。它可能來自原生外掛程式、掛鉤橋接、提示詞准入或工具後處理；其穩定含義是面向模型的額外上下文，並且 source 會指明生產方。

## 決策

`inject()` 是呼叫方交付補充模型輸入的唯一操作，而輪次表示一次模型迴圈執行。

擁有上下文的呼叫方透過 `inject()` 交付帶標識且凍結的 `UserMessage`，再獨立使用 `followup()` 或 `steer()` 提交直接訊息。

pre-step 的 enter 分支會為正在最終確定的請求返回完整的 `PreStepDecision.messages` 批次。工具擴充點仍可返回 `additionalContexts`，這些上下文只會在對應工具結果之後進入 next-step inbox。這些值是擴充點的輸出，而不是從呼叫方 inbox 條目捕獲的附件。

每項額外上下文都是獨立的 `UserMessage`，其 `source` 會指明生產方，並攜帶生產方專用欄位。inbox 插入會立即持久化；後續准入會將同一個值記錄為 `user/message`。不再有 `context/message`、prompt-prefix 放置方式、穩定請求分隔符或提示詞封套。transcript 與 UI 消費端透過 `source` 區分直接使用者訊息和注入上下文。

## 注入生命週期

`inject()` 始終把上下文插入不會喚醒的 `next-step` inbox，並以 `agent/inbox/spliced` 提交該佇列變更。執行中的驅動程式器會在最近的後續 pre-step 邊界領取它。idle 驅動程式器會讓它保持待處理，直至 `followup()` 或 `steer()` 提供可喚醒工作；在此之前，取消或 dispose（資源釋放）可能將其丟棄，但不會抹除持久佇列歷史。

迴圈會先領取當前 next-step 批次，再執行 `agent/pre-step`，因此領取後到達的注入可能趕不上正在最終確定的請求，而由下一次邊界領取。enter decision 返回的訊息會在所屬輪次內、消費它們的請求之前追加。在助手工具呼叫批次期間產生的上下文因此只會出現在該批次全部有序結果之後。

如果 pre-step reject 或拋錯，其已領取的注入上下文、steering 與排隊提示詞都會保持已刪除，也不會追加返回批次。原子領取後插入的訊息不受影響，繼續保持待處理。

agent loop 只會在輪次內從進入步驟的批次追加註入的 `user/message`。核心執行事件、steering、助手輸出和工具事件仍受輪次邊界約束；可合併擴充事件的關係由聲明它們的外掛程式擁有，而不是採用核心默認規則。

## 擴充點與呼叫方語義

enter 分支的 `PreStepDecision.messages` 是擬議步驟的完整批次。waterfall（瀑布式事件）監聽器呼叫 `next()` 委託時，會保留下游訊息，除非有意替換；新增訊息遵循 waterfall 的自然返回順序。工具結果的 `additionalContexts` 保留 FIFO 順序及每則訊息的 source。

呼叫方主動注入與當前步驟上下文刻意採用不同的時序。`inject()` 會加入下一個可用 pre-step，無法保證正在最終確定的請求會消費它。必須影響該請求的監聽器在 `PreStepDecision.messages` 中返回上下文；下游 reject 或失敗時，該上下文不會落入日誌。

跨工作階段引用採用這種領域組合方式：TUI 先準備快照，然後在 idle 直接訊息的 pre-step 中把快照與該訊息一同返回，或在 running 輪次中先注入快照再喚醒 steering。目標日誌包含兩條簡單訊息，因此來源工作階段後續變化不會改變回放，transcript 消費端也不需要提示詞封套。本決策取代[跨工作階段引用決策](../feature/2026-07-21-cross-session-references.md)中的附件機制，但保留其快照與信任邊界規則。

本決策保留[移除注入內容封套](../simplification/2026-07-20-unwrap-injected-content-envelopes.md)確立的由呼叫方決定內容框架的原則，以及[一次 send、一個輪次](../simplification/2026-07-17-one-send-one-turn.md)確立的單條目輪次規則。後續的[獨立純日誌事件決策](../simplification/2026-07-28-remove-synthetic-log-only-turns.md)將同樣的「輪次僅表示執行」語義應用於外掛程式所屬記錄。

## 曾考慮的替代方案

**保留 `SendOptions.contexts` 作為原子附件。** 提示詞准入阻止訊息時，這種方式能保留全有或全無交付，但也會讓上下文繼續成為收件箱生命週期狀態的一部分，並迫使每次佇列轉換和觀察事件攜帶它。大多數呼叫方都可以透過先注入上下文、再交付訊息來表達需求，通用 agent API 不應內建領域交易。

**保留獨立的 `context/message` 工作階段事件。** 面向模型的 user-role 輸入會再次擁有兩個投影完全相同的事件類型。`user/message.source` 已能為策略、transcript 和重播消費端提供所需區分。

**為空閒注入保留一次性輪次。** 持久 inbox 插入已經能在不打開輪次的情況下記錄空閒上下文。合成輪次會讓輪次計數與觀察方報告從未執行模型的工作；不會喚醒的上下文會保持待處理，直至真實的可喚醒工作提供請求。

**保留 `prompt-prefix` 選填放置方式。** 前綴烘焙可以讓上下文和請求位於同一條提供方訊息中，但它會引入直接提示詞的第二種表示，並把放置處理擴散到准入、steering、日誌、重播和 UI 程式碼。需要文字方塊架的生產方可以直接把它寫入自身上下文內容。

**讓提示詞掛鉤呼叫 `inject()`，而不是返回訊息。** 注入可能趕不上提示詞正在最終確定的請求，也會逃逸下游對該 decision 的阻止。返回完整訊息批次能讓當前請求上下文繼續受 waterfall 約束。

## 驗證

- 投遞輸入與 steering inbox 記錄不包含附加上下文；`agent/inbox/inserted` 只報告插入訊息，目標清單由持久 splice 保留。
- `UserMessage` 是提示詞攔截、工具執行、掛鉤橋接、guard 和上下文生產方共享的帶標識且凍結的形狀。
- 公共類型、持久事件、投影和 UI 重播中均不存在 prompt-prefix 放置方式、提示詞封套與 `context/message`。
- idle 狀態下的 `inject()` 會立即追加一條持久 inbox 插入記錄，但不會追加模型可見的 `user/message`；後續可喚醒投遞可能開始 pre-step 處理。
- 活躍輪次中的注入會在最近的後續 pre-step 邊界領取，並位於完整工具結果批次之後、消費它的請求之前。
- pre-step reject 或失敗會丟棄其已領取批次；領取後插入的輸入繼續保持待處理。
- 單元測試、持久化與 resume 測試、不變數測試和 TUI 覆蓋會固定事件順序、領取歸屬和持久重播。

## 後果

- idle 注入只有在後續 pre-step 接納它後才會對模型可見，並可能被取消或 dispose 丟棄，而其持久 inbox 生命週期仍會保留記錄。
- 兩條連續的 user-role 訊息會取代一條烘焙後的提示詞訊息；提供方配接器會保留這一順序。
- 必須影響當前請求的上下文要從 `agent/pre-step` 返回；普通注入只支持在最近的後續邊界交付。
- 公共投遞約定和收件箱記錄保持精簡：沒有上下文附件、上下文放置元資料、提示詞封套或重複的持久事件類型。
