# Agent Note: 將打包區塊行設為默認 JSONL 版面配置

Status: implemented

[English](2026-07-26-packed-chunk-rows-by-default.md) | [简体中文](2026-07-26-packed-chunk-rows-by-default.zh.md) | 繁體中文

## 問題

提供方流會產生大量 token 大小的 `assistant/chunk` 增量事件，其重複 JSON 封裝可能比載荷本身更大。工作階段日誌必須將每個區塊保留為獨立的邏輯事件：即時 `session/event` 傳遞、序號、`sourceEventSeqs`、重播、取消證據和 UI 流式輸出都相依性這些邊界。

JSONL 儲存 seam 可以在不改變邏輯日誌的情況下減少這部分封裝開銷。一段至少包含 3 個連續、同屬一個塊的增量事件可以編碼為一條 `text-chunks`、`reasoning-chunks` 或 `tool-call-chunks` 儲存行，解碼則會重建每個原始事件、時間戳和序號。一個可信的預設值必須同時覆蓋執行時期寫入器、應用級設定、快照生成器和簽入倉庫的 fixture（測試前置資料）；否則測試會繞開部署實際寫入的版面配置。

## 決策

`dsh-session-persistence-jsonl` 會將省略的 `packChunks` 解析為 `true`。ACP（Agent Client Protocol）演示包裝層公開相同的預設值，所有省略該欄位的組合都會繼承打包寫入。`packChunks: false` 仍是寫入側顯式診斷模式，以每個事件一行的形式儲存。

讀取始終不受選項控制且與版面配置無關。打包、非打包和混合文件都會載入為相同且連續的 `SessionEvent[]`，因此更改預設值不需要變更工作階段格式版本，也不需要對磁碟資料執行執行時期遷移。該選項只控制新追加的批次，絕不會選擇讀取器模式。

### 邏輯事件與物理行

打包保留在 `dsh-session` 的儲存 seam，並透過 `packChunkRuns()` 和 `decodeStorageRecord()` 實作。編碼器識別精確的增量事件形態，原樣保留無法識別的事件，並且只打包至少包含 3 個事件的連續段。打包行屬於儲存詞彙，不是 `SessionEventMap` 成員：它絕不會進入 `Session.events`，也不會觸發 `session/event`。

JSONL 後端會打包每個持久追加批次。原始模式 `compression: 'none'` 與默認 Zstandard 幀承載相同的邏輯儲存記錄；為使 fixture 便於評審而選擇原始模式，不會停用打包。倉庫中的重播讀取器和規範化器會解碼共享行格式，而不維護快照專用編解碼器。

### 規範快照 fixture

每個簽入倉庫的工作階段格式 JSONL fixture 都使用規範打包表示。`scripts/session-fixture-layout.snapshot.ts` 會在整個倉庫中發現已跟蹤的 `*.jsonl` 文件，以及未被忽略的新增未跟蹤 JSONL 文件，選擇首條記錄為 `session` header 的文件，解碼所有正文記錄，並拒絕與 `packChunkRuns()` 輸出不同的內容。因此，該清單無需維護路徑清單即可覆蓋 ACP、headless、TUI、`apps/web`、父工作階段、子工作階段以及未來的 fixture 名稱。

ACP 和 headless 快照執行會採集默認 JSONL 後端的輸出。TUI 和 web 的記錄模式寫入器會在寫入 fixture 前，對記憶體事件應用 `packChunkRuns()`。人工編寫的 `packed-chunks` ACP 場景在普通設定下執行，並保留全部 3 種打包行類型；其約定先解碼獨立的源 fixture 和目標 fixture，再斷言二者逐事件相等。

聚焦的包測試保留非打包和混合版面配置輸入，以驗證讀取器相容性。這些測試不會讓默認快照語料庫豁免規範版面配置要求。

### 運送中分支收斂

臨時命令 [`scripts/migrate-packed-session-fixtures.ts`](../../../../scripts/migrate-packed-session-fixtures.ts) 讓運送中分支合併當前 `master` 後可以完成收斂：`pnpm run migrate:packed-session-fixtures` 會發現與永久閘門相同的倉庫級 fixture 集合，保留各文件的 header 行，解碼現有混合記錄，寫入規範打包正文，並證明解碼結果相等且操作具有冪等性。該命令絕不會呼叫模型，也不會重新生成 transcript（文字記錄）與呈現輸出。

只要較舊分支仍可能攜帶 fixture 改動，測試政策和 ACP 快照 README 就會繼續連結該命令。最新的開放 PR（Pull Request）清單確認每個受影響分支均已合併、關閉或符合規範後，[移除提案](../../proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md)會刪除該 CLI、包命令、本過渡章節和文件連結，並替換永久閘門中僅適用於該命令的修復指引。共享規範版面配置轉接器與快照閘門保持永久存在。

### 驗證約定

JSONL 持久化測試證明：省略選項時會寫入打包行，顯式傳入 `false` 時會按每個事件一行的形式寫入，兩種形式都會載入為完全相同的事件。規範版面配置轉接器單元測試覆蓋 header 保留、非打包轉換、非工作階段 JSONL、已打包輸入的冪等性和畸形輸入。無金鑰快照閘門覆蓋每個簽入倉庫的 fixture 和組裝後的重播路徑；文件閘門則確保設定預設值與雙語約定保持一致。

## 曾考慮的替代方案

**僅翻轉後端 schema 預設值。** 這會讓包裝層預設值、TUI/web 直接序列化器、現有 fixture 與未來 fixture 政策仍然彼此不一致。只有已交付組合及代表這些組合的測試採用相同預設值時，該預設值纔有意義。

**快照繼續使用非打包格式以便閱讀。** 打包行仍會顯式保留每個片段和時間戳，共享解碼器與規範化器則提供邏輯檢查。如果讓規模最大的簽入倉庫消費端採用不同版面配置，快照覆蓋就會繞開已交付的寫入路徑。

**刪除 `packChunks` 並始終打包。** 只保留一個寫入器更簡單，但每個事件一行的輸出仍適用於診斷和聚焦的混合版面配置相容性測試。顯式停用選項在不削弱預設值的同時，保留了這些現有消費端。

**把區塊批次合併為邏輯工作階段事件。** 這會減少事件數量，但也會延遲或重塑即時傳遞，重新編號助手訊息引用的區塊 seq，並要求每個 UI 和重播消費端理解另一種流式單位。物理打包在現有持久化介面背後實作，從而獲得儲存收益。

**永久保留分支遷移器。** 只讀的規範版面配置轉接器與快照閘門負責持續強制執行。只有運送中分支仍攜帶舊 fixture 版面配置時，會修改倉庫內容的命令纔有價值，因此移除提案明確限定了其生命週期。

## 後果

常規 JSONL 寫入與簽入倉庫的 fixture 使用更少的物理行，同時精確保留邏輯事件串流。執行時期讀取器接受所有現有版面配置，操作方也保留顯式的非打包診斷模式。按 token 逐行處理原始文件較為不便；錯誤地將 header 後每一行都視為 `SessionEvent` 的外部工具會更頻繁地遇到儲存標籤，受支持的讀取器則會呼叫 `decodeStorageRecord()`。

倉庫會產生大規模機械 fixture diff；評審應依據解碼結果相等這一事實和規範版面配置閘門，而不是逐行、逐 token 檢查。倉庫還會暫時保留一個分支遷移命令及其連結；單獨的移除提案會防止這項過渡輔助機製成為永久的流程介面。
