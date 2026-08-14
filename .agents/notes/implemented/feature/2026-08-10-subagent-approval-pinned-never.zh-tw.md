# Agent Note: 被委派的 subagent 以釘定為 `'never'` 的審批策略執行

Status: implemented

[English](2026-08-10-subagent-approval-pinned-never.md) | [简体中文](2026-08-10-subagent-approval-pinned-never.zh.md) | 繁體中文

## 問題

被委派的子 agent 發起審批請求時無人可問。在互動式父級（`'ask'`）之下，後臺子 agent 的升級請求會變成一個任何產品介面都不展示的掛起問題——subagent 工作階段不進入 Web 側邊欄，父級的 `list_agents` 只報告普通的 `running`／`idle`，目錄樹的行也只顯示活動狀態——因此被權限攔住的子 agent 與正常幹活的子 agent 無法區分；headless 與無應答者的組合則讓同一次 ask 以 `'unavailable'` 失敗關閉。拒絕的審計記錄只落在子 agent 自己的日誌裡，而且沒有任何工具參數或 Web 控制元件能調整一個正在執行的子工作階段的沙盒模式或審批策略（Issue #1723）。機制繁重的修復方案——持久化的受阻狀態投影、父級通知、目錄樹徽標，以及穿過 subagent 所有權圍欄的權限寫入路徑——在臨近發布時代價不成比例。

## 決策

被委派的子 agent 只在委派時固定的權限範圍內行動，審批提示則從它的世界中徹底移除：`captureDelegatedPolicyOverrides(parent)`（`dsh-subagent/src/child-agent.ts`）仍對父工作階段的顯式沙盒覆蓋項建立快照，但只要審批能力已組合，就把 `approvalPolicy: 'never'` 釘定下來——不再讀取父級自身的審批策略。`appendDelegatedPolicyOverrides()` 把這個釘定作為持久化的 `approval/policy { policy: 'never', source: 'delegation' }` 事件寫入子 agent 的日誌，與沙盒快照走完全相同的一次性與可繼續委派路徑，因此冷復原會重放它，fork 種子中過時的父級策略也會輸給它。

強制執行沿用既有的 `ApprovalService` `'never'` 語義，落在裁決 ask 的唯一操作上：子 agent 的每次 ask——bash 或 fs 的 `sandbox_permissions` 升級、hook 驅動的權限詢問、任何未來的請求方——都在諮詢任何應答者之前確定性地解析為 `'rejected'`，同時仍在子日誌上留下 `approval/asked`／`approval/decided` 審計對。子 agent 的全部權限故事因此就是它的沙盒範圍：`danger-full-access` 父級委派出的子 agent 無需任何審批，`read-only` 父級委派出的子 agent 沒有任何逃生通道，而放寬的決定始終屬於父級一側（先放寬父工作階段，再重新委派或繼續 follow-up）。

每個行程內子 agent 都被告知而非被困住：`applyChildComposition` 註冊作用域內的 `subagent:delegation` 執行時期上下文聲明（order 120，位於 `sandbox:policy` 與 `approval:policy` 語句之後），聲明權限範圍已在啟動時固定、需要審批的操作會被自動拒絕、需要更寬訪問的任務應以上報限制收尾而不是重試。該聲明是執行時期上下文貢獻而非系統提示詞 section，因此部署的系統提示詞在父子之間保持統一（快照測試套件釘住了這一統一性），該事實也隨策略語句乘坐同一份持久化快照。

本決策取代[行程內委派策略決策](2026-07-25-subagent-policy-inheritance.md)中的審批一半，並推翻其「強制 `'never'` 會排除未來的子 agent 應答器」的結論：審批繼承已經落地，產生的正是上述不可見的受阻狀態；未來若要引入子 agent 應答器，必須先推翻本 note。

## 考慮過的替代方案

- **繼承父級的審批覆蓋項**（先前的行為）：不予採納。只有已處於 `'never'` 的父級才產生確定性的子 agent；互動式父級種出的子 agent，其 ask 要麼等待一個無人在看的提示，要麼以 `'unavailable'` 失敗關閉，結果取決於當時恰好接入了哪些介面。
- **受阻狀態可見性與逐子級權限調整**（#1723 原有的驗收）：延後而非否決。`list_agents` 的受阻標注、經由結帳投遞 seam 的父級通知、目錄樹徽標，以及 subagent 專用的權限通道仍是更完整的設計，但每一項都需要獨立的 seam 工作；一旦子 agent 不可能進入等待審批的受阻狀態，這些都不再是必需。
- **把子 agent 的 ask 路由到父控制器**：仍按[審批 seam Agent Note](2026-07-06-approval-seam.md) 延後。它需要父鏈所有權與發起 spawn 的 `callId`。
- **在 `ApprovalService` 內按工作階段來源釘定**：不予採納。這會讓審批包耦合委派詞彙，並重複一個委派邊界已經擁有的決定；委派種入的事件之所以可強制執行，是因為當前不存在任何能切換子工作階段策略的寫入路徑（`/permission` 命令要求通用 Host 路由，而 subagent 所有權圍欄對子工作階段拒絕該路由）。

## 後果

- 子 agent 的沙盒繼承就是委派權限模型的全部；`DelegatedPolicyOverrides.approvalPolicy` 欄位收窄為 `'never' | undefined`（僅在未組合審批能力時為 `undefined`）。
- 模型可見：每個子 agent 的執行時期上下文快照攜帶 `subagent:delegation` 聲明以及固定的審批已停用語句；父級請求不變。executor 邊界測試證明：即使根部有一個本會批准的應答者，子 agent 的升級仍被拒絕且不諮詢該應答者，審計對照常落日誌。
- 邊界：行程內一次性、可繼續以及 workflow 派生的子 agent 都經由共享輔助函式強制執行；`subagent-acp` 子 agent 保留該提供方顯式的機器 `permission` 策略；`claude-code`、`codex` 與 `dsh-sdk` 子 agent 執行在外部行程中，由各自的組合決定。
- 在釘定之前持久化的子 agent 冷復原時摺疊到部署審批預設值；處於預發布階段，不新增遷移。
- 快照夾具記錄了該釘定：每個行程內子日誌都新增委派 `approval/policy` 事件，`subagent-published-run-failure` 現在會持久化一份單事件子日誌，而此前該子 agent 不留任何持久化事件。
