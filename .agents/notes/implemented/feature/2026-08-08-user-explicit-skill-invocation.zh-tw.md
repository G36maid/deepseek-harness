# Agent Note: pre-step 手勢邊界上的使用者顯式 skill 呼叫

Status: implemented

[English](2026-08-08-user-explicit-skill-invocation.md) | [简体中文](2026-08-08-user-explicit-skill-invocation.zh.md) | 繁體中文

## 問題

`disable-model-invocation: true` 的 skill（技能）在設計上就是僅限使用者的：它絕不進入面向模型的目錄，`skill` 工具也拒絕載入它。它唯一正當的入口是一次顯式的使用者手勢——而 web 用戶端此前沒有這個入口。`skill.list` 過濾到模型與使用者的交集（把僅限使用者的 skill 擋在選單之外），輸入的 `/name` 一行以純文字落入默認提示詞 sink，而這行文字到達的模型又被禁止載入該 skill——於是退化為模型去 `read` 那份 SKILL.md 文件，或者乾脆無視這次手勢（issue #1470）。即使對普通 skill，純文字引用也讓使用者呼叫只是模型可以忽略的協作線索，而不是保證。

## 決策

使用者顯式呼叫是一次宿主側的 pre-step 注入，對每一個使用者可呼叫的 skill 和每一種執行入口一致：

- `dsh-tool-skill` 註冊第二個 `agent/pre-step` 監聽器（與其目錄監聽器並列，也是 `agent-instructions` 與執行時期上下文快照搭乘的同一 seam）：它在該步驟已認領的訊息中掃描以空白為界的 `/name` token——文字中任意位置均可，與 transcript（文字記錄）chip 裝飾所用的詞邊界形狀相同——收集按首見去重的名稱，逐個經 `ctx.skills.get` 載入，在已載入定義上檢查 `isUserInvocable`（產生注入內容的正是這同一次尋找），用共享的 `renderSkillContent` 渲染，並把注入追加在該步驟所有其他注入之後：背景在前（工作區規則、執行時期策略、目錄），模型必須著手處理的材料在最後、最貼近它的回答。註冊順序釘住了這一位置——手勢監聽器先於目錄監聽器註冊，因此 waterfall（瀑布式事件）會把攜帶目錄的清單交給它來擴充。
- 精確性來自封閉集合匹配，與斜槓命令完全一致：`/goal` 對照命令登錄檔解析，`/name` 對照工作區的使用者可呼叫 skill 目錄解析；未命中即保持為普通行文，因此絕不猜測。只掃描 `source.kind === 'user'` 的訊息——外部文字無法偽造手勢。路徑（`/usr/bin`）、分數（`5/8`）與帶前綴的 token（`foo/name`）都會破壞該邊界。
- 用戶端沿用[純文字引用決策](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)：選單 pick 落下字面文字 `/name `，該文字隨提示詞原樣提交；ui-skill 不實作任何裁決掛鉤，也沒有引用 codec。`skill.list`（現在是該領域唯一的 RPC）提供每一個使用者可呼叫的 skill 並攜帶 `modelInvocable`，供選單標出僅限使用者的條目。與宿主命令同名的名稱解析為命令——用戶端會在該行成為提示詞之前完成裁決並將其認領。
- 注入是一條攜帶 `skill-invocation` 來源（`{ name, form: 'instructions' }`）的 `user` 角色訊息，因此 `user/message` 落帳、上下文注入的 transcript 行（以 skill 名稱標注）與重播全部免費獲得；`renderSkillContent` 位於 `dsh-skill` seam，由注入和 `skill` 工具結果共用，二者內容逐字相同，目錄的結尾一句會告訴模型遵循注入塊而不是重新載入。

同類產品調研（Pi、OpenCode、Claude Code、Kimi Code、Codex、DeepSeek-Reasonix——本機檢出）一致表明：使用者顯式觸發都是模型零參與的程序化注入；最終形態最接近 Codex 核心側的 `$name` mention 掃描——它同樣讓每一種執行入口免於自行實作識別。

## 考慮過的替代方案

- **`skill.invoke` RPC（宿主注入、用戶端認領）**——最先實作，共兩輪迭代：先是單條混合訊息（使用者文字折進正文），後是經 inbox 原語投遞的手勢提示詞加註入兩則訊息。經真實工作階段測試後否決：混合訊息讓使用者行文汙染了注入；兩則訊息的形態相依性喚醒順序的微妙之處（`followup` 在第一個喚醒呼叫內同步認領整個 next-turn 佇列，把之後的訊息滯留到下一輪次——已實際復現），而專設 RPC 複製了 `session.prompt` 已提供的路徑，還讓 TUI/ACP（Agent Client Protocol）不得不各自重新實作識別。pre-step 擴充點把 RPC、認領機制與順序隱患一並乾淨移除。
- **從 RPC 處理器呼叫 `agent.inject()`**——inject 佇列（`next-step`，不喚醒）會在 next-turn 提示詞之前被認領，使注入在日誌中排到手勢之上；而與會喚醒的 `followup` 搭配又會重新引入同樣的順序耦合。pre-step 監聽器在步驟組裝內部注入，那裡的順序是顯式的。
- **宿主 `/skill <name>` 命令**（命令登錄檔，plan 模式先例）——兩個 token 的 UX、沒有名稱補全、僅限使用者的 skill 在選單裡仍不可發現；按 cwd 的 skill 目錄也與靜態命令登錄檔格格不入。否決。
- **用戶端展開**（拉取正文、拼進提示詞）——授權淪為可被繞過的用戶端善意，日誌失去呼叫語義，而且 Codex 已刪除其等價機制（custom prompts）轉向核心注入。否決。
- **提示詞協議上的結構化引用載荷**（Codex `UserInput::Skill` 的類似物：用戶端在文字旁附帶 `{skills: [...]}`，邊界優先採用它而不是掃描）——考慮過並暫緩：現有斜槓命令體系在協議上本身就是行文字，封閉集合的目錄匹配已經消除了猜測；已記為臺帳事項，以備手勢精確性某天需要用戶端意圖。
- **每次注入一條前導語**（Kimi 的 `User activated the skill …`）——棄用，改為一次性的目錄句子：同樣的上下文、只付款一次，且注入塊與工具結果保持逐位元組一致。

## 後果

- 純文字引用如今就是用戶端的全部故事：草稿承載純文字，chip 視覺由 lexicon 派生，寄出的文字由宿主邊界評判——手動鍵入的手勢、選單 pick 與 TUI 提示詞無從區分，也同樣具有確定性。
- 每一次使用者可呼叫 skill 的呼叫都無條件付出其完整渲染正文的成本——這是確定性的代價，同類調研表明所有產品都在付款。在句子中間提到一個已知 skill 名稱也會載入它；這就是 Codex 的 mention 語義，屬於有意接受。
- `skill-invocation` 來源搭乘 `user/message`，因此「模型可見 ⟺ 已記錄」在不新增事件類型的情況下繼續成立，重播與 UI 讀取的是元資料而非文字標記。
- 放棄逐次注入前導語後被接受的殘餘：no-reload framing 只搭乘目錄，而所有 skill 都僅限使用者的工作區永遠不會發布首個目錄——注入可能在完全沒有 framing 的情況下到達，模型可能多餘地呼叫一次 `skill` 工具（替換目錄的空分支攜帶該句；從未發布的情形沒有）。僅為 framing 而發布目錄被判定比這一次可復原的錯誤更糟。
