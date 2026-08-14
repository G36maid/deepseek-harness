# Agent Note: 移除 `image` 內容區塊，直到有路徑能真正處理它

Status: implemented

[English](2026-07-04-drop-image-content-block.md) | [简体中文](2026-07-04-drop-image-content-block.zh.md) | 繁體中文

## 問題

`ImageBlock`（`packages/llm/llm/src/types.ts`）沒有任何生產環境的生產者，而每條路徑上的每個消費端都將其丟棄：DeepSeek 配接器的序列化器跳過 image 塊（這是文件中註明的 MVP 限制）；pi-ai 轉接器因無法表示而跳過；壓縮（compaction）估算器為其按固定常數計入 token 用量，並將其渲染為 `[image]`。ACP（Agent Client Protocol）獨立地拒絕影像提示詞內容。此時構造的 `ImageBlock` 會從提供方協定格式（wire format）中靜默消失——詞彙宣告了一種沒有任何路徑兌現的能力，這正是 AGENTS.md 防禦性模式所警告的靜默資料丟失形態。唯一的構造呼叫出現在測試中，用於覆蓋 skip/drop/estimate 分支。

## 決策

移除 `ImageBlock`、其 map 條目，以及配接器和壓縮中的 image 專用分支。在同一個變更中更新所屬的詞彙文件與生成的參考文件。未知擴充塊仍然覆蓋默認分支，ACP 繼續獨立於 harness 詞彙拒絕入站的影像提示詞內容。

## 曾考慮的替代方案

### 為什麼不保留？

當配接器和壓縮支持 image 時，`ContentBlockMap` 可以重新引入 image 內容區塊。ACP 可以繼續作為純文字的自動化協議。保留一個唯一實作就是拒絕的核心類型，等於宣告一個不可用的對外服務介面；移除後，生產者會立即得到編譯期錯誤。

文件化的回退方案（以備該詞彙項在完整功能就緒之前回歸）：保留 `ImageBlock`，但將所有靜默跳過替換為顯式拒絕，並在詞彙文件中記錄該策略——靜默丟棄是唯一無人主張保留的狀態。

## 驗證

除 Agent Note 之外，沒有任何地方構造 harness `ImageBlock`。ACP 獨立的入站影像拒絕路徑仍有測試；配接器、codec 和壓縮的默認分支則使用外掛程式定義的塊類型覆蓋。

## 後果

日後重新新增核心詞彙類型需要同時改動多個包——但這種協調變更本就是真正的多模態功能所需的形態（配接器對映與壓縮定價），而當前並不存在需要保留的實作。
