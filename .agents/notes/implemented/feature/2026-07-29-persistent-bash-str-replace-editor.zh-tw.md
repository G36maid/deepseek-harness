# Agent Note: 持久 Bash 與字串替換編輯器工具

Status: implemented

[English](2026-07-29-persistent-bash-str-replace-editor.md) | [简体中文](2026-07-29-persistent-bash-str-replace-editor.zh.md) | 繁體中文

## 問題

部分部署需要只調用一次的 Bash schema，同時要求 shell 狀態跨模型輪次保留；另一些部署需要與終端機選擇無關的 Claude 風格 `str_replace_editor`。把兩個工具綁在一起或按某個基準命名，會阻礙複用並模糊設定歸屬。

## 決策

`@deepseek-ai/dsh-tool-bash-persistent` 消費 `ctx.terminals` 並註冊一個 `bash(command)` 工具。它為每個精確 Agent 惰性建立一個互動式 shell，並序列化該所有者的呼叫。Cwd、匯出的變數、已啟用環境、函式和背景工作會保留。隨機私有標記劃分命令輸出；保留的 scrollback 會向前分頁，以復原命令真正的輸出前綴，若前綴已被丟棄則明確告知。經封裝的命令以非零狀態結束時，會追加 `[exit code: N]`；若 shell 在報告該狀態前終止，則改為追加 `[shell exited: code N]`、`[shell killed by signal: SIG]`，或在後端既未提供退出碼也未提供訊號時追加 `[shell exited]`。`maxOutputChars` 限制保留的命令輸出，而固定診斷可能使返回字串更長。逾時或取消會先關閉 shell，避免下一次呼叫複用狀態不確定的工作階段，模型可見的逾時／退出結果也會說明該重設。取消始終會重設 shell 並丟棄結果，即使已經能觀察到完整狀態標記也是如此，從而不會讓模型未曾看到的狀態變更得以保留。可設定描述默認只聲明持久性事實，因此網路和套件映像檔等聲明仍歸部署所有。

`@deepseek-ai/dsh-tool-str-replace-editor` 獨立消費 `ctx.fs`，註冊包含 `view`、`create`、`str_replace` 與 `insert` 的 `str_replace_editor`。它提供帶行號文字查看、過濾後的兩層目錄清單、唯一字面量替換、規範插入邊界和有界輸出。路徑必須為絕對路徑；文件查看會保留內容中的製表符，因此複製的文字仍可作為有效的字面量替換輸入；變更會保留請求編輯範圍之外的製表符；公開 schema 與錯誤則只使用 `old_str`。它可以與持久 Bash、一次性 Bash、沙盒 Bash 或無 shell 組合。

`dsh-system-prompt` 接受 `includeHarnessIdentity: false`；`dsh-agent-spine-demo` 會轉發該設定，並接受 `toolBash: false`。因此部署可以擁有精確 persona，並替換 spine 的原生 Bash，而不會重複註冊提示詞或工具。既有預設值不變。

兩個外掛程式都進入 Python runtime 閉包。持久 Bash 的閉包還包含 PTY 服務／本機後端，以及該後端要求的沙盒服務。由於 `node-pty` 在 macOS 上會執行原生 `spawn-helper`，每個打包後的 macOS 執行時期可執行文件都會攜帶一個 `-spawn-helper` 伴隨檔案；Linux 直接使用 `forkpty`。固定版本的 `node-pty` 修補程式會先檢查 `DSH_NODE_PTY_SPAWN_HELPER`，因此對當前提供非伴隨 helper 的外部消費端而言，該變數仍是真正的覆蓋項。未設定該覆蓋時，修補程式會在打包可執行文件的伴隨檔案存在時解析它，否則在普通 Node 執行中保留上游尋找方式。若 helper 缺失或不可執行，macOS 建置器會在發布前失敗。

隨附的 [`minimal` agent preset](../../../../apps/cli/config/agent-presets/minimal/agent.cordis.yml) 會組合這兩個外掛程式，以滿足與 Claude SWE 相容的 RL 約定。其 entry 本機 PTY realm 持有登錄檔、本機後端和持久 Bash 工具；編輯器在該 realm 旁註冊，並使用宿主檔案系統。preset 會固定完整系統提示詞、跟隨部署的工具呈現模式，省略其他所有面向模型的消費端，並將瀏覽器、Workspace、持久化、沙盒與權限服務留在共享 Web 宿主上。本機 PTY 後端會在建立 shell 時解析工作階段的有效沙盒模式。只要該所有者仍有打開的 shell 或仍在進行中的 spawn，另一種權限模式就會在對應的工作階段事件提交前遭到拒絕；編輯器則繼續經由 Web 檔案系統沙盒執行。這一組合邊界由 [minimal-preset 決策](../bug-fix/2026-08-10-minimal-preset-owns-rl-composition.md)負責說明。

## 考慮過的替代方案

**單一組合相容外掛程式。** 被拒絕，因為兩個工具互不相依性，組合命名還會把可複用能力綁定到某個基準。

**複用一次性 Bash。** 被拒絕，因為 `bash -c` 無法跨呼叫保留 cwd 或環境狀態。

**暴露終端機管理工具。** 被拒絕，因為 open/send/read/close 與單個持久 `bash` 呼叫是不同的模型動作空間。

**修改原生 read/write/edit。** 被拒絕，因為這會扭曲其通用約定，而不是增加一個可獨立組合的編輯器。

## 後果

Profile 可以透過設定 persona 和描述復現外部 Agent，而底層包保持通用。持久 Bash 需要擁有它的 Agent 與真實 PTY 後端；shell 退出、逾時或取消會丟失狀態。編輯器把安全與變更策略委託給掛載的檔案系統棧。minimal Web agent 保留 Web 權限，但必須先關閉持久 shell 才能更改權限模式。執行時期 wheel 套件的消費端仍無需安裝 Node；Linux wheel 套件包含一個可執行文件，macOS wheel 套件還包含其私有原生 helper。
