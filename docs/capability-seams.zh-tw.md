<!-- 英文原始檔由 scripts/gen-doc-graphs.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/capability-seams.md` 重新記錄配對。 -->

# 能力 Seams 與核心服務

[English](capability-seams.md) | [简体中文](capability-seams.zh.md) | 繁體中文

服務可以是核心主幹服務、可替換的能力 seam，也可以是組合包／組合點。下圖展示了擁有服務聲明的包、已知實作包，以及直接消費該服務的包。

```mermaid
flowchart LR
  pkg_attachment["attachment"]
  svc_attachments["ctx.attachments<br/>Durable binary attachment storage"]
  pkg_attachment_local["attachment-local"]
  pkg_host_runtime["host-runtime"]
  pkg_llm_pi_ai["llm-pi-ai"]
  pkg_llm["llm"]
  svc_llm["ctx.llm<br/>LLM adapter registry"]
  pkg_llm_deepseek["llm-deepseek"]
  pkg_llm_replay["llm-replay"]
  pkg_agent_loop["agent-loop"]
  pkg_compaction_basic["compaction-basic"]
  pkg_token_meter["token-meter"]
  svc_tokenMeter["ctx.tokenMeter<br/>Replay token measurement"]
  pkg_compaction_tool_result_pruner["compaction-tool-result-pruner"]
  svc_toolResultPruner["ctx.toolResultPruner<br/>Model-free tool-result pruning"]
  pkg_session["session"]
  svc_sessions["ctx.sessions<br/>In-memory session store"]
  pkg_agent["agent"]
  pkg_session_persistence["session-persistence"]
  pkg_session_query["session-query"]
  pkg_session_query_sqlite["session-query-sqlite"]
  pkg_subagent_inprocess["subagent-inprocess"]
  pkg_invariants["invariants"]
  pkg_message_feedback["message-feedback"]
  svc_invariants["ctx.invariants<br/>Package-owned invariant registry"]
  pkg_scope["scope"]
  pkg_typert_registry["typert-registry"]
  svc_typert["ctx.typert<br/>Runtime type registry"]
  pkg_typert_loader["typert-loader"]
  pkg_api_gateway["api-gateway"]
  svc_typertGateway["ctx.typertGateway<br/>Typert Host invocation gateway"]
  svc_sessionPersistence["ctx.sessionPersistence<br/>Durable session persistence seam"]
  pkg_session_persistence_jsonl["session-persistence-jsonl"]
  pkg_session_persistence_sqlite["session-persistence-sqlite"]
  pkg_tool_bash["tool-bash"]
  pkg_hooks_claude_code["hooks-claude-code"]
  pkg_hooks_codex["hooks-codex"]
  pkg_settings["settings"]
  svc_settings["ctx.settings<br/>User-settings seam"]
  pkg_settings_file["settings-file"]
  pkg_apiproxy["apiproxy"]
  pkg_credentials["credentials"]
  svc_credentials["ctx.credentials<br/>Credential seam"]
  pkg_credentials_local["credentials-local"]
  pkg_session_telemetry["session-telemetry"]
  svc_sessionTelemetry["ctx.sessionTelemetry<br/>Session telemetry seam"]
  pkg_session_telemetry_otel["session-telemetry-otel"]
  pkg_storage["storage"]
  svc_storage["ctx.storage<br/>Non-session storage hub"]
  pkg_storage_json["storage-json"]
  pkg_storage_sqlite["storage-sqlite"]
  pkg_storage_domain["storage-domain"]
  svc_storageDomain["ctx.storageDomain<br/>Domain data facility"]
  pkg_workspace["workspace"]
  svc_messageFeedback["ctx.messageFeedback<br/>Lifecycle-bound message feedback"]
  svc_workspaceRegistry["ctx.workspaceRegistry<br/>Workspace entity registry"]
  svc_sessionQuery["ctx.sessionQuery<br/>Session reads, traces, filters, and search"]
  pkg_session_reference["session-reference"]
  pkg_tool_session_query["tool-session-query"]
  svc_sessionReferenceResolver["ctx.sessionReferenceResolver<br/>Cross-session snapshot preparation"]
  pkg_session_title["session-title"]
  svc_sessionTitle["ctx.sessionTitle<br/>Log-backed session titles"]
  pkg_session_title_first_prompt_llm["session-title-first-prompt-llm"]
  pkg_session_title_all_prompts_llm["session-title-all-prompts-llm"]
  pkg_system_prompt["system-prompt"]
  svc_systemPrompt["ctx.systemPrompt<br/>System prompt assembly registry"]
  pkg_tools["tools"]
  pkg_tool_fs["tool-fs"]
  pkg_tool_terminal["tool-terminal"]
  pkg_tool_web["tool-web"]
  svc_tools["ctx.tools<br/>Tool registry and guarded execution pipeline"]
  pkg_tool_ask_user["tool-ask-user"]
  pkg_tool_cordis["tool-cordis"]
  pkg_tool_skill["tool-skill"]
  pkg_tool_subagent["tool-subagent"]
  pkg_tool_todo["tool-todo"]
  pkg_user_questions["user-questions"]
  svc_userQuestions["ctx.userQuestions<br/>Human question/answer seam"]
  pkg_plan_mode["plan-mode"]
  svc_planMode["ctx.planMode<br/>Plan collaboration state"]
  pkg_agent_presets["agent-presets"]
  svc_agentPresets["ctx.agentPresets<br/>Per-session agent composition"]
  pkg_commands["commands"]
  svc_commands["ctx.commands<br/>Human command registry"]
  pkg_session_projection["session-projection"]
  svc_sessionProjections["ctx.sessionProjections<br/>Session projection units"]
  pkg_host_apiproxy["host-apiproxy"]
  pkg_session_projection_cache["session-projection-cache"]
  svc_sessionProjectionCache["ctx.sessionProjectionCache<br/>Persisted projection cache"]
  pkg_skill["skill"]
  svc_skills["ctx.skills<br/>Skill provider registry"]
  pkg_skill_badge["skill-badge"]
  pkg_skill_filesystem["skill-filesystem"]
  svc_agents["ctx.agents<br/>Agent service"]
  pkg_acp["acp"]
  pkg_agent_default_model["agent-default-model"]
  svc_agentDefaultModel["ctx.agentDefaultModel<br/>Default Agent model selection"]
  pkg_headless["headless"]
  svc_agentLoop["ctx.agentLoop<br/>Concrete loop driver"]
  pkg_agent_spine_demo["agent-spine-demo"]
  pkg_goal["goal"]
  svc_goals["ctx.goals<br/>Same-session goal domain"]
  pkg_e2b["e2b"]
  svc_e2b["ctx.e2b<br/>E2B sandbox lifecycle owner"]
  pkg_fs_e2b["fs-e2b"]
  pkg_subprocess_e2b["subprocess-e2b"]
  pkg_subprocess["subprocess"]
  svc_subprocess["ctx.subprocess<br/>Subprocess seam"]
  pkg_subprocess_local["subprocess-local"]
  pkg_bash_local["bash-local"]
  pkg_bash_sandbox["bash-sandbox"]
  pkg_terminal_bash["terminal-bash"]
  pkg_lsp_stdio["lsp-stdio"]
  pkg_subagent_acp["subagent-acp"]
  pkg_subagent_codex["subagent-codex"]
  pkg_subagent_claude_code["subagent-claude-code"]
  pkg_shell["shell"]
  svc_shell["ctx.shell<br/>Bash executor seam"]
  pkg_pwsh_local["pwsh-local"]
  pkg_tool_pwsh["tool-pwsh"]
  pkg_shell_env["shell-env"]
  svc_shellEnv["ctx.shellEnv<br/>Managed bash environment registry"]
  pkg_terminal["terminal"]
  svc_terminals["ctx.terminals<br/>Persistent PTY session registry"]
  pkg_sandbox["sandbox"]
  svc_sandbox["ctx.sandbox<br/>Process-sandbox seam"]
  pkg_sandbox_local["sandbox-local"]
  pkg_sandbox_policy["sandbox-policy"]
  svc_sandboxPolicy["ctx.sandboxPolicy<br/>Sandbox policy home"]
  pkg_fs_sandbox["fs-sandbox"]
  pkg_approval["approval"]
  svc_approval["ctx.approval<br/>Approval seam"]
  pkg_permission_presets["permission-presets"]
  svc_permissionPresets["ctx.permissionPresets<br/>Permission presets"]
  pkg_code_runtime["code-runtime"]
  svc_codeRuntime["ctx.codeRuntime<br/>Code-execution seam"]
  pkg_code_runtime_worker["code-runtime-worker"]
  pkg_fs["fs"]
  svc_fs["ctx.fs<br/>Filesystem provider seam"]
  pkg_fs_local["fs-local"]
  pkg_fs_observation_policy["fs-observation-policy"]
  pkg_compaction["compaction"]
  svc_compaction["ctx.compaction<br/>Compaction seam"]
  pkg_subagent["subagent"]
  svc_subagents["ctx.subagents<br/>Subagent provider and continuation service"]
  pkg_subagent_spawn_in_process["subagent-spawn-in-process"]
  pkg_subagent_fork_in_process["subagent-fork-in-process"]
  pkg_subagent_dsh_sdk["subagent-dsh-sdk"]
  pkg_tool_subagent_control["tool-subagent-control"]
  pkg_tool_ralph["tool-ralph"]
  pkg_jobs["jobs"]
  svc_jobs["ctx.jobs<br/>Background job registry"]
  pkg_jobs_local["jobs-local"]
  pkg_tool_jobs["tool-jobs"]
  pkg_web["web"]
  svc_web["ctx.web<br/>Web access provider registry"]
  pkg_web_search_exa["web-search-exa"]
  pkg_web_search_perplexity["web-search-perplexity"]
  pkg_web_search_deepseek["web-search-deepseek"]
  pkg_web_fetch_http["web-fetch-http"]
  pkg_spill["spill"]
  svc_spillStore["ctx.spillStore<br/>Spill storage seam"]
  pkg_spill_local["spill-local"]
  pkg_spill_policy["spill-policy"]
  pkg_directory_picker["directory-picker"]
  svc_directoryPicker["ctx.directoryPicker<br/>Workspace-directory picking seam"]
  pkg_directory_picker_native["directory-picker-native"]
  pkg_directory_picker_browse["directory-picker-browse"]
  pkg_webserver["webserver"]
  svc_webServer["ctx.webServer<br/>HTTP route registration"]
  pkg_connection["connection"]
  pkg_modules["modules"]
  pkg_hmr["hmr"]
  svc_clientModules["ctx.clientModules<br/>Client plugin graph host"]
  pkg_workflow["workflow"]
  svc_workflowEngine["ctx.workflowEngine<br/>Workflow script engine"]
  pkg_workflow_worker_thread["workflow-worker-thread"]
  pkg_tool_workflow["tool-workflow"]
  pkg_lsp["lsp"]
  svc_lsp["ctx.lsp<br/>Language-server navigation seam"]
  pkg_lsp_local["lsp-local"]
  pkg_tool_lsp["tool-lsp"]
  svc_apiProxy["ctx.apiProxy<br/>Host API dispatch"]
  pkg_cordis_host_runner["cordis-host-runner"]
  svc_dynamicCordisRunner["ctx.dynamicCordisRunner<br/>Dynamic Cordis package host runner"]
  svc_cordisInspect["ctx.cordisInspect<br/>Dynamic Cordis inspect registry"]
  pkg_acp --> svc_approval
  pkg_agent --> svc_agents
  pkg_agent_default_model --> svc_agentDefaultModel
  pkg_agent_loop --> svc_agentLoop
  pkg_agent_presets --> svc_agentPresets
  pkg_api_gateway --> svc_typertGateway
  pkg_apiproxy --> svc_apiProxy
  pkg_approval --> svc_approval
  pkg_attachment --> svc_attachments
  pkg_attachment_local --> svc_attachments
  pkg_bash_local --> svc_shell
  pkg_bash_sandbox --> svc_shell
  pkg_code_runtime --> svc_codeRuntime
  pkg_code_runtime_worker --> svc_codeRuntime
  pkg_commands --> svc_commands
  pkg_compaction --> svc_compaction
  pkg_compaction_basic --> svc_compaction
  pkg_compaction_tool_result_pruner --> svc_toolResultPruner
  pkg_cordis_host_runner --> svc_cordisInspect
  pkg_cordis_host_runner --> svc_dynamicCordisRunner
  pkg_credentials --> svc_credentials
  pkg_credentials_local --> svc_credentials
  pkg_directory_picker --> svc_directoryPicker
  pkg_directory_picker_browse --> svc_directoryPicker
  pkg_directory_picker_native --> svc_directoryPicker
  pkg_e2b --> svc_e2b
  pkg_fs --> svc_fs
  pkg_fs_e2b --> svc_fs
  pkg_fs_local --> svc_fs
  pkg_fs_sandbox --> svc_fs
  pkg_goal --> svc_goals
  pkg_invariants --> svc_invariants
  pkg_jobs --> svc_jobs
  pkg_jobs_local --> svc_jobs
  pkg_llm --> svc_llm
  pkg_llm_deepseek --> svc_llm
  pkg_llm_pi_ai --> svc_llm
  pkg_llm_replay --> svc_llm
  pkg_lsp --> svc_lsp
  pkg_lsp_local --> svc_lsp
  pkg_message_feedback --> svc_messageFeedback
  pkg_modules --> svc_clientModules
  pkg_permission_presets --> svc_permissionPresets
  pkg_plan_mode --> svc_planMode
  pkg_pwsh_local --> svc_shell
  pkg_sandbox --> svc_sandbox
  pkg_sandbox_local --> svc_sandbox
  pkg_sandbox_policy --> svc_sandboxPolicy
  pkg_session --> svc_sessions
  pkg_session_persistence --> svc_sessionPersistence
  pkg_session_persistence_jsonl --> svc_sessionPersistence
  pkg_session_persistence_sqlite --> svc_sessionPersistence
  pkg_session_projection --> svc_sessionProjections
  pkg_session_projection_cache --> svc_sessionProjectionCache
  pkg_session_query --> svc_sessionQuery
  pkg_session_query_sqlite --> svc_sessionQuery
  pkg_session_reference --> svc_sessionReferenceResolver
  pkg_session_telemetry --> svc_sessionTelemetry
  pkg_session_telemetry_otel --> svc_sessionTelemetry
  pkg_session_title --> svc_sessionTitle
  pkg_session_title_all_prompts_llm --> svc_sessionTitle
  pkg_session_title_first_prompt_llm --> svc_sessionTitle
  pkg_settings --> svc_settings
  pkg_settings_file --> svc_settings
  pkg_shell --> svc_shell
  pkg_shell_env --> svc_shellEnv
  pkg_skill --> svc_skills
  pkg_skill_badge --> svc_skills
  pkg_skill_filesystem --> svc_skills
  pkg_spill --> svc_spillStore
  pkg_spill_local --> svc_spillStore
  pkg_storage --> svc_storage
  pkg_storage_domain --> svc_storageDomain
  pkg_storage_json --> svc_storage
  pkg_storage_sqlite --> svc_storage
  pkg_subagent --> svc_subagents
  pkg_subagent_acp --> svc_subagents
  pkg_subagent_claude_code --> svc_subagents
  pkg_subagent_codex --> svc_subagents
  pkg_subagent_dsh_sdk --> svc_subagents
  pkg_subagent_fork_in_process --> svc_subagents
  pkg_subagent_spawn_in_process --> svc_subagents
  pkg_subprocess --> svc_subprocess
  pkg_subprocess_e2b --> svc_subprocess
  pkg_subprocess_local --> svc_subprocess
  pkg_system_prompt --> svc_systemPrompt
  pkg_terminal --> svc_terminals
  pkg_terminal_bash --> svc_terminals
  pkg_token_meter --> svc_tokenMeter
  pkg_tools --> svc_tools
  pkg_typert_registry --> svc_typert
  pkg_user_questions --> svc_userQuestions
  pkg_web --> svc_web
  pkg_web_fetch_http --> svc_web
  pkg_web_search_deepseek --> svc_web
  pkg_web_search_exa --> svc_web
  pkg_web_search_perplexity --> svc_web
  pkg_webserver --> svc_webServer
  pkg_workflow --> svc_workflowEngine
  pkg_workflow_worker_thread --> svc_workflowEngine
  pkg_workspace --> svc_workspaceRegistry
  svc_agentDefaultModel --> pkg_headless
  svc_agentDefaultModel --> pkg_host_apiproxy
  svc_agentLoop --> pkg_agent_spine_demo
  svc_agents --> pkg_acp
  svc_agents --> pkg_agent_loop
  svc_agents --> pkg_subagent_inprocess
  svc_apiProxy --> pkg_connection
  svc_approval --> pkg_tool_bash
  svc_approval --> pkg_tools
  svc_attachments --> pkg_host_runtime
  svc_attachments --> pkg_llm_pi_ai
  svc_clientModules --> pkg_hmr
  svc_codeRuntime --> pkg_tools
  svc_compaction --> pkg_compaction_basic
  svc_cordisInspect --> pkg_tool_cordis
  svc_credentials --> pkg_apiproxy
  svc_credentials --> pkg_llm_deepseek
  svc_credentials --> pkg_llm_pi_ai
  svc_directoryPicker --> pkg_apiproxy
  svc_dynamicCordisRunner --> pkg_tool_cordis
  svc_e2b --> pkg_fs_e2b
  svc_e2b --> pkg_subprocess_e2b
  svc_fs --> pkg_tool_fs
  svc_invariants --> pkg_agent
  svc_invariants --> pkg_agent_loop
  svc_invariants --> pkg_scope
  svc_invariants --> pkg_session
  svc_jobs --> pkg_tool_bash
  svc_jobs --> pkg_tool_jobs
  svc_jobs --> pkg_tool_subagent
  svc_jobs --> pkg_tool_terminal
  svc_llm --> pkg_agent_loop
  svc_llm --> pkg_compaction_basic
  svc_lsp --> pkg_tool_lsp
  svc_sandbox --> pkg_bash_sandbox
  svc_sandbox --> pkg_terminal_bash
  svc_sandboxPolicy --> pkg_bash_sandbox
  svc_sandboxPolicy --> pkg_fs_sandbox
  svc_sandboxPolicy --> pkg_terminal_bash
  svc_sessionPersistence --> pkg_agent_loop
  svc_sessionPersistence --> pkg_hooks_claude_code
  svc_sessionPersistence --> pkg_hooks_codex
  svc_sessionPersistence --> pkg_message_feedback
  svc_sessionPersistence --> pkg_session_query
  svc_sessionPersistence --> pkg_session_query_sqlite
  svc_sessionPersistence --> pkg_tool_bash
  svc_sessionProjectionCache --> pkg_host_apiproxy
  svc_sessionProjections --> pkg_host_apiproxy
  svc_sessionProjections --> pkg_session_title
  svc_sessionProjections --> pkg_tool_todo
  svc_sessionQuery --> pkg_session_reference
  svc_sessionQuery --> pkg_tool_session_query
  svc_sessions --> pkg_agent
  svc_sessions --> pkg_agent_loop
  svc_sessions --> pkg_invariants
  svc_sessions --> pkg_message_feedback
  svc_sessions --> pkg_session_persistence
  svc_sessions --> pkg_session_query
  svc_sessions --> pkg_session_query_sqlite
  svc_sessions --> pkg_subagent_inprocess
  svc_settings --> pkg_apiproxy
  svc_settings --> pkg_llm_deepseek
  svc_settings --> pkg_llm_pi_ai
  svc_shell --> pkg_hooks_claude_code
  svc_shell --> pkg_hooks_codex
  svc_shell --> pkg_tool_bash
  svc_shell --> pkg_tool_pwsh
  svc_shellEnv --> pkg_tool_bash
  svc_shellEnv --> pkg_tool_pwsh
  svc_skills --> pkg_tool_skill
  svc_spillStore --> pkg_spill_policy
  svc_storage --> pkg_storage_domain
  svc_storageDomain --> pkg_message_feedback
  svc_storageDomain --> pkg_workspace
  svc_subagents --> pkg_tool_ralph
  svc_subagents --> pkg_tool_subagent
  svc_subagents --> pkg_tool_subagent_control
  svc_subprocess --> pkg_bash_local
  svc_subprocess --> pkg_bash_sandbox
  svc_subprocess --> pkg_lsp_stdio
  svc_subprocess --> pkg_subagent_acp
  svc_subprocess --> pkg_subagent_claude_code
  svc_subprocess --> pkg_subagent_codex
  svc_subprocess --> pkg_terminal_bash
  svc_systemPrompt --> pkg_agent_loop
  svc_systemPrompt --> pkg_tool_fs
  svc_systemPrompt --> pkg_tool_terminal
  svc_systemPrompt --> pkg_tool_web
  svc_systemPrompt --> pkg_tools
  svc_terminals --> pkg_tool_terminal
  svc_tokenMeter --> pkg_compaction_basic
  svc_toolResultPruner --> pkg_compaction_basic
  svc_tools --> pkg_agent_loop
  svc_tools --> pkg_tool_ask_user
  svc_tools --> pkg_tool_bash
  svc_tools --> pkg_tool_cordis
  svc_tools --> pkg_tool_fs
  svc_tools --> pkg_tool_skill
  svc_tools --> pkg_tool_subagent
  svc_tools --> pkg_tool_terminal
  svc_tools --> pkg_tool_todo
  svc_tools --> pkg_tool_web
  svc_typert --> pkg_api_gateway
  svc_typert --> pkg_typert_loader
  svc_userQuestions --> pkg_tool_ask_user
  svc_web --> pkg_tool_web
  svc_webServer --> pkg_connection
  svc_webServer --> pkg_hmr
  svc_webServer --> pkg_modules
  svc_workflowEngine --> pkg_tool_ralph
  svc_workflowEngine --> pkg_tool_workflow
  svc_workspaceRegistry --> pkg_apiproxy
  svc_fs -. event gate .-> pkg_fs_observation_policy
```

| ctx 鍵 | 角色 | 所屬包 | 實作 | 直接消費端 | 配套外掛程式 | 說明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ctx.attachments` | `seam` | [`attachment`](../packages/attachment/attachment) | [`attachment-local`](../packages/attachment/attachment-local) | `host-runtime`, [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | 宿主會在工作階段事件之前提交已接受的圖片；提供方配接器將已授權的持久引用解析為提供方原生內容。 |
| `ctx.llm` | `seam` | [`llm`](../packages/llm/llm) | [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai), [`llm-replay`](../packages/test-support/llm-replay) | [`agent-loop`](../packages/core/agent-loop), [`compaction-basic`](../packages/compaction/compaction-basic) | - | 配接器註冊提供方實作；agent loop（代理循環）與壓縮功能呼叫提供方無關的流服務。 |
| `ctx.tokenMeter` | `core` | [`token-meter`](../packages/llm/token-meter) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 擁有按工作階段隔離的重播摺疊區；壓力消費端共享不可變且帶修訂版本的測量結果。 |
| `ctx.toolResultPruner` | `core` | [`compaction-tool-result-pruner`](../packages/compaction/compaction-tool-result-pruner) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 在摘要壓縮前，透過可重播的單節點表層替換來改寫過大的當前工具結果。 |
| `ctx.sessions` | `core` | [`session`](../packages/core/session) | - | [`agent-loop`](../packages/core/agent-loop), [`agent`](../packages/core/agent), [`session-persistence`](../packages/session/session-persistence), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), `subagent-inprocess`, [`invariants`](../packages/runtime-diagnostics/invariants), [`message-feedback`](../packages/feedback/message-feedback) | - | 擁有僅附加的 Session 實例，並行出持久的工作階段事件流。 |
| `ctx.invariants` | `core` | [`invariants`](../packages/runtime-diagnostics/invariants) | - | [`session`](../packages/core/session), [`agent`](../packages/core/agent), [`scope`](../packages/core/scope), [`agent-loop`](../packages/core/agent-loop) | - | 配套子路徑註冊所屬包本機的檢查；該服務負責選擇、唯一性、子 fiber，以及標明所屬包的失敗。 |
| `ctx.typert` | `core` | [`typert-registry`](../packages/typert/registry) | - | [`typert-loader`](../packages/typert/loader), [`api-gateway`](../packages/api/gateway) | - | 外掛程式直接或透過 dsh-typert-loader 註冊即時 zod 貢獻；API 閘道消費呼叫描述符和提供方，其他執行時期消費端則在各自邊界查詢 schema 與反射中繼資料。 |
| `ctx.typertGateway` | `core` | [`api-gateway`](../packages/api/gateway) | - | - | - | 將生成的 Remote 描述符與即時 Cordis 服務關聯，解析已註冊的身份，並透過共享的 Connection RPC 載體提供一元呼叫。 |
| `ctx.sessionPersistence` | `seam` | [`session-persistence`](../packages/session/session-persistence) | [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl), [`session-persistence-sqlite`](../packages/session/session-persistence-sqlite) | [`agent-loop`](../packages/core/agent-loop), [`tool-bash`](../packages/shell/tool-bash), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`message-feedback`](../packages/feedback/message-feedback) | - | 各後端持久化同一套 SessionEvent 詞彙；應用在組合時選擇後端。 |
| `ctx.settings` | `seam` | [`settings`](../packages/settings/settings) | [`settings-file`](../packages/settings/settings-file) | [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai), `apiproxy` | - | 外掛程式註冊命名空間 schema 並解析分層值；提供方儲存原始文件。LLM（大型語言模型）配接器在使用者分區下將其入口設定註冊為組合基礎；Web 閘道提供經過脫敏的分層描述符，並寫入使用者層。 |
| `ctx.credentials` | `seam` | [`credentials`](../packages/credentials/credentials) | [`credentials-local`](../packages/credentials/credentials-local) | [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai), `apiproxy` | - | 設定攜帶對機密資訊的引用；提供方擁有實際值。消費端按操作解析，因此輪換後的憑據會在緊接著的下一次請求中生效；Web 閘道提供不含實際值的檢視表和只寫儲存。 |
| `ctx.sessionTelemetry` | `seam` | [`session-telemetry`](../packages/session/session-telemetry) | [`session-telemetry-otel`](../packages/session/session-telemetry-otel) | - | - | 該 seam 捕獲工作階段記錄、進行脫敏並交給一個後端；沒有其他元件消費該服務，其輸出會離開當前行程。 |
| `ctx.storage` | `seam` | [`storage`](../packages/storage/storage) | [`storage-json`](../packages/storage/storage-json), [`storage-sqlite`](../packages/storage/storage-sqlite) | [`storage-domain`](../packages/storage/storage-domain) | - | 各後端以不同名稱並列註冊；資料形態（領域優先）掛載到樞紐上，並將類型化操作轉換為不透明的 KV 單元原語。 |
| `ctx.storageDomain` | `core` | [`storage-domain`](../packages/storage/storage-domain) | - | [`workspace`](../packages/workspace/workspace), [`message-feedback`](../packages/feedback/message-feedback) | - | 等待所有已設定後端就緒，然後將領域形態發布為一個受生命週期約束的服務，用於類型化持久狀態。 |
| `ctx.messageFeedback` | `core` | [`message-feedback`](../packages/feedback/message-feedback) | - | - | - | 擁有本機逐 assistant 訊息回饋、生命週期與目標校驗、逐條目 compare-and-set 及 Host 一元 Remote 契約，且不進入 Session 歷史或遙測。 |
| `ctx.workspaceRegistry` | `core` | [`workspace`](../packages/workspace/workspace) | - | `apiproxy` | - | 透過領域設施擁有帶 WorkspaceId 品牌類型的記錄；穩定的 sessionIds 帳戶驅動 Host RPC 與 GUI 投影。 |
| `ctx.sessionQuery` | `seam` | [`session-query`](../packages/session-query/session-query) | [`session-query-sqlite`](../packages/session-query/session-query-sqlite) | [`session-reference`](../packages/context/session-reference), [`tool-session-query`](../packages/session-query/tool-session-query) | - | 該介面提供精確讀取、過濾和追蹤；具體後端還提供全文協調、排序、摘要片段和遊標世代，而模型消費端負責工作區權限與不含遊標的算繪。 |
| `ctx.sessionReferenceResolver` | `core` | [`session-reference`](../packages/context/session-reference) | - | - | - | 將當前表層中有界的對話快照投影為持久但不可信的訊息上下文；Host 配接器負責提及文法。 |
| `ctx.sessionTitle` | `seam` | [`session-title`](../packages/session/session-title) | [`session-title-first-prompt-llm`](../packages/session/session-title-first-prompt-llm), [`session-title-all-prompts-llm`](../packages/session/session-title-all-prompts-llm) | - | - | 負責確定性回退、最新標題摺疊區，以及唯一的選填非同步提供方註冊。 |
| `ctx.systemPrompt` | `core` | [`system-prompt`](../packages/core/system-prompt) | - | [`agent-loop`](../packages/core/agent-loop), [`tools`](../packages/core/tools), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-web`](../packages/web/tool-web) | - | 為每個步驟收集提示詞各部分和麵向模型的工具 schema。 |
| `ctx.tools` | `core` | [`tools`](../packages/core/tools) | - | [`agent-loop`](../packages/core/agent-loop), [`tool-ask-user`](../packages/interaction/tool-ask-user), [`tool-bash`](../packages/shell/tool-bash), [`tool-cordis`](../packages/extensions/tool-cordis), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-skill`](../packages/skill/tool-skill), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-todo`](../packages/todo/tool-todo), [`tool-web`](../packages/web/tool-web) | - | 註冊能力，負責 Code Mode 傳輸，並讓呼叫依次經過策略前處理、單調守衛、環繞分派、策略後處理和最終結果觀測。 |
| `ctx.userQuestions` | `seam` | [`user-questions`](../packages/interaction/user-questions) | - | [`tool-ask-user`](../packages/interaction/tool-ask-user) | - | UI 前端提供當前生效的人工回答提供方；tool-ask-user 在提供方無關的 ask() promise 上暫停工具呼叫。 |
| `ctx.planMode` | `core` | [`plan-mode`](../packages/plan/plan-mode) | - | - | - | 摺疊已記錄的計畫／模式狀態，在輪次邊界刷新使用者選擇，算繪由部署方擁有的指導資訊，註冊 /plan，並在狀態轉換期間保持計畫結束 schema 穩定。 |
| `ctx.agentPresets` | `core` | [`agent-presets`](../packages/preset/agent-presets) | - | - | - | 在受信任根目錄與使用者創作根目錄上發現 preset 目錄，並在建立期把一份 preset cordis.yml 掛載到 agent 作用域之下，拒絕始終未啟用或向根服務 realm 發布服務的行。 |
| `ctx.commands` | `core` | [`commands`](../packages/interaction/commands) | - | - | - | 外掛程式註冊直接面向人的命令，而不會把呼叫傳送給模型。 |
| `ctx.sessionProjections` | `core` | [`session-projection`](../packages/session/session-projection) | - | [`tool-todo`](../packages/todo/tool-todo), [`session-title`](../packages/session/session-title), [`host-apiproxy`](../packages/host/apiproxy) | - | 各領域註冊由狀態驅動的摺疊單元；主動驅動程序維護每個工作階段的水位狀態，api-proxy 提供基線並推送發生變化的值。 |
| `ctx.sessionProjectionCache` | `core` | [`session-projection-cache`](../packages/session/session-projection-cache) | - | [`host-apiproxy`](../packages/host/apiproxy) | - | 按工作階段持久保存投影單元狀態的檢查點（節流檢查點，以及輪次／結束／分離時的必選檢查點），並提供冷讀取階梯：快取行加持久化尾部重播，因此清單讀取永遠不需要載入完整日誌。 |
| `ctx.skills` | `seam` | [`skill`](../packages/skill/skill) | [`skill-badge`](../packages/skill/skill-badge), [`skill-filesystem`](../packages/skill/skill-filesystem) | [`tool-skill`](../packages/skill/tool-skill) | - | 合併提供方的 skill（技能）目錄；tool-skill 算繪工作階段前綴目錄，並載入完整的 skill 正文。 |
| `ctx.agents` | `core` | [`agent`](../packages/core/agent) | - | [`agent-loop`](../packages/core/agent-loop), [`acp`](../packages/acp/acp), `subagent-inprocess` | - | 擁有即時 Agent 控制代碼、建立／復原工廠 seam，以及行程本機的發起方傳播。 |
| `ctx.agentDefaultModel` | `core` | [`agent-default-model`](../packages/core/agent-default-model) | - | [`headless`](../packages/bundle/headless), [`host-apiproxy`](../packages/host/apiproxy) | - | 透過 settings 分層預設 `ModelSelection`，讓直接入口與 Host 支撐的 Agent 入口共享同一個狀態所有者。 |
| `ctx.agentLoop` | `bundle` | [`agent-loop`](../packages/core/agent-loop) | - | [`agent-spine-demo`](../packages/examples/agent-spine-demo) | - | 唯一的具體迴圈外掛程式；擴充包相依性 dsh-agent 的事件和服務，而不相依性此包。 |
| `ctx.goals` | `core` | [`goal`](../packages/goal/goal) | - | - | - | 從工作階段日誌摺疊帶修訂版本的目標狀態，並將即時延續啟用保留在行程本機。 |
| `ctx.e2b` | `core` | [`e2b`](../packages/e2b/e2b) | - | [`fs-e2b`](../packages/e2b/fs-e2b), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | - | 擁有一個共享的 E2B SDK 控制代碼、遠端工作目錄和最終沙盒處置，使兩個基礎 E2B 提供方處於同一個 Linux 執行時期中。 |
| `ctx.subprocess` | `seam` | [`subprocess`](../packages/subprocess/subprocess) | [`subprocess-local`](../packages/subprocess/subprocess-local), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash), [`lsp-stdio`](../packages/lsp/lsp-stdio), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code) | - | Bash 執行器、PTY shell 後端、LSP Host，以及行程外 ACP、Codex 和 Claude Code subagent 後端都透過 ctx.subprocess 執行 spawn；該服務負責行程坐標、行程樹／工作階段生命週期、stdio 處置、終端機機制和 kill 升級。 |
| `ctx.shell` | `seam` | [`shell`](../packages/shell/shell) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`pwsh-local`](../packages/shell/pwsh-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex) | - | 面向模型的 shell 工具和掛鉤橋接消費此 seam；沙盒、遠端或 PowerShell 執行器可以替換 bash-local，而無需改動這些消費端。 |
| `ctx.shellEnv` | `core` | [`shell-env`](../packages/shell/shell-env) | - | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh) | - | 外掛程式聲明限定於 effect 作用域的 DSH_* 事實；每個 shell 工具在每次執行時收集一份可信快照，其執行器據此重建命名空間。 |
| `ctx.terminals` | `seam` | [`terminal`](../packages/terminal/terminal) | [`terminal-bash`](../packages/terminal/terminal-bash) | [`tool-terminal`](../packages/terminal/tool-terminal) | - | 登錄檔負責精確到 Agent 的工作階段身份和清理；後端負責終端機機制，tool-terminal 則提供限定於所有者作用域的模型介面。 |
| `ctx.sandbox` | `seam` | [`sandbox`](../packages/sandbox/sandbox) | [`sandbox-local`](../packages/sandbox/sandbox-local) | [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | 消費端交出即將執行 spawn 的確切 argv；與宿主共享檔案系統和核心的後端按每次呼叫的策略包裝該 argv，並報告強制執行情況。 |
| `ctx.sandboxPolicy` | `core` | [`sandbox-policy`](../packages/sandbox/sandbox-policy) | - | [`bash-sandbox`](../packages/shell/bash-sandbox), [`fs-sandbox`](../packages/fs/fs-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | 統一保存部署預設模式和工作區根目錄；只有沙盒執行器和提供方讀取該服務（工具層使用它同時匯出的純 `sandbox/mode` 摺疊區）。兩類強制執行元件都讀取該服務，因此 bash 與 fs 不會限制到不同的根目錄。 |
| `ctx.approval` | `seam` | `approval` | [`acp`](../packages/acp/acp) | [`tools`](../packages/core/tools), [`tool-bash`](../packages/shell/tool-bash) | - | 一次性權限決策透過 `approval/request` waterfall（瀑布式事件）分派；回答方是監聽器（即 ACP 為自身 agent 提供的橋接），沒有回答方時以 `unavailable` 關閉失敗。 |
| `ctx.permissionPresets` | `core` | [`permission-presets`](../packages/interaction/permission-presets) | - | - | - | 面向使用者的預設表（`workspace-write`／`danger-full-access`），將沙盒模式與審批策略選項組合在一起；一次切換會寫入一個 `permission/preset` 事件，並貫通到兩個選項事件。 |
| `ctx.codeRuntime` | `seam` | [`code-runtime`](../packages/code-runtime/code-runtime) | `code-runtime-worker` | [`tools`](../packages/core/tools) | - | 使用 Host 提供的非同步綁定執行一段由模型編寫的程序；各後端採用不同的基礎環境和語言（工具登錄檔在 Code Mode 下消費該服務）。 |
| `ctx.fs` | `seam` | [`fs`](../packages/fs/fs) | [`fs-local`](../packages/fs/fs-local), [`fs-sandbox`](../packages/fs/fs-sandbox), [`fs-e2b`](../packages/e2b/fs-e2b) | [`tool-fs`](../packages/fs/tool-fs) | [`fs-observation-policy`](../packages/fs/fs-observation-policy) | tool-fs 透過 ctx.fs 執行讀取／寫入／編輯；fs-sandbox 按共享沙盒模式限制變更；fs-observation-policy 透過 fs/* 事件閘門貢獻基於觀測狀態的檢查。 |
| `ctx.compaction` | `seam` | [`compaction`](../packages/compaction/compaction) | [`compaction-basic`](../packages/compaction/compaction-basic) | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 基礎後端消費步驟後的壓力事件和請求錯誤復原事件；不存在面向模型的壓縮工具。 |
| `ctx.subagents` | `seam` | [`subagent`](../packages/subagent/subagent) | [`subagent-spawn-in-process`](../packages/subagent/subagent-spawn-in-process), [`subagent-fork-in-process`](../packages/subagent/subagent-fork-in-process), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code), [`subagent-dsh-sdk`](../packages/subagent/subagent-dsh-sdk) | [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-subagent-control`](../packages/subagent/tool-subagent-control), [`tool-ralph`](../packages/workflow/tool-ralph) | - | 提供方實作傳輸；該服務還負責選填的、基於 Activation 的延續編排，tool-subagent 選擇一次性或可延續委派，tool-subagent-control 傳遞後續訊息，而 tool-ralph 要求一條全新的結構化輸出路由。 |
| `ctx.jobs` | `seam` | [`jobs`](../packages/jobs/jobs) | [`jobs-local`](../packages/jobs/jobs-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-jobs`](../packages/jobs/tool-jobs) | - | 生產方（後臺 bash、PTY 傳送和 subagent 委派）登記正在執行的工作；tool-jobs 是面向模型的控制器，用於讀取、列出和終止這些工作；jobs-local 是行程本機登錄檔。 |
| `ctx.web` | `seam` | [`web`](../packages/web/web) | [`web-search-exa`](../packages/web/web-search-exa), [`web-search-perplexity`](../packages/web/web-search-perplexity), [`web-search-deepseek`](../packages/web/web-search-deepseek), [`web-fetch-http`](../packages/web/web-fetch-http) | [`tool-web`](../packages/web/tool-web) | - | 搜尋和抓取提供方註冊到同一個 ctx.web seam；tool-web 負責穩定的面向模型名稱。 |
| `ctx.spillStore` | `seam` | [`spill`](../packages/spill/spill) | [`spill-local`](../packages/spill/spill-local) | [`spill-policy`](../packages/spill/spill-policy) | - | 後端保存過大的工具文字，並返回面向模型的定位資訊和取回提示；spill-policy 是 tools/post-execute 消費端，負責決定何時 spill。 |
| `ctx.directoryPicker` | `seam` | `directory-picker` | `directory-picker-native`, `directory-picker-browse` | `apiproxy` | - | 帶判別標記的互動能力：原生後端在 Host 顯示設備上打開一個作業系統選擇器，瀏覽後端為應用內瀏覽器提供清單與建立原語；雙端後端透過其瀏覽器側填充 ui-workspace 目錄流程的 slot（不透過協定發布）。 |
| `ctx.webServer` | `core` | `webserver` | - | `connection`, `modules`, `hmr` | - | 普通的 node:http 載體：具名路由登錄檔、索引轉換 tap，以及靜態 dist 回退；Web 傳輸外掛程式註冊自己的路由。 |
| `ctx.clientModules` | `core` | `modules` | - | `hmr` | - | 透過增量 `dsh.client` 掃描組合 __DSH_BOOT__ 入口圖，提供外掛程式組合包，並通知重建／圖變更訂閱方。 |
| `ctx.workflowEngine` | `seam` | [`workflow`](../packages/workflow/workflow) | [`workflow-worker-thread`](../packages/workflow/workflow-worker-thread) | [`tool-workflow`](../packages/workflow/tool-workflow), [`tool-ralph`](../packages/workflow/tool-ralph) | - | 每個上下文使用一個引擎，與 bash 相同，且沒有具名提供方登錄檔；通用工作流程與固定 Ralph 消費端啟動執行，其中的 agent() 呼叫透過 ctx.subagents 扇出。 |
| `ctx.lsp` | `seam` | [`lsp`](../packages/lsp/lsp) | `lsp-local` | [`tool-lsp`](../packages/lsp/tool-lsp) | - | 提供方註冊與選擇，加上恰好四種操作的標準化查詢執行；該 seam 不提供協定逃生口，後端必須轉換為標準化請求和結果。 |
| `ctx.apiProxy` | `core` | `apiproxy` | - | `connection` | - | 與傳輸無關的 Host 閘道介面：它分派瀏覽器 API 呼叫，每條打開的 Host 流自行訂閱轉發事件，而不是由廣播方法向其推送。 |
| `ctx.dynamicCordisRunner` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | 擁有記憶體定義登錄檔、Host 半的 vm 沙盒和 request-run 往返流程；瀏覽器頁面透過其 Remote 命名空間線上訪問同一服務。 |
| `ctx.cordisInspect` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | 註冊 Host inspect 提供方、映像檔 Client 提供方 manifest，並透過動態 Cordis 傳輸路由 Client 查詢。 |

維護模式：混合模式。服務從 Cordis 聲明中發現；介面、實作和消費端角色在 `scripts/gen-doc-graphs.ts` 中分類，並設有完整性守衛。
