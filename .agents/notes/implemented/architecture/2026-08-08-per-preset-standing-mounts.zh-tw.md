# Agent Note: 基於作用域父鏈的逐預設常駐掛載

Status: implemented

[English](2026-08-08-per-preset-standing-mounts.md) | [简体中文](2026-08-08-per-preset-standing-mounts.zh.md) | 繁體中文

## 問題

按工作階段掛載 preset 讓面向模型的註冊檢視表變成按 agent 的，而三個獨立的宿主讀取方仍然假設它是靜態的：冷讀 `session.history` 找不到 presenter（每張卡都靜默退化成通用渲染器——與「工具本無 presenter」無法區分）、投影塊丟掉 preset 註冊的鍵（用戶端把缺失鍵當作能力不存在並**清掉**該行）、Typert 閘道在宿主根上解析 `goals`（`service-unavailable`）。逐個讀取方打修補程式只是拿一種靜默降級換另一種：為拿到 presenter 而 resume，會把投影摺疊從 detached 翻到 live，token 計數隨之被抹掉。

## 決策

一個 preset 是**每行程**一份組裝，而不是每工作階段一份。roster 在一個合成常駐 scope 下掛載它一次；每個 agent 透過把自己的 scope key 綁定到掛載的 key（`bindScopeParent(agentKey, standingKey)`）加入。兩條 `dsh-scope` 機制承載了一切：註冊檢視表沿父鏈解析（`agent → preset → global`，近者遮蔽遠者），帶作用域的分發對標籤為載體鍵祖先的監聽器放行——只向上，兄弟 preset 的監聽器保持失聰。

## 後果

常駐掛載修的是這一類問題而非其中的個例：讀取方需要的註冊在行程生命週期內始終存在，按 preset id 索引，不需要任何 agent。讓它便宜的原因：

- 有狀態的 preset 外掛程式（`plan-mode`、`token-meter`、`compaction-basic`）本就按 `Session`/`Agent` 分鍵存狀態——它們早於 preset 存在。共享一份實例是回歸其設計，不是改寫。`jobs-local` 同樣具備該性質，且此後已完全離開 preset 平面：realm 之外的生產方（`tool-bash`、`tool-terminal`、非 continuable 的 `tool-subagent`）以 `ctx.get` 解析該登錄檔，而 entry-local realm 對它們不可見，因此它組合在宿主平面，只有面向模型的 `tool-jobs` 行仍留在各 preset 中。
- preset 的 yml 不變：每 preset 掛一次 = 每 preset 一個 Entry，其 entry 本機 realm（`isolate: <name>: true`）讓兩個 preset 的同名服務互不相干，正如它從前隔開兩個工作階段。
- 共享 realm label **不是**選項：`provide()` 對同一 realm 符號下的第二次註冊直接拋錯，label 池化的是 REALM 而非實例——按工作階段掛載的世界裡共享 label 會讓第二次掛載崩潰。

## 承重細節

- **常駐掛載掛在服務未追蹤的 `selfCtx` 上。** 經 traceable 代理呼叫的方法看到的 `this.ctx` 被重綁到呼叫方並攜帶 shadow；從它派生的子樹裡每個 fiber 的 reflect 解析都從 shadow 的 fiber 起步，entry 會在自己 `inject` 聲明的服務上失敗（`cannot get property "tools" without inject`，而它的 store 裡明明有）。`jobs-local` 的 selfCtx 先例，如今有了第二個消費者。
- **掛載一旦成功即持續供職，直到組裝文件的 stamp 變化。** 執行中工作階段加入的組裝必須在其文件被修改或刪除後繼續存活；每個代際記錄文件 stamp（mtime + 大小），工作階段發現當前代際已過時時，會開啟下一個代際，因此文件編輯——創作改為僅複製之後唯一的組裝編輯器——無需任何創作呼叫丟棄指針即可達到後續工作階段。已加入的工作階段保持其代際，被替代的代際只由整樹解除安裝回收——刻意為之，上限取決於編輯頻率，已記入包的 Known Limitations。
- **`peek()` 保持不看鏈。** 限制與守衛定位的是單個作用域**自己**的貢獻；只有註冊**檢視表**沿鏈繼承。鏈上的限制求交（鏈上任一作用域都可為巢狀其內的一切遮蔽某個全域性註冊名稱）。
- **重新認父只能經由掛載首綁返回的 `ScopeParentBinding`**——roster 私藏該控制代碼，空白工作階段 recompose 因此是唯一的重鏈路徑，其他呼叫方無法挪動已組合的 agent；其合法性仍以舊父之下產出一概不被保留為前提，由持有方保證，因為該關係看不見工作階段日誌。

## 考慮過的替代方案

冷讀時 resume（抹掉 detached 投影）、宿主面 presenter 表加投影塊完整性標志（修兩個讀取方、留下這一類）、每工作階段範本掛載（為了服務純函式而複製每一份實例）。留檔：面向閘道的 `goals` 域無論如何留在宿主平面——Remote 方法的接收者來自生成的 descriptor、在宿主上解析，這正是 `shell-env` 宿主平面判據從消費側讀出的樣子。
