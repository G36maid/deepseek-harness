# Agent Note: 訊息 fork 操作要求訊息位於已完成輪次尾部

Status: implemented

[English](2026-08-02-message-fork-actions-require-completed-turn-tail.md) | [简体中文](2026-08-02-message-fork-actions-require-completed-turn-tail.zh.md) | 繁體中文

## 問題

Web 工作階段把分支操作掛到每個輪次中最後一個文字非空的 assistant 節點上。如果後面還有工具結果、被中斷的推理（reasoning）節點或終態錯誤，這些行也不會接管操作，因為它們沒有內容文字 IconActions。因此，分支圖示可能出現在 assistant 回應下方，而同一輪次的更多行仍位於其後。Host 會正確地把該訊息錨點擴充到其所在的 `turn/end`，但圖示位置使操作看起來像在訊息級截斷，子工作階段又會明顯繼承同輪次的後綴。

## 決策

`ConversationSnapshot.turnEnds` 保留原始事件視窗中的已完成輪次邊界。工作階段檢視表按各邊界遍歷 transcript（文字記錄）節點，僅當邊界的最後一個節點是使用者訊息、持久 steering（中途引導）訊息或含內容的 assistant 訊息時才啟用分支操作。開放輪次沒有符合條件的訊息；如果後面還有工具結果、只有推理內容的中斷、輪次錯誤或其他 transcript 節點，較早訊息上的分支操作會保持不可用。不可用的控制元件仍然可見、可聚焦、可懸停；`aria-disabled`、tooltip 與 `aria-describedby` 會說明已完成尾部這一要求，且不會發送 Host 請求。複製和時鐘仍可在既有訊息 chrome 下使用，Host 按已完成輪次 fork 的語義保持不變。

本資格判定中訊息氣泡的那一半已被 [user 氣泡分支移除決策](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)取代：user 與 steering 氣泡不再渲染該控制元件，因此只有含內容的 assistant 尾部可以 fork；assistant 側閘門及其可見但不可用的呈現保持有效。

本決策收緊了較早的 [Web 工作階段 fork 操作決策](../feature/2026-07-27-web-session-fork-actions.md)所定義的訊息資格。Session 行 fork 仍選擇最新的已完成輪次；符合條件的訊息操作仍透過共享 client 執行時期操作傳遞其事件 seq。

## 考慮過的替代方案

**在點擊的 assistant 訊息處截斷事件日誌。** 不予採納：assistant 訊息可能位於尚未結束的步驟內，也可能包含結果隨後纔出現的工具呼叫。以該 seq 擷取的原始前綴並不是結構完整的輪次，也可能不是有效的提供方 transcript。

**從 `running` 或下一條使用者訊息推斷完成狀態。** 不予採納：重試輪次與 steering 輪次不一定和下一個可見使用者氣泡對齊，分頁視窗也可能省略該氣泡。持久 `turn/end` 事件纔是權威的完成事實。

**對每個被中斷輪次隱藏分支。** 不予採納：已中止的輪次會持久關閉，其最終的中斷文字可能正是真正的 transcript 尾部。資格取決於已完成邊界與節點順序，而非結果類別。

**隱藏不符合條件的訊息控制元件。** 不予採納：消失的控制元件無法說明邊界要求，還會讓本應穩定的訊息 chrome 發生位移。保留可聚焦但不可用的控制元件，既能維持操作提示，也能阻止請求。

## 後果

啟用的分支圖示現在表示的已完成輪次邊界與 Host 實際複製的邊界一致。在所報告的「回應 → 工具 → 被中斷的 Think」形態中，回應仍保留複製、時鐘，以及一個說明無法操作原因的停用分支控制元件。本變更刻意不提供同輪次 transcript 編輯，也不提供輪次前重試操作；當讀者希望完整複製最新的已完成輪次時，仍可使用 Session 行操作。執行時期測試固定邊界投影和引用穩定性，工作階段測試則覆蓋 assistant 尾部、純使用者訊息尾部、持久 steering 尾部，以及後續工具行和被中斷推理行導致的不可用控制元件。
