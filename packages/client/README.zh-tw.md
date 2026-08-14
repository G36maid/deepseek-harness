# client/ — web GUI 瀏覽器端

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

dsh web GUI 的瀏覽器側：shell 啟動、瀏覽器與宿主通訊、共享 UI 服務和功能外掛程式。編寫規則見 [AGENTS.md](AGENTS.md)；宿主半側是 [`host/`](../host/README.md)。除 `test-runtime` 外，均為名為 `@deepseek-ai/dsh-client-<name>` 的**產品**包。

| 包 | 目的 |
|---|---|
| [`web/`](web/README.md) | 從用戶端條目圖啟動瀏覽器 shell。 |
| [`modules/`](modules/README.md) | 載入瀏覽器側用戶端模組。 |
| [`web-react/`](web-react/README.md) | 連線 shell 執行時期與 React 渲染。 |
| [`connection/`](connection/README.md) | 維護瀏覽器與宿主之間的 RPC 通訊和事件傳遞。 |
| [`runtime/`](runtime/README.md) | 為工作階段、工作區和 UI 組合提供共享用戶端服務。 |
| [`hmr/`](hmr/README.md) | 在開發期間刷新用戶端外掛程式。 |
| [`locale/`](locale/README.md) | 提供本機化偏好與訊息詞典。 |
| [`schema-form/`](schema-form/README.md) | 為設定編輯器提供 schema 驅動的草稿處理。 |
| [`test-runtime/`](../test-support/client-runtime/README.md) | 為用戶端功能包提供共享的倉庫測試支持。 |
| [`ui-slots/`](ui-slots/README.md) | 定義 UI 功能註冊和組合擴充 slot 的方式。 |
| [`ui-theme/`](ui-theme/README.md) | 應用所選顏色主題。 |
| [`ui-primitives/`](ui-primitives/README.md) | 提供共享 React 控制元件、圖示和內容渲染器。 |
| [`ui-attachment/`](ui-attachment/README.md) | 提供附件展示原子元件：草稿圖片欄、訊息畫廊與燈箱。 |
| [`ui-layout/`](ui-layout/README.md) | 排列應用的主要區域。 |
| [`ui-sidebar/`](ui-sidebar/README.md) | 展示工作區與工作階段導覽。 |
| [`ui-workspace/`](ui-workspace/README.md) | 提供工作區選擇與建立介面。 |
| [`ui-conversation/`](ui-conversation/README.md) | 展示當前對話及其輸入介面。 |
| [`ui-tool/`](ui-tool/README.md) | 編排工具呼叫樹和按工具鍵控的檢視表。 |
| [`ui-workflow-run/`](ui-workflow-run/README.md) | 把持久工作流程執行重播為 Chat 巢狀摺疊項，並只為即時子 Session 提供導覽。 |
| [`ui-goal/`](ui-goal/README.md) | 展示和管理當前目標。 |
| [`ui-trajectory/`](ui-trajectory/README.md) | 提供 agent（代理）活動的其他檢視表。 |
| [`ui-commands/`](ui-commands/README.md) | 提供工作階段感知的命令發現與分發。 |
| [`ui-input-trigger/`](ui-input-trigger/README.md) | 協調內聯命令和引用建議。 |
| [`ui-skill/`](ui-skill/README.md) | 向內聯建議新增 skill（技能）引用。 |
| [`ui-subagent/`](ui-subagent/README.md) | 提供 subagent（子 agent）導覽、子級 transcript（文字記錄）的狀態和內聯引用。 |
| [`ui-jobs/`](ui-jobs/README.md) | 在工作階段標題欄列出當前工作階段的背景工作。 |
| [`ui-model-selection/`](ui-model-selection/README.md) | 在對話介面中提供模型選擇。 |
| [`ui-permission/`](ui-permission-presets/README.md) | 設定默認權限並切換當前工作階段的訪問模式。 |
| [`ui-plan/`](ui-plan/README.md) | 展示生效中的 plan mode 狀態及其退出控制元件。 |
| [`ui-settings-plugins/`](ui-settings-plugins/README.md) | 擁有“外掛程式”設定分區、它的分頁標籤擴充點，以及可設定的宿主平面外掛程式卡片。 |
| [`ui-user-questions/`](ui-user-questions/README.md) | 展示 agent 請求的互動式問題。 |
| [`ui-agent-preset/`](ui-agent-preset/README.md) | 選擇工作階段的 agent 預設，並編寫預設組合。 |
| [`ui-settings/`](ui-settings/README.md) | 承載設定介面及其擴充區域。 |
| [`ui-settings-general/`](ui-settings-general/README.md) | 提供常規設定分區。 |
| [`ui-settings-models/`](ui-settings-models/README.md) | 提供模型提供方設定與 DeepSeek 設定引導。 |
| [`ui-settings-plugin-inventory/`](ui-settings-plugin-inventory/README.md) | 向“外掛程式”設定貢獻只讀的 Host Loader 清單分頁標籤。 |

每個子文件負責自身的約定和詳細行為。[slot 系統標準](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)與 [Web 用戶端架構 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)負責跨包組合與載入決策。

子系統參考是 [client-modules.md](../../docs/subsystems/client-modules.md)；[slot 系統標準](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)是權威 slot 模型，[web 用戶端架構 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)擁有載入鏈與對象層。
