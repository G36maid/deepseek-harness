# Agent Note: Client 工具展示所有權

Status: implemented

[English](2026-08-08-client-tool-presentation-ownership.md) | 繁體中文

## 問題

Client 執行時期已經按 `callId` 配對工具呼叫/結果事件，並能從 Code Dispatch 事件復原 root/subcall 拓撲，但 Chat view 曾同時擁有工具在對話流中的放置、遞迴呼叫樹編排、按工具名稱分發、Generic fallback、card model 和第一方工具 renderer。`ui-conversation` 因此必須解釋每個業務工具名稱；只移動單個 React 元件不會改變這層所有權，移走原子 renderer 後 subcall 的展示也會無人負責。

工具展示需要一個獨立所有者，同時不能建立與 Client slot 平行的第二套登錄檔，也不能讓每個原子工具 renderer 自己理解 root/subcall 結構。

## 決策

工具是 Client UI 的一級展示概念，由 `@deepseek-ai/dsh-client-ui-tool` 統一擁有 root/subcall 編排、按 wire 工具名稱的原子 renderer 分發、Generic fallback、card model 和 details output。業務外掛程式只註冊自己的原子工具 renderer，不修改 conversation 或工作階段。

Conversation 資料組裝遵循後續的 [Conversation 業務節點決策](2026-08-09-client-conversation-node-assembly.md)。`ui-conversation` 的工具 Definition 從工作階段事件配對 root call/result，把 Code Dispatch edge fold 成遞迴 `ToolCallBlock.subCalls`，並生成一個穩定的 `tool-call` Chat Node；這裡的資料職責只處理官方工具 identity 和拓撲，不解釋具體工具名稱的展示。

[`ChatView`](../../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx) 只按 Chat 快照的 `order` 放置通用 [`ChatNodeSeat`](../../../../packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx)。Seat 以 `node.kind` 分發 `'conversation.chat.node'`；[`ui-tool`](../../../../packages/client/ui-tool/src/client/apply.ts) 註冊 `tool-call` entry，並由 [`ToolCallTree`](../../../../packages/client/ui-tool/src/client/tool/ToolCallTree.tsx) 遞迴遍歷 root block。每一層 root 或 child 都透過同一個 keyed/session `'tool.call.toolview'` 子 slot 以 `entryKey: toolName` 分發，缺少註冊時渲染 `GenericToolCard`。

業務工具外掛程式接收一個標準 `ToolCallBlock`、identity、workspace cwd 和宿主動作，不讀取工作階段、上下文或 Conversation assembler。skill（技能）仍是普通工具；它和其他業務工具使用同一 keyed slot 註冊路徑。

details panel 是第二個工具展示點，但不是呼叫樹所有者。`ui-conversation` 定位 selected call，並透過 `'conversation.details.tool'` 委託 output body；`ui-tool` 複用 card model，外掛程式缺席時 conversation fallback 保留 raw result text。

## 執行時期與渲染路徑

```text
Session Event window
  -> Tool Definition -> tool-call Chat Node (recursive ToolCallBlock)
  -> ChatView -> ChatNodeSeat(entryKey = tool-call)
  -> ToolCallTree
       -> root/subCalls[] recursion
       -> tool.call.toolview(entryKey = toolName)
            |- registered atomic view
            `- GenericToolCard fallback
```

## 所有權邊界

| 所有者 | 擁有 | 明確不擁有 |
|---|---|---|
| Client 執行時期 Conversation engine | 上下文 identity、Location、歷史重播、view Node 發布 | 工具事件含義、呼叫樹、工具 renderer |
| `ui-conversation` 工具 Definition | call/result 配對、Code Dispatch 拓撲、running/settled/interrupted `ToolCallBlock`、Chat 排序 anchor | 工具名稱分發、card model、遞迴 React 結構 |
| `ui-conversation` Chat view | keyed Node 順序、scroll anchor、selection 與宿主動作 | 工具 lifecycle、subcall 組合、原子工具 renderer |
| `ui-tool` | root/subcall 遞迴渲染、原子 keyed dispatch、fallback、card model 與 details output | 工作階段事件 fold、Chat 排序 |
| 業務工具外掛程式 | 一個或多個 wire 工具名稱的原子 renderer | root/subcall 位置、生命週期配對、工作階段 projector |

## 驗證

`ui-conversation` 測試固定工具 Definition 的 call/result 配對、Code Dispatch、interruption 和 running-to-settled keyed identity，不匯入 `ui-tool` 的生產 renderer。`ui-tool` 測試掛載真實 conversation 宿主，固定 root/subcall 遞迴、keyed dispatch、Generic fallback、selection、details 和具體工具 card。組裝後的 Web 測試覆蓋兩個外掛程式共同裝載的路徑。

## 考慮過的替代方案

**在每個 conversation view 下保留原子工具 slot。** 拒絕：每個 view 都要重複 root/subcall 編排，工具註冊也會按 view 分裂。整個工具 renderer 佔據 view 的一個業務 Node slot，原子分發由工具自己擁有。

**只移動工具 React 元件與 card model。** 拒絕：conversation 仍會按工具名稱分發並遞迴 subcall，文件位置變化不產生所有權邊界。

**為工具建立專屬 projector/fold 登錄檔。** 拒絕：通用 Conversation assembler 已擁有上下文 identity、歷史視窗和發布；第二個執行時期登錄檔會製造生命週期的雙重權威。

**讓每個原子工具 renderer 遞迴自己的 subcall。** 拒絕：原子註冊方只應理解一個工具呼叫，不應知道自己是 root 還是 child。遞迴結構統一由 `ToolCallTree` 處理。

**讓 `ui-conversation` 直接匯入 `ui-tool` 元件。** 拒絕：這會反轉功能相依性並把工具展示變成必選能力。slot 保留獨立裝載、生命週期和 fallback。

## 後果

`ui-conversation` 不再相依性工具名稱對應的業務展示，root 與 subcall 也不會漂移到不同分發路徑。業務包可以獨立擁有原子工具 renderer；`ui-tool` 缺席時，Conversation 資料組裝仍然成立，Chat Node 使用通用 fallback，details 保留 raw result。

代價是 `ui-tool` 明確相依性 conversation 聲明的業務 Node slot 和 locale namespace，並擁有一個工具專屬子 slot。工具 Definition 暫時位於 `ui-conversation`，因為本次沒有拆包；它以後可以沿 Conversation 登錄檔 seam 移動，而不會改變本記錄規定的展示所有權。
