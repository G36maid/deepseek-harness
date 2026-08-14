# Agent Note：Loader 插值條目 `disabled` 欄位

Status: implemented

[English](2026-08-11-loader-entry-disabled-interpolation.md) | [简体中文](2026-08-11-loader-entry-disabled-interpolation.zh.md) | 繁體中文

## 問題

Windows 平臺層（當時是 base patch 旁獨立的 `windows.cordis.patch.yml`，現已折入 base 行——見「決策」）在 win32 上停用 `tool-bash`，但 shipped 預設各自掛載了一行 `tool-bash`。預設行最後組合，同名行在 Windows 上重新啟用了該工具——工作階段同時擁有 `tool-bash`（PowerShell 後端）與 `tool-pwsh`，且是靜默的，因為沒有 spec pin 組合後的預設層。條目元資料沒有條件機制：`!!js` 只在外掛程式 `config` 下插值，[postmortem 0002](../../../../docs/postmortem/0002-js-expression-disabled-filesystem-tools.md) 記錄了 `disabled: !!js ...` 保持真值表達式對象、在所有平臺上停用該行的事故。

## 決策

Loader 插值條目 `disabled` 欄位（`vendor/loader/src/config/entry.ts`）：`!!js` 表達式在每次掛載決策時基於 loader 上下文求值。`disabled` 是唯一被插值的元資料欄位；`id`、`name`、`group`、`inject` 保持靜態。原始節點保留在 options 中，寫回保持 `!!js` 形式。shipped 預設（standard、code、cordis）自己聲明 shell 工具行並按平臺門控——`tool-bash` 攜帶 `disabled: !!js process.platform === 'win32'`，其孿生行 `tool-pwsh` 以取反的表達式——因此預設層每臺宿主恰好暴露一個 shell 工具；web-app overlay 停用兩個工具的 host 行，由每個工作階段的預設決定。`verify-cordis-config` 現在只允許 `disabled` 中的表達式。

該機制補全了平臺層摺疊：base bundle 的 `cordis.patch.yml` 在自身行上按平臺門控兩個 shell 棧——`bash-sandbox`/`tool-bash` 攜帶 `disabled: !!js process.platform === 'win32'`，它們的孿生行 `pwsh-sandbox`/`tool-pwsh` 以取反的表達式僅在 win32 掛載。啟動器的獨立 Windows 平臺層（`windows.cordis.patch.yml` 以及 `apps/cli/src/windows-shell.ts` 及其注入到 boot、live 重組合、config dump 的邏輯）被刪除——該層只因條目元資料是靜態的而存在，`disabled` 可插值後條件就落在它所治理的行上。

## 備選方案

**行上的聲明式 `platform` 欄位。** 靜態且可被閘門檢查，但它是 `!!js` 之外的第二種組合機制，且平臺只是今天的條件。

**預設級平臺 overlay。** 被否：條件應當屬於它所治理的行——同一原則把啟動器獨立的 Windows 平臺層折入 base 行。

## 後果

行可以按平臺或環境門控自身；錯誤的表達式在啟動時響亮失敗。其餘元資料欄位保持字面值，閘門繼續拒絕那裡的表達式——`disabled` 上的 postmortem-0002 隱患以「求值」而非「禁止」關閉。Windows shell 棧的切換從啟動器注入的 patch 層移到 base bundle 自身的行上：win32 掛載受限 pwsh 棧，POSIX 攜帶被停用的 pwsh 行，同一份 patch 文件服務兩種陣容——[Windows 默認 pwsh](../feature/2026-08-01-windows-pwsh-default.md) note 的層機制已被取代。shell 工具行遵循與其他預設聲明行相同的 one-plane 規則：web-app overlay 停用 host 面的 `tool-bash`/`tool-pwsh` 行，預設以互逆的平臺門控聲明兩者，因此任一宿主的每個工作階段都可以按預設丟棄或替換 shell 工具。`minimal` 預設缺失的 win32 PTY 棧是預設元資料的後續工作。
