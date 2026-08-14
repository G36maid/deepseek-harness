# @deepseek-ai/dsh-client-ui-goal

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Goal 介面外掛程式（瀏覽器端部分）：`GoalBar` 條帶是 `conversation.input.dock` composer 上下文堆疊中的第二張獨立卡片（order 10，位於 Todo 之後、Queue 之前）。活值經 `useProjection('goal')` 到達——host 計算的全量值由歷史尾頁播種、由 `session/projection` 幀更新——因此本外掛程式不持有領域 store、不設刷新鏈、不掛事件監聽。slot 注入面只攜帶四個變更動詞（edit / pause / resume / clear，經 `ctx.remote.goals` 呼叫——active 的 goal 提供暫停動作，paused 的提供復原）；每個動詞在呼叫時從工作階段當前投影值讀取 CAS ref，並將 Remote 呼叫的拒絕錯誤內聯呈現。由於 React 的 pending 渲染無法攔住同一幀內的點擊，橫條會同步為變更建立 single-flight 防護；清除成功後，會立即抑制該 goal id 對應的目標顯示，直到權威的 null 投影追上。goal 的建立仍歸 `/goal` host 命令；載入中、無 goal、已完成和已成功清除的 goal 一律不渲染。

該外掛程式還會透過自有 Conversation Definition 投影每條持久 `/goal` `command/run`。它在通用命令結果 Node 之前建置一個 `command-input` Chat Node，並為該 Node 註冊 keyed renderer；renderer 將其呈現為靠右對齊、使用 14px/22px 等寬字體的使用者樣式氣泡，使用本機化分組名稱 `Command input`／`命令输入`，且不含時間戳、複製或分支操作。可見的非命令 Node 會啟用新 Chat；重新載入時會根據 run 重建該 Node，而僅包含 `command/done` 的歷史視窗只保留通用結果行。該投影絕不會建立 `user/message` 或模型輪次。

`/client` 的匯出介面包括外掛程式本體（`apply`/`inject`）、`GoalBar`/`GoalDock` 元件與注入動詞面類型。

## 模型體驗

間接影響：條帶透過呼叫 `goals/edit`、`goals/pause`、`goals/resume` 和 `goals/clear` Remote 方法提交變更；每次被接受的變更都會在持久 `agent/inbox/spliced` 插入項中提交，goal 投影會立即摺疊該插入項，同時將一條 `goal/change` 上下文訊息排隊。只有後續 pre-step 准入該上下文時，模型才會看到它；丟棄已排隊的訊息不會回滾投影狀態。條帶自身不新增任何提示詞內容。

#### KV Cache 影響

除非已排隊的 goal 上下文獲準，否則沒有影響。獲準的上下文會像其他訊息一樣擴充歷史尾部；准入前被丟棄的插入項不會影響快取。

## 已知限制與暫緩事項

- **只反映持久 phase**——投影省略行程本機 activation，因此條帶無法區分 active-but-disarmed 與 armed 狀態；resume 透過 RPC 重新置為 armed 狀態。不存在 host 即時 activation 通道。
