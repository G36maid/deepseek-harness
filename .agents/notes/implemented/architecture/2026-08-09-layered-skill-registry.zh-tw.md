# Agent Note: skill 登錄檔由宿主持有並按 scope 分層

Status: implemented

[English](2026-08-09-layered-skill-registry.md) | 繁體中文

## 問題

agent-preset stack 曾把整個 skill 能力——登錄檔、本機提供方和 `skill` 工具——搬進每個 preset 的 `isolate` realm，理由是"agent 擁有哪些 skill"屬於 agent 平面的選擇。這一框架混淆了兩個不同的問題：*部署*供給哪些 skill，與*agent*是否消費它們。repository 外掛程式的 prepared wrapper 聲明 `inject: ['skills']` 並把它的 skill 根目錄掛載為宿主平面的提供方；web 與 headless profile 不再組合宿主登錄檔後，該 wrapper 永遠等待，repository-plugin e2e 因而掛死，當時透過刪掉 fixture 的 skill 根目錄繞過。按 preset 的 realm 登錄檔還讓閘道的 skill 清單相依性存活 agent——冷工作階段的 `/` 彈出視窗根本沒有登錄檔可讀。

工具登錄檔從未有過這個問題：它是一個宿主單例，基於 `dsh-scope` 按 scope 分層，因此部署級工具（MCP 伺服器、外掛程式 entry）註冊進全域性層，preset 的行註冊進該 preset 的層。

## 決定

`SkillRegistry` 採用同一形態。它持有 `ScopedLayers<SkillLayer>`；`registerProvider()` 與 `register()` 落入呼叫方上下文 scope 對應的層——宿主行與 repository 外掛程式落入全域性層，preset 的 `skill-filesystem`（由常駐組合掛載，其上下文攜帶該 preset 的 scope key）落入該 preset 的層。提供方名稱在每層內唯一而非行程級唯一，這正是讓每個 preset 都能掛載自己的 `local` 提供方的前提。

讀取透過 `SkillViewOptions` 攜帶觀察 scope（呼叫中的 agent，agent 本身就是自己的 scope key）。登錄檔將全域性層與該 scope 的鏈合併：**最近層直接贏得重名，rank 只在單層內裁決重名**——即工具登錄檔的遮蔽規則。曾考慮跨層 rank 合池並予以否決：rank 的設計前提是各來源彼此知情；在全域性池下，後安裝的 repository 外掛程式可能憑註冊順序平手規則靜默頂掉 preset 自帶的同名 skill，遠端改變 preset 的行為。最近層優先讓組合的行為由其作者決定。

發現快取以解析後的 scope 鏈加一個修訂計數為鍵，因此空工作階段重組——只重設 agent scope key 的父級、不觸碰登錄檔——對下一次讀取立即可見。

組合隨之調整：web-app bundle 重新啟用 base 的 `skill` 登錄檔行（只有 `skill-filesystem` 與 `tool-skill` 仍歸 preset），preset 組合拆掉 `isolate: skills` realm，改為直接落在宿主登錄檔上的平鋪行。閘道的 skills 域以 presenter scope 讀取宿主登錄檔——存活 agent，否則記錄在案的 preset 的 standing key——冷工作階段由此列出其組合真正供給的目錄而不再報錯；`serviceFor` 分支保留，相容仍以 realm 自掛登錄檔的組合。

## 影響

**部署級 skill 會到達每個掛載 `tool-skill` 的 preset 工作階段。**repository-plugin e2e 的 skill 根目錄與斷言已復原；shipped-Web e2e 證明 badge 行（同一種宿主註冊形態）匯入 standard preset agent 的目錄，而宿主檢視表保持僅全域性。

**層可見性與消費仍是兩個獨立選擇。** `minimal` agent 原則上可讀全域性層，但不組合 `skill` 工具——agent 是否擁有 skill 依舊由 preset 透過掛載或省略 `tool-skill` 決定。

**提供方選項仍是借用的呼叫方對象。**`SkillViewOptions` 擴充 `SkillLookupOptions`；登錄檔消費 `scope`，提供方只從同一個只讀對象中讀取自己的契約，保持既有的借用恆等保證。

**TUI profile 不受影響。**所有行都在宿主時只有一個（全域性）層，合併檢視表等於舊的單登錄檔檢視表，rank 行為不變。

**跨層遮蔽是靜默的。**層內敗者照舊記錄日誌；較近層頂替較遠層的名稱沿用工具登錄檔的慣例，不記錄。登錄檔仍不提供檢查被遮蔽定義的 API。

## 曾考慮的替代方案

**跨全部可見層的 rank 合池。**忠實於單登錄檔的優先級，但跨層平手按註冊順序裁決（啟動期提供方永遠贏過常駐掛載），preset 自帶 skill 可能被它看不見的部署變更頂掉。因組合穩定性否決；見"決定"。

**保留按 preset 的 realm 登錄檔，把 repository skill 作為目錄交給 preset 的提供方掃描。**wrapper 的 `inject: ['skills']` 契約仍然破損（或者按 profile 分叉 wrapper），發現設定在每個 preset 裡重複，冷工作階段依舊無處可讀。否決。
