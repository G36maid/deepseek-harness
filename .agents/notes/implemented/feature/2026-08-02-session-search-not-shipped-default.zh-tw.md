# Agent Note: 工作階段搜尋工具不是交付默認項

Status: implemented

[English](2026-08-02-session-search-not-shipped-default.md) | [简体中文](2026-08-02-session-search-not-shipped-default.zh.md) | 繁體中文

## 問題

[交付清單決策](2026-07-31-even-out-shipped-tool-rosters.md)把 `tool-session-query` 設為共享 [`cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml) 的默認行，於是交付的 TUI 與 Web surface 把這五個工作階段搜尋工具（`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read`）呈現給了模型。這與[面向模型的工作階段查詢工具決策](2026-07-24-model-facing-session-query-tools.md)相牴觸，該決策持需顯式啟用的立場，包 README 將其記錄為「shipped host compositions do not mount it by default」。這項預設設定還交付了一個提示詞段，向模型講授一套既往工作搜尋工作流程，而沒有任何使用者要求過。

## 決策

交付的 TUI、Web 與無頭 surface 均不掛載 `@deepseek-ai/dsh-tool-session-query`，交付的 agent preset 也都不包含它。該消費端仍保持 opt-in，與面向模型的工作階段查詢工具決策所述完全一致：ACP（Agent Client Protocol）示例的 [`session-query.cordis.yml`](../../../../examples/acp-agent/session-query.cordis.yml) 及其快照對側檔案仍是掛載參考，自訂組合也可以連同逾時與 spill 策略一起掛載該包。

`ctx.sessionQuery` 服務本身保持掛載。`session-query-sqlite` 仍是 base 的一行，TUI 的 `session-reference` 消費它來實作 `/resume`；其全文索引預設關閉（`openAt: never`，見[內容搜尋 opt-in 決策](../architecture/2026-08-13-session-content-search-opt-in.md)），Web overlay 保留記憶體索引取值，供啟用內容搜尋的部署使用。被移除的只有面向模型的消費端。

## 曾考慮的替代方案

- **把 `session-query-sqlite` 索引也一並移除**——否決，因為 `/resume` 和 Web 內容搜尋框直接消費 `ctx.sessionQuery`；它們是宿主功能，不是模型工具，移除提供方會破壞它們。
- **保留該行，但在每個 overlay 中停用它**——否決，因為一條被停用的 base 行仍會交付相依性，而且一行就能輕易重新啟用；已記錄的 opt-in 立場要求消費端不出現在交付的 surface 上，以 ACP 示例作為掛載參考。
- **只在 TUI 上掛載**——否決，因為共享 base 是所有 surface 共用的一組行；surface 專屬掛載會重新引入交付清單決策所消除的清單分裂。

## 後果

兩個 surface 都回到同樣的二十個無條件工具（ripgrep 可用時再加上 `glob`/`grep`），五個工作階段搜尋 schema 及其提示詞段也一並退出默認請求。兩個 surface 上的交付組合測試都固定這份更小的目錄，因此把工作階段搜尋重新作為默認加回會觸及同樣的測試。想要工作階段搜尋的使用者從個人 overlay 或 ACP 示例掛載該消費端，並在掛載處新增相依性。
