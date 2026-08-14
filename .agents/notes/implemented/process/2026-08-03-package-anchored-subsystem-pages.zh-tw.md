# Agent Note: 按包錨定的子系統頁面與精簡的分組 README

Status: implemented

[English](2026-08-03-package-anchored-subsystem-pages.md) | [简体中文](2026-08-03-package-anchored-subsystem-pages.zh.md) | 繁體中文

## 問題

[子系統目錄](2026-06-20-core-data-structures-catalog.md)最初用主幹-vs-seam 規則界定首頁範圍：如果迴圈在每個輪次都持有、派生、流式傳輸或記錄某個類型，它就是「核心」。該規則選擇的是類型而非包，因此當目錄成長到四十多頁後，首頁變成了跨包大雜燴：LLM（大型語言模型）對話詞彙排在 agent（代理）約定之前，建立/所有權詞彙（`AgentHandle`、`CreateAgentOptions`、`ResumeAgentOptions`、`AgentFactory`）在目錄中無處記錄（生成器把它們豁免給了某個包 README），讀者無法根據類型所在位置預測哪一頁記錄它。與此同時，各包分組 README 沒有統一形狀——有的帶分節表格、遊離的設計短文，或本應屬於子系統頁面的尾部段落。

## 決策

每個 `docs/subsystems/` 頁面錨定到聲明其詞彙的包或包分組，頁面歸屬跟隨倉庫版面配置：[core.md](../../../../docs/subsystems/core.md) 是 `packages/core` 的頁面（建立與所有權、`Agent` 控制代碼及其投遞/取消/攔截約定、指向該組專屬頁面的連結），[llm-streaming.md](../../../../docs/subsystems/llm-streaming.md) 完整涵蓋 `packages/llm`，依此類推。全倉通用類型模式（`…Map → 派生联合`、品牌化 id）保留在 core.md 一個明確標注的收尾小節中，而不是與包內容交錯。這在*頁面範圍界定規則*的意義上取代了主幹-vs-seam 規則；存活下來的放置啟發式更簡單：類型記錄在其聲明包對應的頁面，相關實作機制仍集中記錄在其所屬頁面。

生成簽名引用的每個類型都必須能在目錄中某處解析：agent 所有權詞彙從生成器的 `TYPE_LINK_EXEMPTIONS` 移入 `LINK_MAP → core.md`，因此豁免只留給確實僅用於服務內部或來自 vendored 程式碼的類型結構。每個貼上的聲明只有一個家（`SessionEvent` 位於 [session.md](../../../../docs/subsystems/session.md)；core.md 概括並連結）。

每個 `packages/<group>/README.md` 配對都是統一形狀的精簡入口：一段先說明「為什麼」的介紹、一張包表格（包 / 角色 / ctx 鍵）、一個指向對應子系統頁面的收尾連結。如果承載關鍵資訊的正文超出這一結構所能容納的範圍，就將其遷移到對應的子系統頁面，而非刪除。

[子系統 README](../../../../docs/subsystems/README.md) 在中英文兩側索引目錄中的每一頁；`scripts/project-doc-site.spec.ts` 強制每個頁面對應一個表格行，因此後續 PR 新增（或合併吸收）的頁面無法悄悄缺席索引。

## 考慮過的替代方案

**保留主幹-vs-子系統界定規則。**它逐類型回答「這個類型是核心嗎？」，這正是首頁積累了四個包的類型、卻缺失 `packages/core/agent` 一半公開介面的原因。按倉庫版面配置進行預測的方案勝出。

**扁平的單文件目錄。**在[原目錄 Agent Note](2026-06-20-core-data-structures-catalog.md) 中已被否決；成長到四十一頁證實了該結論。

**只在包 README 中記錄所有權詞彙（豁免的現狀）。**這讓 `AgentHandle` 與建立/復原選項在自稱類型參考的目錄中不可見，生成的 `Types:` 頁腳也無法連結它們。

## 後果

- 哪一頁記錄某類型可由 `packages/<group>/` 預測；子系統 README 是由測試強制的完整索引。
- 生成的簽名頁腳連結 agent 所有權詞彙，而不是靜默豁免。
- `verify-type-equiv` 的 1:1 manifest（中繼資料清單）保證每個貼上單一歸屬；重複的 `SessionEvent` 貼上已移除。
- [原目錄 Agent Note](2026-06-20-core-data-structures-catalog.md) 仍擁有 `ts type-equiv` 漂移閘門機制；此處僅取代其頁面範圍界定規則。
