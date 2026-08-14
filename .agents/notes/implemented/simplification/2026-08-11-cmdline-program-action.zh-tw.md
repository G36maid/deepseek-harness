# Agent Note: parseCmdline 執行 program 自己的 commander action

Status: implemented

[English](2026-08-11-cmdline-program-action.md) | [简体中文](2026-08-11-cmdline-program-action.zh.md) | 繁體中文

## Problem

`dsh-cmdline`（[應用自有命令列](../architecture/2026-08-06-app-owned-command-line.md)）的 `parseCmdline` 曾帶著一個自造的回呼：`CmdlinePlan<T> = (program, ctx) => T`，在解析成功後於該配接器的 catch 之內呼叫，使 plan 的 `program.error(...)` 與 help/解析錯誤共用同一條退出路徑；它還帶有隻被測試使用、類型不健全的預設值 `(() => ({}) as T)`，以及沒有任何 plan 讀取的 `ctx` 參數。這整條接縫複製了 commander 本就定義的席位：命令的 action 處理器在 `parse` 內部執行，從中拋出的 `program.error(...)` 與文法拒絕一樣遵循 `exitOverride`。

## Decision

`parseCmdline(ctx, program): void` 只把 commander 的控制流適配到啟動器：它解析不可變的 `cmdlineArgs` 快照，並把 help、version、解析錯誤與 action 的拒絕轉換為一次 `ctx.appExit` 請求。應用程式碼——commander 文法表達不了的校驗，以及應用自有服務的 `ctx.provide`——放在 program 自己的同步 `.action()` 裡，commander 在解析成功時執行它，在 help 或拒絕時絕不執行。`CmdlinePlan` 匯出、其 `ctx` 參數、默認 plan 與 `T | undefined` 回傳值全部刪除；兩個組合包提供方都在各自的 action 中發布。由於 `Command` 類型無法表達 action 前置條件，`parseCmdline` 按結構讀取處理器（如同 `isCommanderError` 按結構識別 commander 的控制流錯誤），在載入時拒絕整棵命令樹中沒有任何命令聲明 action 的 program 並點名它——若無此守衛，漏寫 action 的提供方（或仍在傳已刪除第三參數的過時呼叫方）會解析成功、什麼也不發布，只在 settlement 時以相依性行 pending 等待缺席服務的形式浮現。該配接器在整棵命令樹而非僅根命令上設定 `exitOverride` 與輸出：commander 只在註冊時把這些設定複製進子命令，只設定根命令會讓已註冊子命令的拒絕繞過 `ctx.appExit` 直接呼叫 `process.exit`。action 必須先拒絕後發布；寫在 `program.error(...)` 之前的語句已經執行。

交付前已在 commander 15 上驗證：action 在 `parse` 內部執行，其 `program.error(...)` 經 `exitOverride` 拋出 `CommanderError`；help 與 version 在 action 之前短路；有無 action 時的多餘參數處理完全一致。

## Alternatives considered

- **保留自造的 `resolve`/plan 回呼**：它存在的唯一理由是讓應用側的拒絕共用配接器的 catch，而 commander 的 action 席位本就提供這一點；為解析生命週期的同一時刻再造第二條回呼接縫屬於重複。
- **返回解析後的 `Command` 交呼叫方讀取**：呼叫方在解析之後呼叫 `program.error(...)` 會以未捕獲的 `CommanderError` 逃出配接器的 catch，把一次用法拒絕變成外掛程式載入失敗；每個帶校驗的應用都得重建配接器持有的那套 try/catch。
- **把全部校驗移進 commander 的 option/argument 解析器**：`InvalidArgumentError` 覆蓋逐值檢查，但 headless 組合包用自己的用法資訊拒絕拼接後的可變參數（"任務不得為空白"），逐參數解析器表達不了。
- **接受沒有 action 的 program，相依性 settlement 診斷**：組裝好的啟動器確實會大聲失敗（`pending (waiting for service: …)`），但那個錯誤點名的是消費者而非設定錯誤的提供方，且沒有 settlement 斷言的嵌入宿主會靜默掛起；載入時守衛直接報出肇事的 program。
- **用裸的凍結 `readonly string[]` 服務替換 `CmdlineArgs` 訪問器**：維護者保留該訪問器對象作為服務的具名介面。

## Consequences

- `parseCmdline` 失去泛型、回呼參數與 `undefined` 哨兵值；呼叫方不再需要 `if (values !== undefined)` 的發布守衛。
- 應用的命令是自包含的——flag、help 文字、校驗與發布效果一起掛在 `Command` 上。
- action 必須是同步的：配接器呼叫的是 `parse` 而非 `parseAsync`，返回的 promise 會在無人觀察的情況下逃出 catch。
