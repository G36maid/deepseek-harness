# 事後檢討（postmortem）

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

事後檢討記錄的是：一個 bug 出現在了不該出現的地方（真實使用者、已合併的 PR（Pull Request）、已發布的版本），值得關注的是*為什麼我們的流程放過了它*，而不僅僅是那一行修復。

事後檢討不是 [Agent Note](../../.agents/notes/README.md)（Agent Note 記錄一個經過深思熟慮的設計決策及其被否決的替代方案，或提出未來工作）。它是一份回顧性的失敗記錄：什麼壞了、機制是什麼、為什麼每道安全網都沒攔住、以及為此新增了哪些具體防護措施，以確保同類 bug 下次出現時會明確報錯。

當一個 bug 滿足以下條件時，請撰寫事後檢討：**隱蔽**（機制不顯而易見，即使是細心的工程師也得費力重新推導）、**系統性**（逃逸的原因是測試、工具、約定的缺口，而非一次性的筆誤）、**重新發現的代價高**（它消耗了真實的除錯時間，且下次還會如此）。請連結該事後檢討所推動建立的防護措施（測試、AGENTS.md 規則、ADR）。

每篇事後檢討以一段**執行摘要**開頭：一個簡短段落，讓忙碌的讀者在三十秒內吸收要點——什麼壞了、用直白的話說根因是什麼、為什麼逃逸了、可長期沿用的教訓是什麼——然後纔是後續的詳細「概述、時間線、根因、防護措施」各節。

| # | 標題 |
|---|---|
| [0001](0001-acp-default-export-drops-inject.md) | ACP（Agent Client Protocol）伺服器在連線時崩潰：`export default` 丟失了外掛程式的 `inject` |
| [0002](0002-js-expression-disabled-filesystem-tools.md) | 檔案系統快照工具被一個字面量 `!!js` 對象永久停用 |
| [0003](0003-web-agent-gui-feedback-loop.md) | Web agent（代理）驗證了替代伺服器，而非承載其工作階段的 GUI |
| [0004](0004-landlock-partial-notice-misclassified-child-failures.md) | Landlock 部分強制執行通知導致子行程失敗被誤歸類 |
