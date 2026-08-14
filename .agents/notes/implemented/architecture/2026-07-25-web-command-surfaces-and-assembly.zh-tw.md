# Agent Note: Web 命令業務面與裝配（ui-commands / ui-skill / ui-subagent）

Status: implemented

[English](2026-07-25-web-command-surfaces-and-assembly.md) | 繁體中文

> 範圍：命令目錄快取與三型派發（ui-commands）、popup 選擇流、skill（技能） / subagent 兩個引用源、fixture（測試前置資料）命令路由與裝配驗收（slash-flow 快照）。承載 wire 見[工作階段作用域 note](2026-07-25-web-client-session-scope-and-provide-channel.md)；觸發、選單和輸入機器見[輸入狀態機 note](2026-07-25-web-input-machine-and-slash-pipeline.md)。

## 問題

管線就緒但沒有命令知識的落點：host 側 `ctx.commands` 與 `ctx.skills` 完整而 web 通道無命令能力。業務層要回答：

- 命令 UI 不止一種形態（當場執行、彈選擇框、回填後繼續打參數）——業務包如何零骨架改動上架；
- 目錄何時拉取：每次開選單現拉太慢，常駐快取就要有失效與重連故事；
- 工作階段始終由 agent（代理）支撐（Session+Agent 同瞬出生），client 命令面透過什麼地址訪問 host 的逐 agent 有效目錄；
- 裝配級驗收：拆開的各層合起來，使用者可見主鏈如何釘住。

## 決策

### ui-commands：`CommandUiRuntime` + 按工作階段鍵控的 `CommandDirectory` + 逐工作階段 `PopupSelectController`

- 投影 `ClientSessionContext { sessionId }` 自持於 ui-input-trigger 約定（types.ts）：工作階段恆 agent-backed，工作階段身份即命令能力的全部投影；wire 以 `{sessionId}` 尋址（`command.list` / `command.execute` 均是；host 從工作階段 header 解析 Agent）。
- 目錄按 `SessionId` 分區，per-key single-flight + epoch guard（舊拉取永不覆蓋新態），`commands/changed` 全 key 軟失效（舊快照繼續服務、後臺重拉）、`connection/reset` 全 key 硬失效並預熱，Enter 必須等待當前 key 就緒、失敗留草稿不降級。預熱掛 source 的 `warm` 掛鉤——scope 出生時對全 roster 一次，即覆蓋整個工作階段生命週期（工作階段能力自出生恆定）。
- `register(contribution)` 註冊 client 命令（descriptor + `available(projection)` + popupSelect spec）；候選合成 = host 目錄 + contribution 可用性過濾，再過 query/position，host/contribution 重名 fail loud。
- 命令三型按註冊面派生，開發者不聲明位置：host descriptor 帶 `input` = **leadingInput**（回填 `/name ␣` + claim，繼續打參數，僅限行首）；client 註冊 popupSelect spec = **popupSelect**（官方選擇框殼，業務零元件）；兩者皆無 = **execute**（選中即執行，零 UI）。
- 派發決策表：選單可觸發三型；Space 只認 leadingInput（誤觸發防線：不可逆副作用只留顯式入口）；Enter 裸 token 才 execute/開殼、leadingInput 容忍尾隨參數。
- `popupFor(actx)` 的 popup：search 本機過濾、select single-flight、open 時捕獲投影、onSelect 成功才經 consume-token 事件消 token、失敗保留可重試、工作階段切換只隱藏。popup 殼是瞬態層（不進狀態機）：框持焦點、Enter/↑↓/Escape 歸它、點框外即 dismiss（點 textarea 同時歸還焦點）。

### 引用源（只見投影 + 自家 apply 閉包的 root ctx）

- **ui-skill**：`skill.list({sessionId})` 按工作階段尋址（host 從工作階段 header 解析項目根）；目錄快取按 sessionId 鍵控 single-flight，`warm` 掛鉤出生預熱、`connection/reset` 全清。pick 產出 text outcome（`/name ` 原文，純文字引用決策）；`lexicon` 從 CatalogFetch 的 settled 快照給名錄（未熱 `undefined`），`subscribeLexicon` 在 settle 與失效時按工作階段通知監聽者。無 match 掛鉤（引用不進命令裁決）。skill 引用以原文隨普通提示詞走（命令平面之外；tool-skill 不變，工作階段前綴目錄提供協作關聯）。
- **ui-subagent**：候選零 RPC（sessions.list 快照按 parentId/running 過濾）；pick 產出 text outcome（`@name ` 原文）；`lexicon` 同快照派生，`subscribeLexicon` 轉發 list store 的變更通道（模型側表示待業務立項）。

### fixture 命令路由與裝配

- connection fixture 補命令路由（fixture + fake-api）：keyless 臺架可跑完整命令流（目錄、執行、popup 選擇）。
- apps/cli 裝配掛全部新包；tsconfig path map / reference 集補齊；catalog/docs 隨 wire 與事件再生成。

### 裝配級驗收：slash-flow 快照

`apps/web/tests/slash-flow.snapshot.ts` 釘住使用者可見主鏈（assembled keyless，包 mock 不替代裝配後的 transcript（文字記錄））：無工作階段時 composer 停用 → 建立 Workspace 並進入已實體化的 blank 工作階段 → `/` 選單選 `/echo` leadingInput → 命令執行但 blank 位不翻轉、清單仍顯示 `New Session` → 首條普通提示詞成功受理後同一行轉正；同一個工作階段綁定的 textarea 在 blank → active 轉換期間保持不變。`workspace-flow.snapshot.ts` 另釘住 blank 行建立/複用、首條提示詞遭拒後的回填，以及在寄出首條提示詞前切換 Workspace 時 draft 跨 input machine 搬運且舊 blank 行隱藏。

## 曾考慮的替代方案

| 棄案 | 一行理由 |
|---|---|
| 提示詞內聯派發（命令文字隨訊息進 host 解析） | 混淆命令/訊息平面；命令執行獨立於訊息佇列是既有 host 語義 |
| skill 物化為 command 的橋 | skill 自有目錄；N 筆註冊是繞路；標籤形式天然避開命令平面 |
| `skill.invoke` RPC | host 無此操作；skill 引用是隨提示詞的普通文字 |
| 新 ContentBlock 引用類型 | 全鏈路成本（配接器/UI/壓縮（compaction））；文字即真身 + 結構化 occurrence 記錄已足夠 |
| client 各包自報命令目錄 | host 是唯一真源；client 只讀 descriptor，`commands-changed` 推失效 |
| `requires: 'none' \| 'agent'` 判別軸（agentless 目錄 + 雙址查詢） | 工作階段恆 agent-backed 後兩棲命令無 owner；整軸棄置，待真需求重開 |
| 專用 commandresult / commandpanel slot | 結果走 notice；popup 殼是骨架內浮層；富結果卡入臺帳 |
| agent-type 目錄做 `@` 源 | 無類型登錄檔；即時工作階段快照已覆蓋 |
| PickAction/EnterCommand 類族（類繼承 pick 產物） | 跨包執行時期值破壞 client bundle 純度；純資料介面 + 閉包方法等價 |

## 後果

- 業務命令上架 = host 註冊 + client 一筆 `command.register`（popupSelect）或零註冊（execute/leadingInput 自動派生），零骨架改動；代價是三型語義集中在 ui-commands，假想的第四型意味著改它。
- 常駐目錄快取 + 推失效換來選單零延遲與回車裁決可靠；代價是三條失效路徑（change 幀、重連、epoch guard）都需測試釘住。
- sessionId 尋址讓 host 的 per-agent 有效目錄（全域性 + scoped shadows）直接上 wire，client 原樣呈現。
- 已知欠帳：popupSelect 殼暫無已上架業務消費端（模型選擇等將隨 host `selectModel` 工作以 live-mutation 形態到來，屆時作接入樣板）；佇列第二刀（逐項 Inbox 操作）、富結果卡、roster 可設定性入臺帳待觸發。
