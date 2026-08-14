# Agent Note: GUI 測試體系——三層結構

Status: implemented

> 路徑更新（2026-07-22，外掛程式體系重構）：本文三層理念與黃金路徑方法仍為現行；家搬了——對象層 spec 現居 `packages/client/runtime/tests/`（原 web-runtime）、wire spec 現居 `packages/client/connection/tests/`，`web-ui` 覆蓋豁免隨包消亡（元件 spec 為各 `packages/client/*/tests/` 的 jsdom 套件）。元件 spec 形態遵循 [slot 體系標準](../architecture/2026-07-22-slot-type-chain-implementation.md)：props 直喂——store 份額來自 `createXXXStore().create()`（真引擎，獲認可的無額外機制路徑），框架掛鉤用普通樁；無渲染機制、不掛載提供方。slot 歸屬/登錄檔語義歸 2 層地界（`runtime` + `ui-slots` 套件），不歸元件 spec。

[English](2026-07-20-gui-testing-system.md) | [简体中文](2026-07-20-gui-testing-system.zh.md) | 繁體中文

> 分工線：本篇只講 GUI（`packages/{client,host}/*` + `apps/web`）特有的測試結構；全倉測試政策（分層原則、with-key 政策、真實實作優先、REAL-composition）見 [docs/testing.md](../../../../docs/testing.md)，不在此複述。

## Problem

GUI 棧需要考慮多種應用形態，同應用形態內的不同執行環境（Node host、資料協議層、瀏覽器對象層、React/DOM），單一車道的測試給不了有效訊號。需要對各環節都進行有效測試，並具備全鏈路測試的基礎能力。

## Decision

沿架構天然的測試掛鉤切分為三層，自底向上：

| 層 | 被測物 | 關鍵手段 | 文件落點 |
|---|---|---|---|
| 1 協議同構層 | `AbstractApiClient` + `toFetchHandler`（雙向資料/rpcId/ZOD 類型/SSE（Server-Sent Events）流/合批/逾時） | **同構點全鏈**：`InProcessApiClient(toFetchHandler(脚本化 impl))` 不過網路但真跑 wire 序列化——零瀏覽器、純 node env | `packages/host/apiproxy/tests/client-handler.spec.ts` |
| 2 對象層編排 | `Session`/`SessionManager`/`ConnectionController`（狀態機與時序：縫合/去重/翻頁/樂觀清稿/pendingBuffers/重連/退避） | **「事件序列進→快照出」黃金路徑**：可程式設計假體 + deferred 控時序 + fake timers 控退避 | `packages/client/{runtime,connection}/tests/` |
| 3 組裝呈現層 | 建置產物 × 真實 client loader 與外掛程式組合 | 歸應用所有的語義快照會在 jsdom 下啟動全部 8 個已建置的 client 外掛程式，以確定性方式驅動程式跨外掛程式狀態變化；另有最簡 Playwright 冒煙測試負責驗證真實瀏覽器/承載層邊界，真 host 用例在無金鑰時自行跳過；無金鑰瀏覽器 e2e 車道會停用交付設定中的模型配接器行，並透過 `dsh-llm-replay` 在真實行程內 web 組裝中重播錄制的工作階段 fixture（測試前置資料），與工作階段區 aria 預期輸出比對（[web e2e 車道](../testing/2026-07-24-web-gui-browser-e2e-lane.md)、[必需 CI 閘門](../testing/2026-07-30-web-browser-snapshot-ci-gate.md)） | `apps/web/tests/*.snapshot.ts`、`apps/web/tests/smoke-{fixture,real}.e2e.ts`、`apps/web/tests/{replay-round-trip,seeded-history}.e2e.ts` |

層間紀律：**各層各測各的，上層不重測下層**：應用語義快照只固定組裝後外掛程式邊界上的使用者可見投影，Playwright 冒煙測試負責驗證瀏覽器與承載層是否存活；wire 語義歸 1 層，資料語義歸 2 層。純函式層（lineage/partial/notifier/transcript-adapter）隨 2 層同包 tests/ 零假體直測。

- **host 與 client 原始碼**均納入全倉 per-file 100% 覆蓋率閘門，僅排除 `vitest.config.ts` 中帶註釋的少量瀏覽器級例外；元件套件透過逐文件 jsdom pragma 和 Testing Library 執行，不會改變 Node 套件。
- **歸應用所有的語義快照**讀取已建置的 client bundle，透過真實 loader 執行它們，並且只驅動程式確定性的 fixture 掛鉤。它們負責固定側邊欄標籤、麵包屑導覽和 `document.title` 等穩定可見狀態，而不固定 CSS 畫素或下層狀態機細節。

## 車道地圖

| 場景 | 命令 | 內容 | 何時跑 |
|---|---|---|---|
| 基礎 | `pnpm run test:gui` | 1+2 層 vitest（`packages/client packages/host`），秒級、無瀏覽器、無 server | 改 GUI 任意原始碼後隨手跑 |
| 語義快照 | `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot` | 無需金鑰的組裝應用語義，以及倉庫按傳輸形態劃分的預期輸出 | 使用者可見的 GUI 變更後；交付前 |
| 瀏覽器端到端 | `pnpm run test:web` | 先重建前端 dist，再跑 3 層瀏覽器全集：雙級冒煙測試（fixture 級 + 真 host 級 self-skip）加上無金鑰重播 e2e 場景（`DSH_SNAPSHOT=record`/`refresh` 重錄 fixture / 重寫期望輸出） | 改建置面/boot/承載後；交付前 |
| 瀏覽器預期輸出閘門 | `DSH_SNAPSHOT=replay pnpm run test:web:built` | 複用 CI 建置的產物，並在不寫入的情況下比較每份已提交的瀏覽器預期輸出 | 每個 Linux Pull Request |
| 閘門 | `pnpm run test:coverage` | 全倉閘門（host 與 client GUI 包均納入，僅排除帶註釋的瀏覽器級例外） | PR（Pull Request）視窗 |

**瀏覽器指令碼與 vitest 的分工**：Playwright 負責瀏覽器/承載層黑盒回歸和較長的連續使用者操作流程；普通 vitest 負責引用穩定性、時序和 wire 結構等資料層語義；快照 vitest 透過建置後的組合負責穩定的應用層語義輸出。這些車道彼此互補，而不重複斷言。

## 防回歸紀律

- **修一個 bug 釘一條斷言**：瀏覽器可見的 bug 釘進所屬瀏覽器 spec（冒煙測試或 e2e 場景）；資料層 bug 釘進對應 spec（先例：res-close 誤判釘在 webserver 橋 suite——純 Node 秒級復現，不再需要 12s 瀏覽器哨兵作唯一防線）。
- **fixture 全綠不算完，真 wire 也要過**：fixture 短路的恰是 wire 承載鏈（node:http 橋 close 語義、真網路時序），兩次實證 bug 都藏在那裡。改動觸及連線/橋/handler/SSE 的，瀏覽器車道（`pnpm run test:web`）必跑——其無金鑰 e2e 場景驅動程式真實 HTTP/SSE 承載，帶金鑰的真 host 冒煙測試仍是真模型側的補充。
- 落盤程式碼即答案的對表工作流程：行為改動落盤打紅既有用例時，當場對表校準（改測試還是改程式碼以 RFC/約定為裁），不留懸紅。

## Consequences

各車道各測各層：改動任意 GUI 原始碼後都能獲得秒級 `test:gui` 回饋，wire/對象層語義在 Node 環境中進行毫秒級斷言，基於建置後組合的快照固定確定性的使用者可見投影，瀏覽器負責接線與承載層驗收。層間紀律仍由評審負責，而 Linux CI 透過機器閘門確保瀏覽器預期輸出的新鮮度。每個新的應用快照都必須避開不穩定的版面配置或時鐘輸出。

## Alternatives considered

| 放棄項 | 一句話理由 |
|---|---|
| 單一 e2e（全走瀏覽器） | 瀏覽器起步秒級×N 倍慢+時序不可控；wire/對象層不變數在 node env 可毫秒級全斷言 |
| verify 指令碼遷 vitest | 有序指令碼共享瀏覽器工作階段，拆 case 要麼形式化（sequential+共享 page）要麼重走前置×N；PASS/FAIL 流式輸出正是 agent（代理）定位介面 |
| 測試複用 FixtureApiClient | 演示指令碼走真實時鐘，測試需要 deferred 手控時序——用途正交，硬複用把測試綁死在演示節奏上 |
| GUI 包獨立 vitest config（曾設計 vitest.gui.config.ts） | 包級 tests/ 本就被根 include 掃到，`vitest run packages/client packages/host` 路徑過濾即窄迴圈——零新 config |
| 掛鉤/元件層暫緩單測 | jsdom 仍是覆蓋率主線，因為它能快速驗證逐文件元件行為；必需的瀏覽器重播閘門在組裝層與之互補，而非取代它（[CI 閘門決策](../testing/2026-07-30-web-browser-snapshot-ci-gate.md)） |
