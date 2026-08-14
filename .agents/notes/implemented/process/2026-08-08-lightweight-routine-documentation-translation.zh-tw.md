# Agent Note: 輕量化日常文件翻譯

Status: implemented

[English](2026-08-08-lightweight-routine-documentation-translation.md) | [简体中文](2026-08-08-lightweight-routine-documentation-translation.zh.md) | 繁體中文

## 問題

日常雙語編輯會自動選用完整的[翻譯 skill（技能）](../../../skills/dsh-translate-docs/SKILL.md)。即使經過[基於簡報的更新最佳化](2026-07-26-briefed-minimal-translation-updates.md)，一次小的文件改動仍可能載入專用工作流程、生成簡報、把行文翻譯委派給 subagent，並另行執行一輪核驗。這種編排耗費的時間、上下文和模型 token 比直接翻譯改動文字本身還多，而且 skill 的自動發現機制還會在普通文件處理輪次中暴露該工作流程。

## 決策

- **日常翻譯一次完成，只處理一遍。** 當前 agent（代理）載入 [terminology.md](../../../../docs/i18n/terminology.md)，直接翻譯發生改動的內容；如果術語的實際首現位置跨過了編輯邊界，則移動相應括注，否則保留改動之外已經評審的對側檔案行文；最後重新記錄配對。它不會呼叫翻譯 skill、生成簡報、啟動單獨的翻譯評審輪次，也不會把翻譯委派給 subagent。
- **擴充工作流程僅限手動呼叫。** [dsh-translate-docs](../../../skills/dsh-translate-docs/SKILL.md) 保留簡報、行文翻譯委派、整篇文件和按範圍核驗路徑。[Claude Code skill 契約](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill)讀取 `SKILL.md` 中的 `disable-model-invocation: true` 和 `user-invocable: true`；Codex 讀取 `agents/openai.yaml` 中的 `policy.allow_implicit_invocation: false`。倉庫的 `.claude/skills` 符號連結把同一個 skill 目錄對映給 Claude Code，因此兩個產品共享同一份提交到倉庫的工作流程，同時分別執行各自的呼叫元資料契約。`doc-sync` 中的 skill 呼叫元資料閘門會讓這兩份獨立策略保持一致。
- **自動工作流程不會串聯呼叫這項僅限手動呼叫的 skill。** 輕量默認行為由根級指令和文件指令定義。文件、網站同步、行文和程式碼評審 skill 會連結這些指令或 i18n 契約，而不會因為推斷到雙語改動就載入 `dsh-translate-docs`。
- **配對契約與評審契約保持不變。** 兩種語言文件仍會一並更新；未觸及的對側檔案措辭保持穩定；術語約束仍然有效；只有當前 agent 確認配對後，才會重寫一致性記錄；`doc-sync`（文件同步閘門）繼續執行全語料機械檢查。語義層面的翻譯質量仍由人工評審負責。

## 曾考慮的替代方案

- **刪除擴充 skill 和簡報工具**：不予採納。在整篇文件翻譯或棘手的兩側內容協調中，以及對有意選擇受控工作流程的呼叫方而言，顯式手動呼叫仍有價值。
- **用自動呼叫的輕量 skill 取代擴充 skill**：不予採納。另一項自動 skill 仍會給這項任務增加發現上下文和呼叫邊界，而當前 agent 僅依據術語表與常駐指令即可直接完成該任務。
- **僅對新配對或大規模改動保留自動呼叫**：不予採納。基於規模的推斷同樣是一項隱藏政策，可能出乎意料地啟用高開銷工作流程。何時值得為擴充路徑付出成本，應由使用者而非 agent 決定。
- **同時取消載入術語表**：不予採納。術語表是體量小但有約束力的輸入，可以防止整個倉庫發生術語漂移；移除它等於用產品語言不一致換取 token 節省。

## 後果

- 普通開發的成本來自發生改動的源文字、其區域性對側檔案上下文和術語表，不再來自擴充工作流程的簡報與 subagent 上下文。
- 當前 agent 在同一輪次內對日常翻譯的最終結果負責。輕量路徑有意放棄擴充工作流程提供的自動生成對齊資訊、委派所提供的隔離，以及單獨的行文核驗輪次。
- 使用者仍可在 Claude Code 中透過 `/dsh-translate-docs`，或在 Codex 中透過 `$dsh-translate-docs` 顯式呼叫完整工作流程。
- Claude Code frontmatter 與 Codex 策略文件是彼此獨立的產品契約；如果某項 skill 僅在一個產品中變為手動呼叫，或者在 Claude Code 中對模型和使用者都不可用，`doc-sync` 會拒絕該狀態。
