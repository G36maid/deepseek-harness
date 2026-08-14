# Agent Note: 按實測聚類重新劃分 packages/ 分組

Status: implemented

[English](2026-07-29-package-regrouping.md) | [简体中文](2026-07-29-package-regrouping.zh.md) | 繁體中文

## 問題

兩級 `packages/<group>/<pkg>` 層級結構（[原始決策](../../archived/architecture/2026-06-20-package-hierarchy.md)）自 6 月以來已經漂移：167 個包彼時坐落在 42 個組裡，若干組邊界已經對不上這些包的實際聚類。

- `ui/` 混雜了四個互不相關的平面：人類終端機通道（`tui`）、SDK 的 JSON-RPC 伺服器端一半（`jsonrpc`，它對 `dsh-sdk-protocol` 的對等相依性（peer dependency）把它綁在 SDK 通訊棧上）、人機互動 seam（`user-questions`、`user-approval`、`permission`、`tool-ask-user`、`commands`），以及與通道無關的 boot 膠水（`app-boot`）。它自己的 README 只能逐一敘述這堆混雜，說不出一個統一職責。
- 工作階段家族被割裂在五個組裡——`session-persistence/`、`session-projection/`、`session-query/`、`session-title/` 與 `telemetry/`——而實測相依性邊明明把它們連成一體（query → persistence、title → projection、projection → persistence；見 [docs/module-graph.md](../../../../docs/module-graph.md)）。
- 用於工具呼叫守衛的 `timeout/` 組與通用 promise 工具 `util/timeout` 撞名。
- `cordis/` 拿所有包共同依託的框架給自己的組命名，這個名字因此毫無區分度；組裡唯一的包 `tool-cordis` 是執行時期自我修改工具集。

這次重新分組的指導準則：**聚類緊密的包同處一組。**聚類以實測為準（對等相依性邊與 co-change），而非按主題歸類。孤立的 seam 家族可以自成一個小組；要避免的失敗形態，是名字概括不出單一職責的大雜燴組。

## 決策

五項重組決策仍然有效；其餘每個組都保持先前的邊界與內容不變（相依性分析確認各能力家族——`shell/`、`terminal/`、`code-runtime/`、`sandbox/`、`subprocess/`、`fs/`、`lsp/`、`web/`、`skill/` 及其餘——本來就劃得正確）。原本的第六項決策把 SDK 項目初始化器、啟動器工具與執行時期 JSON-RPC 包匯集到 `scaffold/`；[移除這套未發布工具鏈](../simplification/2026-08-11-remove-sdk-project-toolchain.md)的決策刪除了項目工具，並將存留的執行時期三包移到 `sdk/`。後續的[倉庫命名約定](2026-08-11-repository-naming-contract-and-rename-ledger.md)負責 `shell/`、`terminal/` 與 `extensions/` 組名，以及本決策曾推遲的兩個包名。

| 組 | 成員（目錄名） | 來源 |
|---|---|---|
| `session/` | session-persistence、session-persistence-jsonl、session-persistence-sqlite、session-checkpoint-policy、session-projection、session-projection-cache、session-title、session-title-llm、session-title-first-prompt-llm、session-title-all-prompts-llm、session-telemetry、session-telemetry-otel | `session-persistence/` + `session-projection/` + `session-title/` + `telemetry/` |
| `interaction/` | user-questions、user-approval、permission-presets、tool-ask-user、commands、tui | `ui/` |
| `boot/` | app-boot | `ui/` |
| `guard/` | repeat-tool-reminder、timeout-policy | `guard/` + `timeout/` |
| `extensions/` | tool-cordis | `cordis/` |

- **`session/`** 是持久工作階段資料平面：持久化 seam 連同其各後端與檢查點策略、從該日誌摺疊（fold）出全量值並對外提供的投影、基於日誌的標題，以及 OTel 上報。標題摺疊本身就是讀取側的承重構件（`session-query` 對 `dsh-session-title` 聲明對等相依性），所以標題屬於資料平面，而非某個「派生服務」附屬區。用這個樸素的名字是有意為之（名字要像人起的）；旁邊的 `core/session` 包仍是常駐記憶體的即時服務，本組則是圍繞它的持久家族。`session-query/` 保持獨立成組：這個讀取／工具面自帶模型工具和 SQLite FTS 後端，其消費不相依性持久化內部實作。
- **`interaction/`** 是人機協作平面加上應答它的終端機通道：提問／批准 seam、權限預設、面向模型的 `ask_user_question` 工具、人類命令登錄檔（`plan-mode` 與 `command-goal` 已經把 `commands` 和各互動 seam 放在一起消費），以及 `tui`——這個互動通道是該平面功能最豐富的提供方與消費端（對 `commands` 與 `user-questions` 均有對等相依性邊），而一個單包 `tui/` 組會把一個頂層名字花在一個外掛程式上。
- **`boot/`** 是角色完備的單包組：不歸屬任何通道也不歸屬任何組裝的共享 bin boot 膠水（被 `apps/cli` 與 `examples/` 各演示 bin 消費）。
- **`guard/`** 保留其文件記載的角色（迴圈衛生守衛），並新納入強制執行工具呼叫逾時的包；那個與 `util/timeout` 撞名的單包組 `timeout/` 隨之解散。
- **`extensions/`** 把 `cordis/` 遮蔽掉的角色說了出來：它是供 agent（代理）在自身當前執行時期中檢查和掛載外掛程式的工具集，也是未來自我修改類包的落點。

42 個組變為 39 個；收益在聚類正確與名實相符，不在數量增減。

## 後續命名決策

[倉庫命名約定](2026-08-11-repository-naming-contract-and-rename-ledger.md)解決了本次移動有意推遲的兩個名稱。`@deepseek-ai/dsh-sdk-jsonrpc-server` 表示執行時期 SDK 協議的 JSON-RPC 伺服器一側。`@deepseek-ai/dsh-tool-call-timeout-policy` 準確表示策略所限制的操作，同時保留其 `guard/timeout-policy/` 歸屬。這些重新命名會一並移除阻塞發布的 `FIXME` 標記。

## 移動觸及了什麼

移動以純 `git mv` 形式落地，歷史由重新命名偵測承載。組移動觸及了：被移動包的 `tsconfig.json` 相對 `references` 及每個相依性方的對應條目（含 `apps/cli` 的 project references）；tsconfig 聚合與路徑對映；各組 README；[packages/README.md](../../../../packages/README.md) 的層級結構表；根 `AGENTS.md` 的版面配置圖；重新生成的產物（`docs/module-graph.md`、內嵌路徑的目錄以及鎖定檔的 importer 鍵）；以及散文與閘門指令碼中以倉庫根為基準的 `packages/...` 引用。其餘每一處組路徑引用（workspace 設定、測試 glob、lint 鍵）都由驗收閘門的響亮失敗機械地找了出來——這正是本倉庫自己的「設定錯誤必須響亮失敗」規則。

組移動未觸及：npm 包名、import、`cordis.yml` 設定、快照 fixture（測試前置資料）、`pnpm-workspace.yaml` 與 `tsdown` 的 glob（都是 `packages/*/*`），以及 Python 執行時期 manifest（中繼資料清單）——它們全部按 npm 包名引用包。

`client/` 與 `host/` 不在本次範圍內，保持不變。

## 曾考慮的替代方案

**粗粒度領域桶**（`exec/` = subprocess+sandbox+bash+pty+code-runtime，`workspace/` = fs+lsp+workspace，`orchestration/` = subagent+workflow+tasks，`knowledge/` = web+skill，`collab/` = plan+todo+goal；約 16 個組）。不予採納：實測相依性圖與這些合併相矛盾。`sandbox` 和 `subprocess` 是被各家族跨界消費的共享基礎設施（與 bash ×5、fs ×5、pty、lsp、mcp 及 subagent 均有相依性邊），`web` ↔ `skill` 之間零相依性邊，而大桶只會在更大尺度上覆現 `ui/` 式大雜燴。

**抽象分層名**（`capability/`、`policy/`、`extension/`、`provider/`）。不予採納：這些名字對每個外掛程式都同樣地不達意，而且一個 `capability/` 桶會裝下約 50 個包。

**一輪全量 npm 重新命名**（每個包都改為 `dsh-<group>-<pkg>`）。不予採納：npm 包名是扁平的，加組前綴只會在 import、設定和 fixture 之間製造改動，卻換不來任何消歧收益；用 FIXME 跟蹤的定點改名足以覆蓋真正的撞名。

**在重組內部一並完成推遲的改名。** 不予採納：改名會成倍放大開放 PR 的衝突，並破壞純移動的評審屬性。剩餘的 FIXME 標記讓這些改名保持為可見的發布阻塞項，留待以小型後續 PR 逐一解決。

**工作階段兩分法**（`session-core/` + `session-utils/`）。不予採納：query 放哪一側都不乾淨，而且 `session-core` 容易與 `core/session` 混淆（後者是 `dsh-session`，常駐記憶體的即時服務，留在 `core/` 不動）。

**工作階段三分法**（`session-store/` + `session-query/` + `session-utils/`）。不予採納：`session-utils/` 是靠否定條件圈出來的附屬區（「派生的、沒有任何承重構件相依性它」）——正是指導準則禁止的大雜燴形態，而且事實層面也站不住（`session-query` 對 `dsh-session-title` 聲明對等相依性）。杜撰的複合名也讀起來不像人起的；一個樸素的 `session/` 組說的就是人會說的話。query 無論如何都保持獨立：它是被獨立消費的讀取面，自帶自己的工具包與後端。

**把 `ui/` 重組為單一 `channels/` 組**（tui + jsonrpc + acp + 互動 seam + boot）。不予採納：不過是換個名字的同一個大雜燴——這些包服務於四個平面，`jsonrpc` 的實測聚類歸屬是 SDK 通訊棧，而 `acp/` 是自動化傳輸通道，不是人類通道。

**獨立的單包 `tui/` 組。** 不予採納：`tui` 是互動平面的主要提供方／消費端（對 `commands`、`user-questions` 有對等相依性邊），把一個頂層名字花在一個外掛程式上只添組不添資訊；它折入 `interaction/`。

**把 `app-boot` 挪到 `apps/`。** 不予採納：`apps/` 是包層之上的組裝層，而 `dsh-app-boot` 是包層的庫——放進 `apps/` 會顛倒層級，並把一個 workspace 庫放到 `packages/*/*` 建置 glob 之外。它仍是一個包；`boot/` 是它角色完備的家。

**把 `tool-cordis` 挪進 `core/`。** 不予採納：自我修改是獨立的產品 seam，預期還會生長；主幹保持精簡。該組最初命名為 `self-evolve/`；名字最終定為更樸素的 `extensions/`。

**把 `context/` 改名為 `request-context/`。** 不予採納：在這棵樹裡，該組就地看並無歧義；這份改動開銷並不值得。

## 後果

- 五個仍然有效的重組家族持有所列成員；`ui/`、`telemetry/`、`timeout/`、`cordis/`、`session-persistence/`、`session-projection/`、`session-title/` 這些組不復存在。重組本身沒有更改 npm 名。後續移除 SDK 工具鏈的決策有意改變包集合，並復原 `sdk/` 作為執行時期 SDK 三包的精確歸屬。兩條 FIXME 標記釘住剩餘的推遲改名；日後若某條 FIXME 被證明不對，必須連同理由顯式移除，絕不允許無聲消失。
- 結果由以下檢查釘住：`pnpm run typecheck`、每個被移動組的單元測試套件、`verify-package-paths`、`verify-md-links` 與全語料翻譯配對在移動後的樹上全部透過；`vitest.snapshot.config.ts` 中按組劃定的測試 glob 隨移動一並改寫，套件收集到與移動前相同的測試文件（glob 匹配為空會無聲地丟失覆蓋）。
- 每個觸碰被移動文件的開放 PR 都跨過這次移動做一次變基；重新命名偵測可機械化解決大多數改動塊。
- 單包組依然存在（`boot/`、`extensions/`，以及 `acp/` 等既有單包組）。這是有意接受的：每個都是角色完備的整體而非某個家族的碎片，一個名實相符的小組勝過一次徒有其名的合併。
- `sdk/` 的角色目錄在 `tsconfig.base.json` 中顯式對映到各自的 npm 名；在 `dsh-sdk-jsonrpc-server` 完成改名之前，`server/` 的對映仍是過渡性的。
- **這次變更放棄了什麼：** 功能上一無所失——變更只關乎導覽。肌肉記憶和指向舊 GitHub 路徑的外部連結會失效；在 pre-release、尚無外部消費端的前提下，這可以接受。
