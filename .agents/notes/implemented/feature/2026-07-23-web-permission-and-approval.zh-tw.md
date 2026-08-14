# Agent Note: Web UI 權限預設與審批應答

Status: implemented

[English](2026-07-23-web-permission-and-approval.md) | [简体中文](2026-07-23-web-permission-and-approval.zh.md) | 繁體中文

## 問題

Web 承載層啟動的是一個不受限的 agent（代理）：`bootHost` 組合了 `dsh-bash-local` 與 `dsh-fs-local`，因此每個 Web 工作階段都以完整文件訪問權限執行，既無審批通道，也無權限管控——而 ACP 組合早在數月前就已交付完整的沙盒化產品路徑（沙盒提供方 + 策略歸屬 + 受限的 shell/fs + 審批 + 預設）。Web 協議約定其實早已預留了對應位置——`approval/requested`/`approval/resolved` 的 mux 幀、攜帶 `ApprovalResponsePayload` 的 `POST /api/respond`、client 側的 `pendingBuffers`——但 host 的 `respond` 只是一個 stub，沒有應答者把 `ctx.approval` 橋接到流上，沒有 RPC 暴露權限選擇，PendingCard 把審批渲染成可見卻無法應答的樣子。

## 決策

Web 承載層組合與 acp-agent 相同的沙盒化產品路徑：`dsh-sandbox-local`、`dsh-sandbox-policy`、`dsh-bash-sandbox`、`dsh-fs-sandbox`、`dsh-user-approval` 與 `dsh-permission-presets`，由 `BootHostOptions.sandbox` 提供部署預設值（`mode`，默認 `workspace-write`；`approvalPolicy`，默認 `ask`）。

`createApiProxy` 擁有審批 pending 登錄檔。它的 `approval/request` waterfall（瀑布式事件）應答者從工作階段剛追加的 `approval/asked` 審計事件中讀取審批 id（沒有審計事件的 ask 屬於外部通道，予以委託），為每個問題 mint 一個穩定的 rpcId，向每個打開的 mux 流廣播可應答的 `approval/requested` 幀，並在每次 mux 打開時原樣重放仍處於 pending 的幀——這正是約定早已承諾的刷新復原基線。`respond` 按回顯的 rpcId 路由，用既有的 zod schema 校驗 `ApprovalResponsePayload`，將載荷的審計關聯與所路由的條目交叉核對，解析應答者，並廣播 `approval/resolved`；ask 的中斷訊號會以 `cancelled` 撤回該問題。

權限選擇依託兩個新的一元 RPC，`session.permissions` 與 `session.setPermission`，把 `ctx.permissionPresets` 投影為一個由協議擁有的 `PermissionOption` DTO（沿用 ACP bridge 的先例：每個協議擁有自己的呈現形狀）。無權限的組合提供空的選擇項，client 隱藏該控制元件。空閒期的切換以後寫勝出（last-write-wins）的方式保存在 proxy 側的 pending map 中，並在 `agent/pre-step` 時沖刷，因為旋鈕事件必須保持輪次內閉合以支持持久重播；共享的 `hasOpenTurn` 摺疊遷入 `dsh-session`，取代了 `dsh-user-approval`、ACP bridge 與 proxy 中各自的私有副本。

在 client 側，`Session` 新增了 `permissions` 與 `setPermission`，審批應答則依託執行時期的 `PendingWait` 載體。按照設計師草稿，處於 pending 的審批會接管 composer：`ApprovalPanel` 註冊為由工作階段聲明的 `conversation.composer` 鏈中一個按選擇器路由的條目（即 ui-user-questions 模式），以理由標題、配對的命令與一次性的拒絕／允許按鈕取代 InputBar；ui-conversation 約定中的 `PendingApproval` 領域面擁有 `ApprovalResponsePayload` 在該載體上的協議編碼（wire encoding），廣播的 resolved 幀使該等待落定並復原 composer。pending 問題透過 ui-user-questions 接管 composer，包括 `plan-review` 決策形狀。側邊欄用一枚優先級高於執行中圓環的琥珀色警示圓點，同步呈現每個被阻塞的互動，搜尋期間也不例外：manager 跟蹤每個工作階段的審批與問題請求標識，而非讀取 Session 實例；它只把滿足 plan-review composer 二元呈現約束的請求分類為計畫審查，並在問題與審批並行時優先呈現第一個 pending 問題，以匹配 composer 路由。實例化前的緩衝會保留每個仍有效的請求標識，替換回放產生的重複項，並移除已解決的請求，因此側邊欄狀態絕不會比可應答的 `PendingWait` 存續得更久；跟蹤以連線代次為單位清除，以保證重開後的重播纔是權威依據。從未實例化過的工作階段仍會點亮該圓點。composer 底行的 chip 經工作階段注入面掛載 `PermissionSelect` 控制元件。連線 fixture（測試前置資料）與 host 保持一致：它的常駐審批可應答一次，其權限選擇項按工作階段持久保存。

## 曾考慮的替代方案

**在 Web 協議上複用 ACP 的 `session/set_config_option` 形狀。** 不予採納：Web 約定的一元方法登錄檔（`RpcMethodMap` + 逐方法的 zod schema）是它自成一體的方言；一個通用的 config-option 介面會為一個選擇項繞開編譯期鎖定的 schema 表。一對專用方法讓兩側都能從簽名推導得出。

**用一個工作階段事件承載 pending 互動，而非即時登錄檔。** 不予採納：可應答請求是瞬態的互動狀態，而非持久的工作階段資料——審批的 `approval/asked`/`decided` 審計對已經記錄了持久的那一半。持久化 requested 幀會在重播時重新問出已經作廢的問題。

**僅在存在 mux 訂閱者時才註冊應答者。** 不予採納：pending 條目必須在 client 斷連後依然存活（刷新復原正是要點所在），因此登錄檔的生命週期長於任何單個流；一個受訂閱者門控的應答者，會讓在重載視窗期間關閉的 ask 落空。

**點擊即樂觀移除卡片。** 不予採納：廣播的 resolved 幀纔是真相；點擊即移除會隱藏一個因拒絕回執或傳輸失敗而仍然懸置的問題。面板改為在本機停用其按鈕，並在失敗時重新啟用。

## 後果

Web 工作階段從受限狀態啟動（默認 `workspace-write` + `ask`），一次沙盒拒絕的升級會以可應答的卡片形式抵達瀏覽器；部署方可以透過 `BootHostOptions.sandbox` 放寬或收緊預設值，無需觸動裝配。問題應答使用同一登錄檔模式（ui-user-questions 基於問題 pending 表），Session 導覽會在使用者打開工作階段前識別審批、計畫審閱與普通問題等待。權限選擇在每次掛載時讀取一次；來自另一個 client 切換的即時刷新暫緩實作。覆蓋率：proxy 登錄檔與權限 RPC 的單元測試套件、工作階段對象與 fixture 的單元測試套件、針對 fixture 模式審批應答與預設切換的無金鑰 Web 冒煙測試，以及真實組合的 plan-review 與問題快照；這些快照會固定 pending 側邊欄狀態直至解決。
