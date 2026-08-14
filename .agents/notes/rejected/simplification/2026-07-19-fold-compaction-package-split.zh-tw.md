# Agent Note: 將唯一的壓縮後端並入服務包

Status: rejected — 計畫增加更多壓縮後端，因此 Service Definition 包與 basic 提供方包繼續分離。

[English](2026-07-19-fold-compaction-package-split.md) | [简体中文](2026-07-19-fold-compaction-package-split.zh.md) | 繁體中文

## 問題

壓縮（compaction）目前拆分在兩個包中：`@deepseek-ai/dsh-compaction` 擁有一個含兩個方法的抽象服務和共享類型，`@deepseek-ai/dsh-compaction-basic` 擁有唯一的完整提供方。交付設定只載入 basic 包，除了該提供方外，沒有生產包獨立消費 Service Definition 包。

該拆分增加了一份包 manifest（中繼資料清單）、README、項目邊界、相依性邊、抽象轉發類、生成目錄項和組合接線，卻沒有實際的後端替換用例。[能力 seam 決策](../../implemented/architecture/2026-06-13-capability-seams.md)要求介面、實作和消費端都必須真實存在，而不能預先拆分；[壓縮決策](../../implemented/feature/2026-06-18-compaction-capability-seam.md)也記錄了獨立消費端的實作仍被推遲。

## 提案

把 basic 實作移入 `@deepseek-ai/dsh-compaction`，並刪除 `@deepseek-ai/dsh-compaction-basic`。`ctx.compaction`、`CompactionResult`、共享 transcript（文字記錄）和工具配對輔助方法、現有設定以及具體壓縮演算法都由一個包負責。

保留 `summarize()` 作為受保護的自訂掛鉤。部署專用的摘要器可以透過繼承或攔截現有 LLM（大型語言模型）呼叫完成訂製，無需第二個能力包。只有在第二個完整後端與獨立消費端確實需要替換實作時，才重新引入獨立的 Service Definition 包。

如果本提案獲準，應同步修訂已實作的壓縮決策與[可回憶壓縮提案](../../proposed/feature/2026-07-06-recallable-compaction.md)，使包所有權只有一處持久說明。

## 備選方案

**為可能出現的遠端或回憶後端保留拆分。** 一種可能的未來實作不足以支撐當前包邊界。回憶功能會增加壓縮結果的消費端，但不一定增加另一種實作；遠端摘要器也可以使用受保護掛鉤。

**將提供方包名用於 Service Definition 包。** 如果保留 `compaction-basic` 作為最終名稱，產品服務會看起來像一個選填後端。`compact` 已經是 `ctx.compaction` 使用的穩定服務標識，更適合作為單包所有者。

## 驗收標準

- 刪除 `@deepseek-ai/dsh-compaction-basic` 及其工作區和包元資料。
- `@deepseek-ai/dsh-compaction` 擁有當前設定、外掛程式類、演算法、類型、事件和共享輔助方法。
- 現有部署可以使用等效設定載入保留的包，模型可見行為等效。
- 自動壓縮和手動壓縮保留取消、鎖、token 用量、工具配對、持久事件、引用的來源事件 seq、重試收斂和 transcript 渲染行為。
- loader 組合、單元、失控輪次、取消、快照和真實模型壓縮測試全部透過；生成目錄與模組圖保持最新。

## 風險

這是一項有意實施的預發布包名收縮。載入 `@deepseek-ai/dsh-compaction-basic` 的嵌入方必須切換包，未來的後端替換也需要重新提取邊界。只有在仍然只有一個完整實作時，這項代價纔可接受；如果第二個後端先行落地，應重新評估是否接納本提案。
