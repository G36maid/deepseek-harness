# Agent Note: 創作 preset 的 agent 自行掛載校驗其組裝

Status: implemented

[English](2026-08-11-preset-authoring-agent-validates-its-own-composition.md) | [简体中文](2026-08-11-preset-authoring-agent-validates-its-own-composition.zh.md) | 繁體中文

## 問題

`cordis` preset 隨包發布 `editing-cordis-compositions`，它是 agent 創作 preset 時唯一的指導來源。其中四條陳述與事實不符，而分量最重的兩條恰好指向該 skill 自稱「最容易讓人栽跟頭的規則」。

它把 `tool-bash` 當作「行名看不出發布服務」的示例——「看著像工具，其實 provides `bashEnv`」。`tool-bash` 不發布任何服務，它聲明 `inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`，`bashEnv` 來自宿主組裝自己的 `shell-env` 行。agent 照此給 `tool-bash` 套上 `isolate` realm，該行會永遠等待被自己的 realm 擋住的服務，整個 preset 掛載失敗。

它的 `isolate` 示例把 `jobs-local` 與 `tool-jobs` 組在一起。`jobs-local` 位於宿主平面，而已發布組裝在自己的註釋裡寫明：給 `tool-jobs` 套 entry-local realm 會讓 `run_in_background` 回答「background jobs unavailable」。示例與緊挨著它的文件互相矛盾。

它把字串 realm label 描述為跨子樹共享一個實例。label 只是加入同一 realm，`provide()` 在同一 realm symbol 下第二次註冊仍然拋錯——`standard` 的頭部註釋早已如此說明。

它讓 agent 去讀包的 README 判斷某行是否發布服務。每個 harness 包都聲明瞭 `files`，且沒有任何一份聲明包含自己的 README，因此裝機部署中一份也沒有。在那裡該指令根本無法執行。

四條之下還壓著一個能力斷言：agent「自己起不了工作階段」，於是校驗退化成肉眼核對 YAML 欄位，再把結果經設定頁的紅色標記交給使用者。那個標記是發現階段的結構檢查，遠弱於這句話給人的印象。

## 決策

skill 教 agent 透過 `ctx.agentPresets` 自行掛載校驗其組裝，其餘每個示例都取自同一倉庫中已發布的組裝。

`standingKeyFor(id)` 是校驗手段。它走 `ensureStanding()`——與工作階段啟動完全相同的真實掛載，只是不建立 agent——因此能拒絕包無法解析的行、設定非法的行、把服務發布進根 realm 的行，以及始終未啟用的行。掛載失敗會刪除常駐條目並 dispose 其 scope，不留殘留；掛載成功則裝上首次真實工作階段本來也會裝上的那個常駐代際。因此 skill 把它安排為完成編輯後的最終檢查，而不是逐行迴圈。

skill 明確寫出：`list()` 的 `broken` 欄位**不是**校驗。發現階段的健康檢查只證明文件能被 Loader 的方言解析且行帶 `name`，上述四類失敗全部能透過它。

agent 按 `cordis_mount` 自身文件所述的方式夠到 roster 服務：掛一個聲明 `inject: ['agentPresets', 'tools']` 的臨時外掛程式，並為自己註冊一個工具——因為掛載只返回自身的確認資訊，而已註冊的工具纔是服務結果在下一步抵達模型的途徑。skill 逐字附上該外掛程式。`agentPresets` 位於生成的 `cordis_inspect what:"api"` 目錄中並帶完整 JSDoc，沙盒 façade 僅憑 `fiber.inject` 而非白名單放行服務，因此這條路徑沒有為該 skill 做任何特例。

`copy(from, id, name)` 被指定為創作寫入手段，取代 shell 複製：它校驗 id、拒絕任何根已提供的 id、失敗時回滾、重寫副本的 `preset.yml`，並在宿主側執行而無需沙盒升級。沙盒升級的說明保留，移到真正適用之處——其後編輯 `agent.cordis.yml` 仍然寫在工作階段工作區之外。

「某行是否發布服務」改由 `cordis_inspect what:"services"` 回答，它會給出每個存活服務的持有 fiber。

指導保留 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/` 作為「我的 preset 在哪」的答案，同時把 agent 實際讀取或編輯的路徑改走 `list()` 或 `resolve()`。寫出該路徑對人講是對的，喂給文件工具是錯的：部署可以設定其他根目錄，而 `list()` 無法揭示一個尚且為空的使用者根。

該路徑如今是本包的屬性，而非某個啟動器的屬性。除非 `includeUserRoot` 為 false，`AgentPresets` 自行推導 `<dshHome>/.agent-presets` 作為 `user` 根，正如 [`dsh-skill-filesystem`](../../../../packages/skill/skill-filesystem/README.md) 推導 `<dshHome>/skills`；`apps/cli` 只提供**隨附**根——那是唯有已安裝 app 才能解析的路徑。它取代的那種不對稱曾付出過代價：兩個根都由單一啟動器補入時，`dsh run` 啟動的 roster 一個根都沒有，解析 `standard` 直接失敗（當時的修法是讓每個啟動器都執行該 patch）。推匯出的根追加在全部已設定根之後，因此隨附 id 仍會遮蔽佔用它的家目錄目錄，而 `writableRoot()` 仍優先選擇顯式設定的 `user` 根。它在構造時解析一次：若根目錄集合在一次 `list()` 與依據其答案執行的 `copy()` 之間發生變化，寫入的將是呼叫方從未見過的目錄。

禁止改動隨發布安裝的約束，從創作步驟中的一段提升為頂部的 `## Off-limits` 一節，並擴充到禁止改宿主組裝繞行。新增的自校驗呼叫不削弱它：`copy()` 拒絕任何根已提供的 id，`remove()` 拒絕隨部署發布的 preset。

## Measured behavior

下表每一行都由啟動已發布的 Web 組裝、並在由 `cordis` 組裝出的 agent 上經 `ctx.tools.execute` 呼叫工具得出——全程無模型參與。

| 被測組裝 | `list()` 的 `broken` | `standingKeyFor()` |
|---|---|---|
| 行指向不存在的包 | 空 | `Cannot find package '@deepseek-ai/dsh-does-not-exist'` |
| 服務行未套 realm，名字宿主已提供 | 空 | `service "tasks" has been registered at <LocalJobRegistry>` |
| 服務行未套 realm，名字宿主未提供 | 空 | `row(s) published process-global service(s) [workflows]; …` |
| 同一行置於 `isolate` 內 | 空 | 掛載成功 |
| 消費者行無人提供服務 | 空 | `1 row(s) did not activate: … waiting for workflows` |
| 行缺少必填設定欄位 | 空 | `invalid config: $.allowParallelInProgress missing required value` |

skill 自帶的 `cordis_mount` 程式碼片段經工具登錄檔逐字執行：它成功掛載，其 `preset_check` 工具在下一次讀取時出現在組裝該 agent 的目錄中，對有效 preset 回答 `mounted OK`，對無效 preset 回答掛載拒絕原因。

## 考慮過的替代方案

**把校驗留給使用者，只修四處錯誤。** 這些錯誤與那句能力斷言同源——指導是按 preset 層的公開面寫的，而不是按被組裝出的 agent 實際夠得到的東西寫的——而無法自查的 agent 交出的組裝，其缺陷設定頁同樣看不見。

**把 `list()` 的 `broken` 欄位教成校驗手段。** 它正是設定頁展示的欄位，看起來像是預期答案。它對所有要緊的失敗一律放行，而把它當成校驗，正是原指導顯得完整的原因。

**給 preset 加一個一等的 preset 校驗工具。** 組合出的路徑已經存在，且由 `cordis_mount` 自己的 schema 記載；專用工具會給一個「無需專用工具即可夠到執行時期」的 preset 再添一個面向模型的行。

## 後果

- 校驗成功會留下一個永不回收的常駐代際，這是 roster 按代際本就承擔的[常駐掛載](../architecture/2026-08-08-per-preset-standing-mounts.md)代價——由 agent 在編輯收尾時付一次，而不是由使用者在首次工作階段時付。
- skill 現在相依性 `cordis_inspect` 生成的 API 目錄對 `agentPresets` 保持最新；`doc-sync` 中的 `verify-cordis-api` 是守住這一點的閘門。
- 有兩個示例現在是對 `standard` 組裝的引用。若該文件的 `delegation` 組發生變化它們會漂移，而 `web-agent-presets` e2e 捕捉不到。
- 被修正的四條陳述原本是該 skill 對 realm 規則僅有的具體圖示。選擇替換而非刪除，規則才仍然可教；替換後的示例讀一個已發布文件即可核驗。

## Related

取代[破損 preset 是 roster 行](2026-08-09-broken-preset-roster-rows.md)中關於創作模式指導的那一條，其健康檢查決策依然有效——本篇只推翻它「agent 起不了工作階段；設定頁的紅色標記是使用者的檢查手段」這一結論。創作的 copy-only 形態由[copy-only preset 創作](../simplification/2026-08-08-copy-only-preset-authoring.md)負責。
