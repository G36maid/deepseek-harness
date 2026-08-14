# Agent Note: 每個包 README 中受閘門保護的「已知限制」章節

Status: implemented

[English](2026-07-10-readme-known-limitations-gate.md) | 繁體中文

## 問題

[文件標準](../../../../docs/AGENTS.md)規定限制項歸屬包 README。沒有統一結構時，章節缺失便無法區分“經審計確認沒有限制”與“忘記編寫文件”，不同的標題還會妨礙全倉庫搜尋。

## 決策

每份位於 `packages/<group>/<pkg>/package.json` 的 manifest（中繼資料清單）都有一個同級 README，其中包含規範的 `## Known Limitations and Deferred Work` 章節。其中的項目符號記錄由該包負責的長期消費端缺口和不明顯的維護者約束；一般清理事項仍留在原始碼 TODO 或所屬 Agent Note 中。[`verify-package-readme-limitations` 閘門](../../../../scripts/verify-package-readme-limitations.ts)從 manifest 推導包集合，拒絕缺失 README，並要求恰好一個規範的 H2 標題，且至少包含一個頂層項目符號。“Limitations”“Deferred”“What is NOT here”或“Non-goals”等近似標題都會失敗。

如果一個包確實沒有需要聲明的限制事項，則將其列入 `NO_LIMITATIONS` 並省略該章節。新增限制事項時須移除該條目；包重新命名或移除後，過時條目會使閘門失敗，因為每個條目都必須對應一個被掃描的包。

閘門檢查存在性、形狀和允許清單。評審依據文件與[行文](../../../skills/dsh-prose-standard/SKILL.md)標準檢查覆蓋面和準確性。常設規則位於 [packages/AGENTS.md](../../../../packages/AGENTS.md)。

## 曾考慮的替代方案

- **自由格式標題**：無法統一搜尋，仍需近似標題偵測。
- **要求空章節或寫 "None."**：樣板文字可能在包新增限制事項後仍然殘留；允許清單使「確實沒有限制事項」這一狀態顯式且可評審。
- **設定詞數上限**：合理的限制事項數量因包而異，因此由評審管控這一不設詞數預算的 README 層級。

## 後果

- 新建的包須聲明符合條件的限制事項，或顯式加入白名單；缺失、漂移或空的章節會在本機和 CI 的 `doc-sync` 中失敗。
- 閘門為 `doc-sync` 新增一個無外部相依性的 TypeScript 指令碼。
- 重新命名受強制的標題需要同時修改指令碼和所有包 README。
