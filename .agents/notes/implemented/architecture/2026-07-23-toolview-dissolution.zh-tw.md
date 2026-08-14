# Agent Note: toolview 溶解——工具行即 per-view keyed slot

Status: implemented

[English](2026-07-23-toolview-dissolution.md) | 繁體中文

> 範圍：獨立工具環（ToolViewRegistry/ctx.toolviews/outlet）為何退役、被什麼取代。本決策產出的落地態敘述歸 [Web 用戶端架構注](2026-07-19-gui-web-client-architecture.md)；一切現在所執行其上的註冊模型歸 [slot 體系標準](2026-07-22-slot-type-chain-implementation.md) 所有。後續的 [Client Tool 展示所有權](2026-08-08-client-tool-presentation-ownership.md) 決策僅取代本篇的 per-view 放置方式：Tool 名稱分發仍使用 keyed slot，而非平行登錄檔。

## Problem

檢視表環溶解進 slot 體系之後，client 側恰好還剩一套平行註冊模型：工具環——一個具名登錄檔（`ctx.toolviews`），帶自己的 register 文法、自己的 resolve 語義（scoped 壓 global 的謂詞分發）、自己的 subscribe/version 對、自己的 inject 快取、自己帶私有錯誤邊界的渲染出口。其中每一件都是 slot 機器已經擁有之物的第二份實作，而每一項未來能力（行草稿的 store 席位、i18n 注入、跨 bundle 身份）都將不得不建兩遍或漂移。這條環唯一像樣的存在理由是：tool 名是執行時期開放集，而 `SlotMap` 是封閉聲明表——以任意字串為鍵的登錄檔看似結構上必需。

## Decision

工具環作為獨立基礎設施已消失：工具行是**各檢視表為自己聲明的 keyed 子槽**，client 全域只剩一種註冊模型。上述理由是空的——keyed slot 的 *key 空間*本就執行時期開放（SlotMap 聲明槽、從不聲明 key；ask-user composer 的 `key: 'question'` 即先例），開放的 tool 名集合天然適配 `entryKey` 分發。

本決策最初把 `'conversation.chat.toolview'` 放在 chat 條目下，由 chat 渲染點逐行分發。後續的 [Tool 展示所有權](2026-08-08-client-tool-presentation-ownership.md) 將該放置方式移入整體 Tool 席位，並讓 `ui-tool` 擁有一個 keyed `'tool.call.toolview'` 子 slot。後續決策改變的是展示所有者，而非本決策的核心約束：Tool 註冊繼續使用普通 keyed-slot 機制，啟用、替換、快取、錯誤隔離、版本與 fallback 行為仍歸框架所有。

## 接受的語義變化

四項行為增量是刻意接受而非疏漏。跨檢視表出場最初採用逐檢視表註冊；後續 Note 記錄了為何 root/subcall 編排後來證明由一個 Tool 級展示所有者統一負責是合理的。同 key 重複註冊從登錄檔的 later-wins 靜默覆蓋變為 loud throw——紀律修正而非損失。工作階段維分發若行需要，歸元件內部（標配 kit 已帶 `useSessions`），不走登錄檔謂詞——今天沒有已落地的工作階段變體樣例。第三方在 registry 級覆蓋形態（scoped 註冊壓過 global）不復存在；真出現的未來需求走 key 命名空間約定或元件內小 resolver，永不復活平行登錄檔。

## Alternatives considered

**保留獨立登錄檔（原形態）。** 拒絕：其多維分發的每一維都有更正確的家——展示所有權歸顯式聲明的子 slot，工作階段維歸已持有標配 kit 的元件內部。剩下的只是一份沒有任何獨有能力的 slot 機器副本。

**把 `renderToolView` 提進標配 kit、登錄檔遷入 runtime 包。** 拒絕：Tool 展示是 Client UI 詞彙；上提進 runtime 會把展示概念洩漏進資料對象層，且依然留著兩套註冊模型。

**以訂閱 refCount 推導槽聲明**（首個註冊方訂閱時隱式聲明槽）。拒絕：隱式耦合加去抖複雜度；記為將來真出現多檢視表 UI 時的備選。

**slots.register 之上的薄 `registerToolView` 門面。** 緩建而非拒絕：溶解後該門面只剩編譯期文法糖（slot 名字面量收窄、tool→key 詞彙翻譯、props 預組合），執行時期為零。按「enforce at the operation boundary」（門面不是強制點）保持不建；有用的類型組合以匯出的 Tool view props 別名兌現。若重複註冊儀式今後足以證明其價值，可在不擾動直接註冊的前提下補充門面。

## Consequences

client 只有一種註冊模型；審計誰渲染 Tool 呼叫就是讀 slot register 呼叫，與其他所有 slot 同一套審計。註冊方免費獲得框架的錯誤隔離、inject 快取與 store 席位——沒有能力要建兩遍。代價即上文接受的語義變化，主要是重複 key 會 loud failure，且第三方無 registry 級覆蓋。獨立註冊方在 `ctx.slots.inject` 中點名有類型約束的 slot，因此相依性關係既顯式，又能跟隨聲明替換，無需服務順序約定。
