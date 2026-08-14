# Agent Note: 在 CI 中對外部 DeepSeek API 執行真實 API e2e 測試

Status: implemented

[English](2026-06-19-real-api-e2e-ci.md) | [简体中文](2026-06-19-real-api-e2e-ci.zh.md) | 繁體中文

## 問題

根據策略，harness 高度相依性真實 API 測試：[docs/testing.md](../../../../docs/testing.md) 指出，無金鑰套件證明的是管線，而非產品；[ACP（Agent Client Protocol）inject 事後檢討（postmortem）](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)則是常設證據——178 項無金鑰測試保持綠色時，真實 ACP 用戶端工作階段卻立即崩潰。真實 API e2e 套件（`pnpm run test:e2e`，即 `*.e2e.ts` 文件）的存在正是為了彌合這一缺口：它針對線上 DeepSeek API 驅動 agent（代理）——真實模型呼叫、真實 bash 工具、多輪次、復原、ACP-over-stdio。

默認閘門（[.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)）刻意無金鑰：不攜帶 secret，可供 fork 執行。`test:e2e` 在無金鑰時自動跳過（`describe.skipIf(!process.env.DEEPSEEK_API_KEY)`），因此將其加入該工作流程只會報綠而不會真正執行真實套件。要讓真實 API 覆蓋率成為合併訊號，需要一個獨立的、攜帶 secret 的工作流程。

## 決策

一個與 ci.yml 分離的專用工作流程 [.github/workflows/e2e.yml](../../../../.github/workflows/e2e.yml) 使用 repo secret 對外部 API 執行且僅執行 `pnpm run test:e2e`，僅在可信事件上觸發，並帶有一個 preflight 檢查：將缺失的 secret 轉化為明確的失敗而非虛假的綠色。無金鑰工作流程保持獨立，使可 fork 的品質閘門與消費 secret 的真實 API 閘門各自擁有不同的觸發和憑證策略。

### 獨立工作流程，而非 ci.yml 中的一個 job

ci.yml 的價值在於它無金鑰、可 fork、始終為綠：任何貢獻者（包括外部 fork）都能獲得完整的無金鑰訊號，secret 不在爆炸半徑內。在其中新增消費 secret 的 job 會將這個始終為綠的閘門耦合到憑證可用性和不同的觸發策略上。將攜帶 secret 的工作放在獨立文件中，隔離了 secret、觸發和並行策略，並為 fork 保留了 ci.yml 的特性。不同的生命週期→不同的文件。

### 約束不是成本，而是可靠性

內部推理（inference）成本不是限制因素，因此工作流程針對覆蓋面和訊號最佳化。它會在多種觸發條件和每個受信任 PR（Pull Request）上執行所有匹配的 `*.e2e.ts` 文件，以落實 [docs/testing.md](../../../../docs/testing.md) 的有金鑰策略。

### 觸發條件：僅限可信事件

`workflow_dispatch` + `push` 到 `main`/`master` + 每夜 `schedule`（`17 0 * * *`，即北京時間 08:17）+ `pull_request`。push 提供合併後訊號；schedule 捕捉外部 API 漂移；dispatch 是手動逃生通道；可信 PR 獲得合併前閘門。該合併前訊號有意接受 § 安全性中描述的更大金鑰暴露面。

### 不可信 PR 的閘門

GitHub 對兩類 PR 扣留 repo secret：來自 **fork** 的 PR，以及 **Dependabot** PR（同倉庫分支，`head.repo.fork == false`，但 secret 仍被扣留）。一個 job 級 `if:` 對兩者都跳過整個 job：

```
github.event_name != 'pull_request'
  || !(github.event.pull_request.head.repo.fork || github.event.pull_request.user.login == 'dependabot[bot]')
```

Dependabot 子句基於 PR **作者**（`pull_request.user.login`）而非 `github.actor`（執行觸發者）：維護者重新打開或重跑 Dependabot PR 時，`github.actor` 會變成人類，但該 PR 仍然無金鑰；基於作者的判斷在這種情況下依然正確。被 **job 級** `if:` 跳過的 job 報告為*成功*檢查（不同於工作流程/觸發級跳過會保持 pending），因此如果需要將此工作流程標記為 required status check 也是安全的——fork/Dependabot PR 的跳過但綠色的檢查不會阻塞合併。

該閘門是一個*乾淨跳過的便利措施*，而非 secret 的安全邊界（見 § 安全性——邊界是 GitHub 自身在 `pull_request` 下對 fork 的 secret 扣留機制）。沒有該閘門，fork 仍然無法讀取金鑰；只是會遇到令人困惑的 preflight 硬失敗並浪費計算資源。

### Preflight：明確失敗，絕不虛假報綠

由於 job 僅在 secret 應當存在的可信事件上執行，preflight 是一個無條件的存在性檢查：金鑰為空→`exit 1` 並附帶 `::error::` 註解指明需要設定的 secret 名稱。這是讓自跳過套件可以安全地作為閘門的關鍵。沒有它，被刪除/重新命名/錯誤設定的 secret 會讓 `test:e2e` 跳過所有真實套件並報告全綠——整個安全網的靜默退化。該守衛將「secret 缺失」從不可見的虛假透過轉化為可見的失敗。（其正確性已在實際中驗證：secret 存在之前的執行恰好在此步驟失敗。）

### Secret 對映與衛生

repo secret 命名為 `DEEPSEEK_API_KEY_EXTERNAL`；對映到配接器和測試讀取的 `DEEPSEEK_API_KEY` 環境變數（`process.env.DEEPSEEK_API_KEY`）。獨立的 secret 名稱記錄了意圖（這是*外部*公開 API 金鑰，不是內部端點金鑰），並允許內部端點金鑰日後無衝突地共存。以下衛生選擇均為防禦性設計：

- **步驟級 secret。** `DEEPSEEK_API_KEY` 僅在 preflight 和 e2e 步驟的 `env:` 中設定，從不在 job 級設定——因此 checkout/setup-node/install 永遠看不到它。相依性中被入侵的安裝時生命週期指令碼無法讀取不在其環境中的 secret。
- **`permissions: contents: read`。** job 僅讀取倉庫以執行測試；不需要寫權限（無 PR 評論、無 status 寫入），因此 `GITHUB_TOKEN` 降至最小權限。
- **`DEEPSEEK_BASE_URL` 固定**為 e2e 步驟上的 `https://api.deepseek.com`。配接器在未設定時會默認使用此值（[packages/llm/llm-deepseek/src/index.ts](../../../../packages/llm/llm-deepseek/src/index.ts) `PUBLIC_BASE_URL`），但顯式固定具有自文件性和密封性——倉庫根目錄的 `.env`（如果存在，`vitest.e2e.config.ts` 會載入它）無法靜默地將執行重定向到其他端點。
- **不回顯 secret。** preflight 僅列印 `DEEPSEEK_API_KEY present.`——不列印值或長度。

### 範圍與執行時期形態

job 僅在 Node 24 上執行 `test:e2e`；無金鑰閘門和版本相容性屬於主 CI 工作流程。測試透過 workspace paths 對映以未建置形式執行，使用有界的可設定 worker 池、逐測試重試和 job 逾時。被取代的 PR 執行會被取消，而 push 和 schedule 執行完整執行以提供合併後訊號。

DeepSeek 原生 `web_search` 探測已註冊但會跳過。線上 Anthropic 相容端點可能返回成功回應卻沒有結構化來源塊，因此對來源存在性的正向斷言不是可靠的合併訊號；單元測試仍會鎖定回應解析行為，但 CI 不會驗證線上端點返回的來源塊協定格式（wire format）。

## 安全性

倉庫的首個 CI secret 需要一份記錄在案的威脅模型，因為同倉庫 PR、fork PR 和 Dependabot PR 的訪問權限各不相同，且倉庫公開後會發生變化。

### 當前誰能觸及 secret（私有倉庫）

- **無寫權限（fork PR）：不能。** 兩個獨立事實阻止了它。第一，工作流程使用 `pull_request` 而**非** `pull_request_target`——GitHub 不會將 repo secret 傳遞給 fork PR 的 `pull_request` 執行，因此 `secrets.DEEPSEEK_API_KEY_EXTERNAL` 在 fork runner 上解析為空。第二，`if:` 閘門完全跳過 fork PR。secret 扣留是真正的邊界；閘門是縱深防禦和使用者體驗。
- **有寫（push）權限：能。** 同倉庫分支 PR 會收到 secret，因此有寫權限的作者可以修改測試程式碼（或安裝生命週期指令碼，或其分支上的工作流程 YAML）來竊取金鑰。這**是 GitHub Actions 的固有特性，並非本文引入的**：任何對任何倉庫有 push 權限的人都可以透過編寫工作流程來竊取該倉庫的任何 Actions secret。寫權限⇒secret 訪問權，始終如此。緩解措施在於誰被授予寫權限以及分支保護，而非本文件。

因此「任何能開 PR 的人都能竊取它」是錯誤的：只有寫權限集合內的人能，而這些人本來就能竊取倉庫持有的任何 secret。

### `pull_request` 觸發器增加的殘餘暴露面

由於啟用了 PR 執行，金鑰會在合併前被交給**寫權限作者 PR 分支上的程式碼**。這比 `push` + `schedule` + `workflow_dispatch` 的暴露面更大，為在可信寫權限集合內獲得合併前訊號而接受。如果這一權衡發生變化，可移除 `pull_request` 觸發器，同時保留合併後、每夜和按需覆蓋。

### 倉庫公開後的變化

**透過本工作流程**，secret 對公眾仍然受保護：`pull_request` 在公開倉庫上行為一致——fork PR（現在任何人都能開）仍然收不到 secret，且在公開倉庫上 GitHub 額外要求維護者批准 fork PR 執行，即使批准後執行也不會獲得 secret（批准執行不等於交出金鑰）。寫權限集合不因可見性改變而改變，因此內部人員的現實也不變。

變差的是*周邊*模型，以下是翻轉可見性之前需要處理的事項：

- **日誌變為全球可讀。** 今天洩露給組織成員的粗心 secret 回顯，公開後會洩露給整個網際網路並在數分鐘內被爬取。secret 處理紀律（不回顯值/長度——已做到）的重要性大幅提升。
- **`pull_request_target` 陷阱變為災難性的。** 如果有人為了「修復」PR 執行而將觸發器切換為 `pull_request_target`，工作流程將在 base-repo 上下文中執行不可信的 fork 程式碼並**攜帶** secret——完整的金鑰洩露向量。在私有倉庫中這勉強無害，在公開倉庫中則是災難。e2e.yml 中觸發器上的 `SECURITY —` 註釋禁止此更改並指向本文。
- **翻轉時輪換金鑰。** 金鑰曾存在於私有倉庫的 CI 中；將公開視為「假定已暴露」，在那一刻輪換 `DEEPSEEK_API_KEY_EXTERNAL`。
- **將 secret 置於控制之下。** 確認 Settings → Actions → *"Send secrets to workflows from fork pull requests"* 保持**關閉**（這是唯一真正會打破 fork 邊界的設定），並考慮將金鑰移入帶有 required reviewers 的 GitHub **Environment**，使即使已合併的程式碼也只在受控條件下使用它，且輪換有單一歸屬。

以上均不需要修改工作流程即可公開；它們是運維步驟加上已新增的 `pull_request_target` 守衛註釋。

## 曾考慮的替代方案

- **在 ci.yml 中新增消費 secret 的 job**：否決。會將無金鑰、可 fork、始終為綠的閘門耦合到憑證可用性和不同的觸發/並行策略上；不同的生命週期，不同的文件。
- **省略 `pull_request` 觸發器**（更小的金鑰暴露面）：為獲得合併前訊號而否決；安全性章節承載了已接受的暴露分析。

## 後果

新增一個 CI 工作流程和倉庫的首個需要維護的 secret。真實 API 套件現在作為合併閘門（可信 PR 上的合併前閘門、主分支上的合併後門禁）並每夜執行，因此 agent 與外部 API 互動中的真實故障會在 CI 中浮現，而非僅在開發者的本機執行中出現——代價是每個可信 PR 和合併都會產生真實的（但內部免費的）API 呼叫。preflight 使 secret 設定錯誤變為自我通告而非靜默停用安全網。

該設計帶有已記錄的約束表面：`pull_request` 觸發器在金鑰暴露方面的取捨（刪除它可加強防護）、`if:` 閘門對基於作者的 Dependabot 檢查的相依性，以及對 `pull_request_target` 的嚴格禁止。上方公開倉庫檢查清單是操作配套——未來維護者在更改觸發器集合或切換倉庫可見性之前，應重新閱讀本 Agent Note，而不是從頭推導 fork/secret 模型。

schedule 觸發器在倉庫不活躍 60 天后會自動停用（GitHub 行為）；push/PR/dispatch 是後備，活躍的 monorepo 不會觸及此限制。假設 runner 對 `https://api.deepseek.com` 有出站連通性——GitHub 託管的 `ubuntu-latest` 具備此條件；受出站限制的自託管 runner 需要在相依性每夜執行之前確認連通性。
