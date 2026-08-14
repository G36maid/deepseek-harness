# Agent Note: 把憑據儲存與使用者環境層拆開

Status: implemented

[English](2026-08-04-credentials-yaml-and-user-environment-layer.md) | [简体中文](2026-08-04-credentials-yaml-and-user-environment-layer.zh.md) | 繁體中文

## Problem

`$DSH_HOME/.env` 同時承擔了兩件互不相容的工作。它是 [`credentials-local`](../../../../packages/credentials/credentials-local/README.md) 的可寫金鑰儲存，因此任何表層都不能把它提升進 `process.env`——一旦提升，每個已存金鑰都會讀作只讀的啟動時覆蓋，從而阻斷從 Models 頁輪換金鑰。但它的檔名和 dotenv 格式承諾的是一個環境文件，於是使用者把非機密值放進去，而那些值哪兒也到不了：同一個文件裡，一個能用的 `DEEPSEEK_API_KEY` 旁邊的 `DEEPSEEK_BASE_URL` 會被靜默忽略，因為只有憑據 provider 讀這份文件，而它只尋址憑據引用。

一個文件無法既是由 Harness 擁有並隔離的儲存，又是按普通環境規則傳播的層。[請求級憑據決策](2026-07-29-request-level-llm-config-credentials.md)當初選擇 dotenv 是為了對齊同類產品的 home `.env`，而這種混同直到有非機密值需要用同一個文件時才暴露出來。

## Decision

兩件工作在 Harness home 下拆成兩個文件。

**`.credentials.yaml` 是 provider 管理的儲存。** 一份從 `CredentialRef` 到非空字串的嚴格 YAML 對映，沒有 `version` 欄位，也沒有包裝層：

```yaml
DEEPSEEK_API_KEY: sk-…
OPENAI_API_KEY: sk-…
```

因為該文件只存放憑據、別無他物，任何偏離都是拒絕而不是跳過條目：根節點不是對映、非 POSIX 識別符號的鍵、非字串值、空字串、重複鍵以及格式錯誤的 YAML 全部失敗——啟動時和寫入時響亮失敗，執行期熱重新載入則告警並保留最後可用快照。被靜默忽略的鍵讀起來就是「我存進去的金鑰沒有生效」，而這正是本次變更要消除的失敗。dotenv 物理行編輯器被替換為對已解析文件打修補程式，因此註釋與未觸及條目的排版都會保留，任何字串值都能往返（含多行），也不會再有條目因為缺少可用引號樣式而不可寫。寫鎖、read-modify-write、`0700` 目錄下的 `0600` 原子寫、精確路徑 watcher、按內容相等抑制自寫、以及 dispose 時的完全靜止，均保持不變。

**`$DSH_HOME/.env` 是使用者的普通環境層。** [`dsh-app-boot`](../../../../packages/boot/app-boot/README.md) 中的 `loadLayeredEnv` 先解析呼叫目錄的 `.env`，再解析 Harness home 的，並且只在行程中沒有更高層值時物化每個已接受的值，從而得到 `用户 < 项目 < 继承`。Harness home 在兩個文件載入*之前*就從繼承的環境解析完畢，因此項目 `.env` 無法改變讀取哪份使用者文件。只有產品 CLI（命令列介面）疊加這兩個文件；SDK 與示例 bin 仍透過 `loadEnv` 載入各自的目錄，絕不繼承開發者的 `$DSH_HOME`。

憑據優先級會區分繼承環境與發現的文件：繼承值仍是隻讀的按次覆蓋，其後是受管文件，再後是仍可寫的項目與使用者 `.env` 後備值。因此 `set` 會替換發現文件中的值，而不是因為扁平化的 `process.env` 檢視表認為寫入會被遮蔽就加以拒絕。

不做遷移。已經放在 `$DSH_HOME/.env` 裡的金鑰會繼續作為後備值解析；Models 頁一旦儲存該引用，受管文件就會優先。

## Consequences

- 放棄的：留在 `$DSH_HOME/.env` 裡的金鑰會被物化進 `process.env`，因而會按[子行程憑據清洗](../../../../packages/subprocess/subprocess/README.md)的規則抵達子行程，而不再留在 provider 內部。它仍是 `.credentials.yaml` 之下的可寫後備值；需要由 Harness 擁有並隔離的金鑰屬於受管文件，後者永不物化。
- 換來的：使用者 `.env` 裡的非機密值終於生效，這正是最初的缺陷；文件格式可以拒絕它無法承擔的內容；`0600` 保護的是一個只存金鑰的文件，而不是一個我們同時叫使用者往裡寫普通設定的文件。
- 提供方寫入時使用的 `0600` 同樣約束它讀取的內容：在 POSIX 上，只要文件帶有任何 group 或 other 權限位，就會在學取內容之前讓啟動失敗——啟動時與每次 reload 都檢查，診斷裡給出 `chmod 600` 的修復命令。Windows 沒有可檢查的 mode（其 ACL 無法在此表達），因此跳過該檢查而不是偽造它。
- `0600` 這條邊界仍然只擋其他 OS 使用者、擋不住模型，本次拆分未改變這一點——該限制及 keychain 提供方的延後項歸 [提供方 README](../../../../packages/credentials/credentials-local/README.md) 所有。

## Alternatives considered

**保留單一的 `$DSH_HOME/.env`，讓 CLI 去提升它。** 否決：提升儲存本身正是讓已存金鑰無法輪換的原因，這也是 [app-boot 當初記錄該排除](../../../../packages/boot/app-boot/README.md)的理由。衝突來自這個文件的兩份工作，而不是載入器。

**`$DSH_HOME/.credentials.env`——第二個 dotenv 文件。** 否決：dotenv 適合環境層，卻無法表達「一份按憑據引用索引的受管文件」。它無法拒絕非字串或無法尋址的鍵，而且它的行編輯器本來就會拒絕無法加引號的值，留下可讀卻不可寫的條目。

**給新文件加 `version` 欄位。** 否決：該格式只有一個受 schema 約束的字串 mapping，沒有需要判別的歷史變體。在未發布階段，直接修改結構並拒絕舊結構，好過提前承諾遷移協議。

**首次執行時期把形似憑據的鍵從 `$DSH_HOME/.env` 遷出。** 否決：遷移程式碼會把短命格式變成長期維護面，而判斷一個未知文件裡哪些鍵是金鑰，恰恰是本次拆分要消除的歧義。舊文件繼續作為環境工作，這是誠實的結果，而不是靜默的結果。

**徹底取消使用者 `.env` 層，只保留繼承的環境。** 在此處否決為超出範圍：它本身是自洽的設計（層次更少、每個值只有一處來源），但會移除使用者已有的工作流程，而分層問題屬於那個被延後的優先級決策，不屬於本次拆分。
