# @deepseek-ai/dsh-permission-presets

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過 `ctx.permissionPresets`（[`PermissionPresetService`](src/index.ts)）提供面向使用者的權限預設。每個設定名稱都會將 `sandbox/mode` 與 `approval/policy` 組成一組；默認項為 `workspace-write`（`workspace-write` + `ask`）和 `danger-full-access`（`danger-full-access` + `never`）。UI 配接器可以將該表作為單個選擇器公開，而沙盒執行與審批仍分別消費各自的調節項。

`set(session, name)` 會先在僅寫日誌的 `permissionPresets/preset` 事件中記錄已變更的選擇，再僅對實際值發生變化的調節項呼叫 setter。選擇事件先於調節項事件，並在多個預設共享同一組取值時保留使用者意圖；淨變化為零的選擇不會追加任何內容。`current(events)` 優先返回仍與當前調節項匹配的已記錄選擇，其次返回表中第一個匹配項，否則返回 `custom`。用戶端可以把 `custom` 顯示為當前值，但不能選擇它。

該服務擁有 `permissionPresets` Settings namespace。其 `defaultPreset` 是未來工作階段的預設值：組合項使用 `Config.defaultPreset`；省略時，則推斷與組合後的沙盒和審批預設值匹配的 preset。已提交的 Settings 變更會在下一個工作階段建立時讀取；建立過程將 `permissionPresets/preset`、`sandbox/mode` 和 `approval/policy` 固定到該工作階段中，因此後續變更絕不會改變現有工作階段。復原的 seed，包括由 `session/end-seed` 標記的顯式空 seed，都會保留其有效權限，只補齊缺失的持久事實，而不會採用最新的使用者預設值。掛載服務時還會遍歷所有已存活工作階段，因此 HMR（熱模組替換）會固定外掛程式缺席期間建立的所有工作階段。

該服務要求存在具有約束能力的 `ctx.shell` 執行器和 `ctx.approval`。表中名為 `custom` 的條目會在載入時拋出例外。當組合預設值與任何 preset 都不匹配時，外掛程式要求顯式設定 `defaultPreset`；獨立構造的零事件工作階段仍可能推匯出 `custom`。詳見[沙盒切換設計](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

兩個選填子功能在同一服務之上提供產品介面：`permissions` 工作階段投影單元（`src/types.ts` 聲明該 key；單元以組合預設值為基礎摺疊三個全量值可調參數事件，並生成選擇器檢視表，其中包含表內選項和僅作當前值的 `custom`）與 `/permissionPresets` 命令（不帶參數呼叫時報告當前預設與表；預設參數經 `set` 切換）。每個子功能僅在其登錄檔（`ctx.sessionProjections` / `ctx.commands`）被組合時啟用。

## 模型體驗

間接地，透過 `dsh-user-approval` 和 `dsh-tool-bash`：二者會渲染由此服務的可調參數事件所選擇的審批策略提示詞、切換通知和沙盒工具結果；`permissionPresets/preset` 本身只寫入日誌。

#### KV Cache 影響

不會直接使快取失效；具名消費端擁有所有請求前綴變更。

## 已知限制與暫緩事項

- **只組合兩個機制級可調參數**：預設選擇沙盒模式和審批策略；agent（代理）／profile 選擇尚未納入 `PresetSpec`。
- **`custom` 只能推導得出**：呼叫方可以從不匹配的調節項組合切換出去，但無法透過此服務選中或持久化一個名為 custom 的預設。
- **預設表是行程級設定**：設定在外掛程式生命週期內固定；更改可用預設必須重新載入外掛程式。
- **已儲存的預設值必須保留在 preset 表中**：移除被引用的 preset 會導致權限設定註冊失敗，直到更新或重設 `settings.yaml` 中的 `permissionPresets` 分節。
