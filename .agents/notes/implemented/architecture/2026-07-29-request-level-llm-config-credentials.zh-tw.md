# Agent Note: 請求級 LLM 設定與憑據 seam

Status: implemented

[English](2026-07-29-request-level-llm-config-credentials.md) | [简体中文](2026-07-29-request-level-llm-config-credentials.zh.md) | 繁體中文

> 範圍：`ctx.settings` 的第一批生產消費端（兩個 LLM（大型語言模型）配接器外掛程式）、新增的 `packages/credentials/` 能力族，以及 `packages/util/atomic-write` 的抽取。後續的 wire 面（`settings.*`/`credentials.*` RPC、secret 角色脫敏、web 設定表單）是另行開展的工作，不在本 Agent Note 範圍內。

## 問題

[settings seam](2026-07-28-user-settings-seam.md) 落地時沒有生產消費端，而 LLM 配接器正是當初驅動程式該 seam 的那個消費端：兩個配接器都在外掛程式載入時把 `apiKey`/`baseURL`/catalog 凍結進配接器實例，改金鑰或端點就要重新啟動行程，金鑰缺失則直接使外掛程式載入失敗——對個人設定頁而言，這是最糟糕的首次執行姿態（「先存金鑰，再重新啟動」）。機密的走向也不對：順理成章的做法（把 `apiKey` 放進設定文件）會被迫引入脫敏、`replace` 時的伺服器端回填與 dotfiles 同步告警，為一個同類產品根本沒有的問題堆起一整摞緩解措施——Codex（`env_key` + auth.json）、Reasonix（`api_key_env` + 家目錄 `.env`）、OpenCode/Pi（`auth.json`）、Claude Code（`apiKeyHelper`）全都把機密擋在設定檔之外。

## 決策

**按請求解析，而非重建 fiber。**配接器改為接收一個 options thunk（外加按流呼叫的憑據解析器），不再持有凍結的構造期事實，每個操作解析一次——即 Pi 的模式，連同其經測試固定的語義：跨越一次變更的兩個請求看到兩份設定，一個請求恰好解析一次，進行中的流保持其起始事實。這刪掉了重建式設計所需的整套切換機制（`DUPLICATE_ADAPTER` 順序問題、`NO_ADAPTER` 視窗、延遲啟用狀態機），並把金鑰缺失變成*請求時*可據以處理的失敗（`MISSING_CREDENTIAL` 點名每個設定入口），同時路由保持註冊、catalog 保持可瀏覽。唯一在註冊期捕獲的事實——`ctx.llm` 登錄檔在 `registerAdapter` 時快照的重試策略（外加 pi-ai 的路由*集合*）——在其變化時於一個同步區段內原地重新註冊同一配接器實例。

**機密是引用，值藏在 `ctx.credentials` 背後。**設定（兩個面）攜帶 `apiKeyEnv: DEEPSEEK_API_KEY`；三包憑據 seam 按操作解析它。`credentials-local` 把活躍行程環境（只讀、優先——啟動時覆蓋是操作者意圖，必須*可見地*只讀，因此被遮蔽的寫入直接拒絕而不是表面成功）疊加在提供方管理的文件之上（可寫、重載時整體替換快照使刪除的條目絕不滯留——來自 Claude Code 增量重放（additive reapply）的教訓）。該文件當時是 dotenv 形式的 `$DSH_HOME/.env`；[憑據文件拆分](2026-08-04-credentials-yaml-and-user-environment-layer.md)後來把它移到 `$DSH_HOME/.credentials.yaml`，並讓舊路徑轉為使用者的環境層。配接器透過 seam 解析該引用；僅在未掛載 seam 時，才透過各環境層解析。

**按外掛程式劃分 namespace，schema ≡ `Config`。**每個配接器註冊自己的 namespace（`llm-deepseek`、`llm-pi-ai`），schema 用其外掛程式 `Config` schema，組合 `base` 用其 `cordis.yml` 條目——settings 分節與 entry 設定是同一種 YAML 形狀，`resolveAdapterOptions`/`resolveProfiles` 對兩者仍是唯一的顯式 resolve 步驟。即時快照若違反 schema 之外的約束，則保留最後可用事實（seam 的最後可用值哲學向上延伸一層）；entry 設定本身仍會載入失敗。pi-ai 的 `providers` 改為以路由為鍵的字典，base 層與使用者層因此按提供方合併，路由集合也由結構直接表達；陣列形狀響亮失敗並給出遷移指引，而空字典是合法的休眠姿態——組合可以裸掛該配接器，把每一條路由都留給使用者面決定。

## 曾考慮的替代方案

- **由橋接外掛程式（`dsh-llm-models`）持有統一的 `models` 字典**——有了按外掛程式劃分的 namespace，就沒有什麼可橋接的了；它所需的配接器對映規則純屬憑空發明的間接層。
- **把機密放進 settings.yaml 並靠 `role('secret')` 脫敏**——刪除問題本身（引用）勝過緩解問題（脫敏 + 回填 + 同步告警）；coding-agent（代理）同類產品在這一點上口徑一致。
- **登錄檔級的即時重試策略**——讓 `providerRetryPolicy` 每次呼叫都重讀，會靜默改變所有註冊都相依性的 `ctx.llm` 捕獲約定；原地重新註冊路由既保住該約定，又保持可觀察。

## 後果

上手流程端到端免重新啟動（由 `missing-credential` headless 快照與憑據輪換組合測試固定）：無金鑰啟動、瀏覽 catalog、存入金鑰、再次發起提示。demo 默認掛載 `settings-file` + `credentials-local`，不再內聯任何 `!!js` 金鑰接線。`runLoaderSmoke` 新增 `expectedExitCode`，使按設計出現的失敗面可以被固定而非被掩蓋。延後事項：wire/UI 面在任何 RPC 暴露 `describe()` 之前必須對 `role('secret')` 欄位脫敏；settings 層的陣列仍整體替換（deepseek 的 `models` 清單）；settings 分節無法移除組合提供的 pi-ai 路由（只能覆蓋或擴充）。後來的一項決策改造了儲存的所在位置與誰可以讀取它，讓一個請求解析出一個設定世代，並使路由替換成為原子操作（[credential boundaries note](2026-07-30-credential-boundaries-and-atomic-registration.md)）。
