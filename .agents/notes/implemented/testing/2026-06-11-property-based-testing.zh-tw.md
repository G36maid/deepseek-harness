# Agent Note: 對協議形態程式碼進行基於屬性的測試

Status: implemented

[English](2026-06-11-property-based-testing.md) | [简体中文](2026-06-11-property-based-testing.zh.md) | 繁體中文

> 屬性測試套件首次執行即發現了 BlockAssembler 重複 `block-end` 的真實 bug。

## 問題

基於示例的測試只能固定我們想到的用例。harness 的核心是協議形態的程式碼：區塊流、事件日誌、schema 轉換、收件箱調度。這些場景的輸入空間具有組合性，有趣的 bug 藏在沒人寫過示例的交錯序列中。佐證：一個塊組裝的排序 bug 曾在 happy path 100% 行覆蓋率下存活。逐文件 100% 覆蓋率證明每一行都跑過了，但不能證明每種交錯都是正確的。

## 決策

每個協議形態的包各有一個由 `fast-check`（根 devDependency）驅動的 `tests/properties.spec.ts`。生成器調優為*逼真但對抗性*的輸入（而非均勻噪聲），`numRuns` 控制在本機套件總耗時遠低於約 10 秒。失敗時列印可復現的 seed。（以 100 倍迭代執行的夜間 CI job 未交付——屬性測試套件僅在常規的 `push`/`pull_request` CI 中執行；定時高迭代 job 仍屬可能的後續工作。）

- **dsh-llm / BlockAssembler：** 任意區塊流（合法 + 畸形：重複索引、滯後分片、缺少 block-start）。不變式：`blocks()` 計數 ≤ 已見到的不同索引數；重組冪等（`blocks()` 在重複呼叫間穩定，且 `message().content` 與之一致）；`blocks()` 從不拋例外且僅產出合法的內容區塊標籤；`finish` 反映最後一個 `finish` 區塊，無此類區塊時預設為 `{kind:'stop'}`。
- **dsh-session：** 任意事件日誌。不變式：`deriveMessages` 確定性；從 seed 重播結果一致；seq 嚴格單調遞增；非訊息事件不影響推匯出的歷史；推匯出的內容與日誌解耦。
- **dsh-tools：** 任意 `ParameterSchemaSpec`。不變式：JSON Schema 的 `required` 等於每一層 `required:true` 的鍵集；轉換對合法聲明而言是全函式；**並且與[執行時期參數校驗](../architecture/2026-06-11-runtime-arg-validation.md)組合驗證**——滿足 spec 的生成參數透過 `validateArgs`，而定向破壞（刪除必填鍵、頂層非對象）被拒絕。聚焦用例覆蓋每種根值類型、恰好一項匹配中的分支重疊與無匹配、顯式開放性、原始預設值以及有損 JSON。這封堵了編譯器、validator 與 `InferArgs` 之間的漂移風險。
- **dsh-agent-loop：** 任意傳送調度，對接一個永不耗盡的配接器，透過 `agent/status` settle 訊號驅動（無掛鐘 sleep）。不變式：無訊息丟失；輪次編號嚴格遞增；狀態轉換保持在合法狀態機上。

## 後果

- 生成器質量是價值槓桿——生成器偏向小索引池和短字串，使碰撞與交錯頻繁發生。
- **它已經帶來回報：** BlockAssembler 流發現了一個真實 bug——同一索引處重複的 `block-end` 會改寫已經完成的塊。現已修復（首次關閉優先，與現有遲到項規則一致），並加入專用回歸測試。
- 屬性測試因逾時而 flake 是一個發現，不應透過重試消除。agent loop（代理循環）的屬性測試在設計上是確定性的（透過 `agent/status` settle），因此掛起即為真實缺陷。
- 屬性測試是對示例測試的補充而非替代；示例測試固定特定分支，服務於 100% 覆蓋率閘門。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
