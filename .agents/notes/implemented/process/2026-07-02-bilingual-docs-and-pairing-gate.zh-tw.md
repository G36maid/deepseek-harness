# Agent Note: 透過配對兄弟文件與配對閘門實作雙語文件

Status: implemented

[English](2026-07-02-bilingual-docs-and-pairing-gate.md) | [简体中文](2026-07-02-bilingual-docs-and-pairing-gate.zh.md) | 繁體中文

## 問題

本倉庫的文件語料會被公司內外的人和 agent（代理）以中英兩種語言閱讀。在沒有機制的情況下純靠手工維護第二語言，正是譯文腐爛的根源：一側持續演進，另一側默默失實，而沒有閘門能夠發現。對於這類不變式，本倉庫一貫的做法是將其編碼為機械檢查（見[品質閘門](2026-06-11-quality-gates.md)與 [doc-sync（文件同步閘門）強制](../../archived/process/2026-06-11-doc-sync-enforcement.md)），因此雙語政策隨附一道閘門一起交付。

## 決策

- **配對兄弟文件，兩種語言同權。** 一對文件由三個兄弟文件組成：英文 `foo.md`、中文 `foo.zh.md`，以及一份一致性記錄 `foo.i18n.yaml`。沒有哪種語言是正典：一篇文件可以先用中文撰寫和評審、之後再譯成英文，反之亦可；約束配對的是：兩側必須表達相同的內容，且配對整體合併（兩種語言加記錄，絕不單獨落一側）。政策見 [docs/i18n/README.md](../../../../docs/i18n/README.md)；翻譯規則見 [docs/i18n/translation-rules.md](../../../../docs/i18n/translation-rules.md)；術語真源見 [docs/i18n/terminology.md](../../../../docs/i18n/terminology.md)。
- **伴隨記錄保存兩側 blob hash，使一致性可檢查。** `foo.i18n.yaml` 保存兩側文件在上一次確認一致時各自的完整 Git blob hash。此後修改了任一側而未重新確認配對，都能被機械偵測出來（純內容比較，無需查詢歷史），而且同一個 PR（Pull Request）內改動的文件也能計算出 hash，commit hash 式的記錄做不到這一點。重新記錄（`verify-translation-pairing --write <pair>`，要求點名所確認的配對；批次重新記錄是顯式的 `--write --all`）會產生一份可評審的 YAML diff：確認一致在 PR 中是一個顯式、可見的動作。
- **`verify-translation-pairing` 加入 `doc-sync`。** 閘門（[scripts/verify-translation-pairing.ts](../../../../scripts/verify-translation-pairing.ts)）強制執行以下規則：每個已發現且未排除的源文件都有完整配對；每個現有配對都完整（三個文件齊全）且一致（兩側的 hash 均與記錄匹配、中文側和所有人工撰寫的英文源都帶語言切換列而清單內的生成英文源除外、結構簽章一致）；被排除的生成文件、指令文件或本身即雙語的文件不得配對。[scripts/translation-pairing.manifest.json](../../../../scripts/translation-pairing.manifest.json) 只包含顯式排除項，因此任何要求都無法繞過發現流程而接受較弱的檢查。只有當 `.zh.md` 圍欄序列與其無後綴兄弟文件擁有順序相同、正文按位元組一致的同一組受跟蹤圍欄時，面向原始碼的程式碼閘門才會將其作為派生內容消費；不完整、順序變更、重分類或已改動的序列仍會獨立受檢，因此由其所屬的程式碼閘門或配對閘門報告不匹配。
- **全語料統一要求。** 範圍內的每篇文件從建立起就必須有完整配對；政策沒有逐文件推進狀態、日期分界或 README 專用類別。README 發現會覆蓋 vendor 原始碼、相依性目錄與被忽略的建置產物目錄之外所有檔名不區分大小寫匹配 README 的文件，包括今後新增的頂層目錄。發布到文件站的配對使用 `pairedPages()`，由根 locale 投影 `.zh.md`，由 `/en/` 投影 `.md`；僅建立對側檔案並不會發布它。
- **配對記錄是元資料，而不是 Cordis Loader 設定。** Cordis 設定發現會接受實際的 `.cordis.yml` 和 `.cordis.yaml` 文件，同時排除 `*.i18n.yaml`，即使文件名中包含 `cordis` 也不例外。這樣既能繼續校驗可執行的 Loader 設定項，又不會把翻譯 hash 當作設定來解析。
- **翻譯是 agent 的工作，由人評審。** 常規改動採用由[輕量翻譯決策](2026-08-08-lightweight-routine-documentation-translation.md)確立的直接單遍路徑。[擴充翻譯 skill（技能）](../../../skills/dsh-translate-docs/SKILL.md)保留委派翻譯和其他較重機制，供使用者顯式呼叫；兩條路徑均以文件契約為真源。

## 驗證

驗證約定分別覆蓋每個邊界。`verify-translation-pairing` 固定配對完整性、hash、語言切換列和結構；[`project-doc-site.spec.ts`](../../../../scripts/project-doc-site.spec.ts) 固定已發布配對按 locale 選擇對應原始檔；[`cordis-config-files.spec.ts`](../../../../scripts/cordis-config-files.spec.ts) 固定 Loader YAML 的發現以及翻譯記錄的排除；[翻譯提示詞可執行快照](../../../../scripts/translation-prompt.snapshot.ts)則固定渲染後的系統訊息、五對經評審的示例、源請求和所消費的回應。這些檢查共同使配對漂移、發布漂移、設定誤分類和模型可見提示詞漂移都可在評審中看見。

## 曾考慮的替代方案

- **英文為正典源、指紋放在譯文內**：`.zh.md` 文件攜帶一條 HTML 註釋記錄英文源的 blob hash，翻譯只沿 EN → ZH 單向流動。否決：團隊需要中文先行的撰寫方式（先寫、先審中文 Agent Note，再譯英文），兩種語言同權，而單向正典模型無法表達這一點。覆蓋**兩側**的伴隨記錄取代了文件內的單向指紋；blob hash 的機制本身保持不變。
- **語言目錄（`docs/en/` + `docs/zh/`，Kubernetes/ECharts 模式）**：否決。本倉庫沒有將 locale 對映到路由的文件站框架；如果移動所有英文文件，所有既有交叉引用都要隨之修改；且 `verify-md-links`/`verify-doc-refs` 將需要路徑對映邏輯，而非原樣工作。
- **獨立翻譯倉庫（PingCAP `docs`/`docs-cn` 模式）**：否決。適合有獨立發布節奏的文件產品，對 monorepo 自身的文件而言過重；還會把譯文置於本倉庫閘門觸及不到的地方。
- **中英混排單文件（一個文件、兩種語言）**：否決。每個 diff 都翻倍，破壞一段一行約定的 diff 易讀性，且區域性不一致不可見。
- **Commit hash 式記錄（MDN `l10n.sourceCommit` 模式）**：否決，改用 blob hash。同一個 PR 內的改動還沒有 commit hash，MDN 模式無法表達「與本 PR 引入的狀態一致」，且校驗它需要 git 歷史而非文件內容。
- **比較配對兩側的 git 時間戳（無記錄）**：否決。純格式化的改動會誤報，一次無關改動之後提交的對側檔案會漏報；只有內容同一性這個訊號才與閘門的承諾名實相符。

## 業界先例

帶語言後綴的配對兄弟文件是中國大廠的主流約定（ant-design 的 `index.zh-CN.md`/`index.en-US.md`；arco-design 的 `README.zh-CN.md` 加頂部切換行；Apache ShardingSphere 的 387 對 `.cn.md`/`.en.md`），但這些倉庫都沒有在 CI 中**強制**配對或一致性檢查；約定純靠評審維繫。一致性自動化存在於中國以外：MDN 的 `l10n.sourceCommit` front-matter 指紋、Vue 的 Ryu-Cho action（監視上游 commit，為過時譯文自動開 issue/PR）、Kubernetes 的本機化漂移指令碼、微軟 Azure co-op-translator（CI 中由源 hash 驅動程式的 LLM 重譯）。本設計將兩者結合：中文生態的文件版面配置，加上 hash 配對閘門，再加一個由 agent 執行的工作流程替代 bot 服務。

## 後果

- 修改已配對文件的任一側，同一個 PR 就有義務更新對側並重新記錄配對。閘門將 doc-sync 規則雙語化，不變式由 CI（而非評審者的記憶）承載。
- 每個配對給目錄樹多添一個文件。記錄由機器寫入（`--write`），代價是目錄噪音而非維護負擔；換來的是「誰在何時確認過這對文件一致」可以從 yaml 的 git blame 直接回答。
- 兩側說法衝突時，沒有機械規則裁決誰贏，由 PR 評審裁決。這是同權的代價，且是有意接受的：另一個選項（正典語言）會禁止中文先行撰寫。
- 生成的英文文件仍由原始碼派生，並由各自的生成器實施新鮮度閘門。有經評審中文對側的生成頁面遵循三文件配對工作流程，但有一項結構例外：生成的英文原始檔不含語言切換列，因為新增該行會使生成器新鮮度檢查失敗；中文對側仍連結回英文源。沒有經評審對側的生成頁面保留為顯式排除項，並在網站上投影英文。
- 只含排除項的 manifest（中繼資料清單）透過同一路徑，要求當前及今後納入範圍的每篇文件都必須配對。不存在顯式要求、分界或類別條目可以落在發現範圍之外，卻看似已經強制執行。
- 記錄的 hash 兼作更新工具：[gen-translation-brief](2026-07-26-briefed-minimal-translation-updates.md) 會從中還原任一側上次確認的文字並組裝最小更新簡報，因此這套機制從不強迫整篇重譯。
