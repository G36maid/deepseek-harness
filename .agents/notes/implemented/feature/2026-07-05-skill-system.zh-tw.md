# Agent Note: Skill 系統——面向 agent 的漸進式指令披露

Status: implemented

[English](2026-07-05-skill-system.md) | [简体中文](2026-07-05-skill-system.zh.md) | 繁體中文

## 問題

agent（代理）產品已趨同於一種 skill（技能）模式：保持請求提示詞精簡，僅列出可用的指令包，當模型判定某任務匹配時再載入完整正文。Codex、Claude Code、OpenCode 與 Kimi Code 在細節上各有不同，但都將發現元資料與完整指令分離，使工作區能承載可複用的行為而無需在每個輪次付款全量提示詞開銷。

DeepSeek Harness 使用同一原語，使項目特定的評審、外掛程式編寫和工具使用指南存放在工作區或使用者的 agent 設定旁，而非硬編碼到 agent loop（代理循環）中。

## 決策

`@deepseek-ai/dsh-skill` 是純提供方登錄檔（`ctx.skills`），`@deepseek-ai/dsh-skill-filesystem` 是隨附的本機檔案系統提供方，`@deepseek-ai/dsh-tool-skill` 負責持久化工作階段目錄與面向模型的 loader 工具。`dsh-agent-spine-demo` 默認載入登錄檔、本機提供方和消費端，使 TUI、headless 與 ACP（Agent Client Protocol）應用獲得相同行為，同時嵌入式或遠端提供方可在不修改登錄檔或消費端的前提下貢獻 skill。其 `skills` 設定將 `registry`、`local` 和 `tool` 分支分別轉發給對應的所有者。

專用的隨包提供方可以貢獻不可變的 skill，無需檔案系統發現。交付的 CLI（命令列介面）默認將 `@deepseek-ai/dsh-skill-badge` 聲明為停用；啟用其組合設定行，就會透過同一個登錄檔和消費端貢獻官方徽章指令（見[決策](2026-08-06-bundled-dsh-badge-skill.md)）。

提供方外掛程式在 `apply()` 期間同步註冊。提供方成員資格是由直接 effect 持有的狀態：註冊與 dispose（資源釋放）同步地使已完成的目錄失效，發現操作按需讀取當前提供方對映而非監聽登錄檔變更事件。提供方目錄從等待的 `list()` 呼叫返回排序後的候選項，遠端提供方在此過程中執行初始化、認證和發現，同時遵守尋找的 abort 訊號。登錄檔校驗每個候選項，按排名、提供方註冊順序和提供方內部順序以先到先得方式解決同名 skill 衝突，然後按 skill 名稱排序摘要以保證消費端獲得確定性結果。它僅快取已完成的目錄快照，並在發現過程中提供方／執行時期修訂版本發生變化時重試，因此解除安裝操作不會將一個過時且不可解析的 skill 凍結到工作階段目錄中。執行時期 `ctx.skills.register(...)` 仍作為嵌入式行程內 skill 的便捷方式保留，使用 project 優先於 user 的優先級；`runtime` 保留為登錄檔擁有的提供方名稱。

本機提供方按先到先得的排名順序掃描 cwd 敏感的項目根目錄、自訂根目錄和使用者根目錄：項目 `.dsh`、項目 `.agents`、`customSkillDirs`、使用者 `.dsh`，然後是使用者 `.agents`。使用者 `.dsh/skills` 掃描跳過 `.system`，以免系統擁有的目錄被當作普通使用者內容處理。本機提供方不會合成內建系統 skill；已設定的 bundled 根目錄和專用提供方會提供額外 skill。

每個 skill 是帶 YAML frontmatter 的 `<name>/SKILL.md` 或 `<name>.md`。`name` 和 `description` 為必填；`whenToUse`、`metadata`、`disable-model-invocation` 和 `user-invocable` 為選填。名稱採用 kebab-case。呼叫欄位會投影到類型化的巢狀策略中，具體由[模型與使用者獨立呼叫決策](2026-07-28-skill-invocation-policy.md)定義；解析器會拒絕舊的駝峯拼寫。YAML frontmatter 使用 `yaml` 包解析，而非 `js-yaml` 或手寫解析器：`yaml` 是本包已聲明的現代解析器，足以滿足有限的 frontmatter 需求，窄解析器要麼拒絕使用者預期可用的合法 YAML，要麼膨脹為一個未經評審的 YAML 子集。

本機 skill 的檔案系統 I/O 在載入了檔案系統服務時透過 `ctx.fs` 進行：項目根目錄尋找使用 `resolve` 和 `stat` 探測 `.git`，根目錄發現使用 `listDir`，skill 讀取使用 `readText`。Node 檔案系統作為後備，供在不掛載 fs seam 的最小上下文中載入 `dsh-skill-filesystem` 時使用。缺失的根目錄、不可讀或格式錯誤的 skill 文件、以及提供方 `list()` 的瞬態失敗均降級為警告並跳過，使一個壞源不會導致所有 agent 請求失敗；格式錯誤的候選項仍然快速失敗，因為它們違反了提供方約定。

`dsh-tool-skill` 在工作階段的第一個 `agent/pre-step` 注入一個持久化的 user-role `<system-reminder>` 目錄，作為帶來源的 `user/message`，且僅當該 agent 的工具檢視表解析到本外掛程式精確的 `skill` 註冊時才注入。該目錄僅包含排序後的 skill 名稱與描述；不包含正文、路徑、來源、提供方和路由提示。描述經過空白規範化、XML 轉義，並受 `catalogDescriptionMaxLength` 上限約束，其預設值為 `500`，最小值為 `3`。完整的 skill 正文從不包含在目錄中。（目錄最初透過僅請求的[工作階段前綴擴充點](../../archived/feature/2026-07-07-session-prefix.md)（已歸檔）傳遞；[統一帶來源訊息的決策](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md)將其移入持久化歷史。）

登錄檔的 `list()` 返回全部勝出摘要，而模型與使用者消費端應用[獨立呼叫策略決策](2026-07-28-skill-invocation-policy.md)定義的呼叫判定。`skill({ name })` 工具為當前 agent cwd 載入一個模型可呼叫的 skill，返回包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>` 的工具結果。`resourceBase` 提供一個目錄、URL 或不透明的提供方管理的基路徑，用於顯式引用的指令碼、參考資料和資產；資源僅按需載入，不進行目錄枚舉。無法解析的名稱報告該 skill 未知或不再可用；無效名稱和 `invocation.modelInvocable` 為 `false` 的 skill 保留不同的工具錯誤。工具結果是面向模型的可見披露路徑。

資料結構與目錄／工具約定記錄在 [skills.md](../../../../docs/subsystems/skills.md) 中，服務簽名見生成的[服務目錄](../../../../docs/subsystems/skills.md#cordis-surface)。

## 曾考慮的替代方案

**將完整 skill 正文注入每條系統提示詞。** 否決，因為這破壞了漸進式披露，使每個請求都為可能不適用的指令付出代價。

**僅以斜槓命令暴露 skill。** 否決，因為模型主動載入是核心能力；面向人類的命令廣播不改變發現機制。

**將本機檔案系統掃描直接放入 `ctx.skills`。** 否決，因為編碼 agent、Web agent 和未來的外掛程式生態需要不同的 skill 來源。提供方登錄檔與 subagent seam 映像檔：登錄檔擁有衝突解決和消費端，實作負責載入。

**使用系統提示詞段落。** 否決，因為渲染後的系統提示詞是單一字串，而目錄是一條 user-role `<system-reminder>` 訊息。[僅請求的工作階段前綴擴充點](../../archived/feature/2026-07-07-session-prefix.md)（已歸檔）是最初的機制；統一帶來源訊息的決策移除該擴充點後，目錄改為具有相同訊息形狀的持久化帶來源注入。

**在 `~/.dsh/skills/.system` 下物化內建 DSH 編寫 skill。** 否決，因為打包的 skill 不會在啟動時寫入使用者主目錄，嵌入式或遠端提供方在設定後提供 skill。

**遞迴發現巢狀的 `**/SKILL.md`。** 否決。扁平文件和一級目錄包覆蓋了設定的根目錄，同時使重複處理和目錄順序易於推理。

**手寫 frontmatter 解析器。** 否決，因為已接受的 schema 包含一個開放的 `metadata` 對象。窄解析器要麼拒絕使用者預期可用的合法 YAML，要麼膨脹為一個未經評審的 YAML 子集。

## 後果

agent-core 主幹包含一個目錄貢獻者、一個本機提供方和一個面向模型的工具。skill 發現是 cwd 敏感的，因此以不同工作階段 cwd 值建立 agent 的呼叫方可以按設計觀察到不同的項目 skill 覆蓋。

目錄對於固定的根目錄集合和執行時期註冊修訂版本是確定性的。本機提供方會監視已設定的根目錄，並在發生相關磁碟變化後使已完成的目錄失效；執行時期註冊和提供方釋放也會使其失效。

## 延後

fork 的 skill 上下文（`context: fork`）、參數聲明與提示（`arguments` 和 `argument-hint`）、以及逐 skill 的工具約束（`allowed-tools` 和 `disallowed-tools`）不在已交付的約定範圍內。登錄檔、本機提供方和麵向模型的工具不解析、不廣播、也不強制執行這些欄位。直接使用者呼叫已作為 TUI 功能交付，基於共享呼叫策略和受信的 `get()` 原語；見[已歸檔的 TUI skill 斜槓命令](../../archived/feature/2026-07-21-tui-skill-slash-command.md)。
