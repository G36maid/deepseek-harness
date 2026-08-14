# `@deepseek-ai/dsh-base`

[English](README.md) | 繁體中文

以 profile 組合包形式交付的共享 dsh 核心：[`cordis.patch.yml`](cordis.patch.yml) 在空的 profile 根之上插入全部基礎外掛程式行——模型配接器、共享的 [`agent-default-model`](../../core/agent-default-model/README.md) 選擇、工具、持久化、策略、settings／credentials、遙測與宿主級 subagent provider——作為每個 profile 的 `dsh.profile.bundles` 清單中的第一層。Codex 與 Claude Code provider 以休眠狀態載入；Agent Preset 分別決定自己的 agent 是否貢獻任一面向模型的委派工具。後續的組合包層（例如 [`dsh-web-app`](../web-app/README.md)）和使用者 profile 的 `cordis.patch.yml` 按 id 覆蓋這些行；patch 會替換目標行的整個 `config`，因此模式專屬的值放在各模式組合包中，而不是這裡。該包沒有執行時期 API；profile 組合器透過 manifest（中繼資料清單）的 `dsh.bundle.patch` 欄位解析 patch，絕不透過程式碼。

patch 在自身上按平臺門控兩個 shell 棧：`bash-sandbox`/`tool-bash` 攜帶 `disabled: !!js process.platform === 'win32'`（bash 沒有 Windows runner），它們的孿生行 `pwsh-sandbox`/`tool-pwsh` 以取反的表達式僅在 win32 掛載——同一份 patch 文件，每個宿主恰好掛載一個 shell 棧。權限面與 POSIX 完全一致：`sandbox`/`sandbox-policy` 透過 Windows ACL 受限權杖 runner（`dsh-sandbox-local` 的 win32 鏈 → `@deepseek-ai/dsh-sandbox-windows-acl`）執行文件效果策略，權限切換器與 approval 服務原樣執行，`fs-sandbox` 繼續圍欄 `ctx.fs` 寫入——在其旁再掛載 `dsh-fs-local` 會重複註冊 `ctx.fs` 並在載入時失敗。偏好不受沙盒約束的本機 pwsh 執行器或完整訪問的 Windows 主機透過其 profile 或 home 的 `cordis.patch.yml` 覆蓋這些行（bash 復原配方必須完整：停用 `pwsh-sandbox`/`tool-pwsh` 並重新啟用 `bash-sandbox`/`tool-bash`——兩個執行器家族註冊同一個 `bash` 服務，配方不完整會在載入時直接報錯）。POSIX 主機看到的是被停用的 pwsh 行。

行集合及其設計依據以行內註釋寫在 patch 文件裡；[生成的組合圖](../../../apps/cli/composition.md)負責渲染它。

## 模型體驗

透過插入的行間接產生影響：該組合包選定了隨發行版交付的無 persona 提示詞基座、工具集合與 DeepSeek 配接器，供各模式組合包進一步特化；它自身不貢獻任何模型可見文字。

#### KV Cache 影響

無直接影響；每條插入行的影響由其所屬的包負責。

## 已知限制與暫緩事項

- **patch 會替換整行 `config`**：profile 覆蓋必須重述該行需要保留的每個欄位；不存在深度合併層。
- **Claude SDK 的平臺 CLI（命令列介面）仍在 Profile 安裝閉包中**：base 組合包相依性 Claude 提供方，其生產路徑解析宿主提供的 `claude`；移除 SDK 中未使用的選填載荷，推遲到產品安裝閉包後續項處理。
- **Windows 的臨時目錄授權是按工作階段的私有子目錄**——`workspace-write` 把寫入限制在工作區與工作階段自己的 temp 子目錄（`<temp>\dsh-<hash>`，受限子行程的 TMP/TEMP 被改寫）；`read-only` 不授予任何臨時目錄寫入權限。見 `@deepseek-ai/dsh-sandbox-windows-acl`。
