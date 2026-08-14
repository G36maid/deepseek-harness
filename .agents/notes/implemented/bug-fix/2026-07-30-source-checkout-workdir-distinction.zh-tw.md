# Agent Note: 原始碼 checkout 路徑不定義工作目錄

Status: implemented

[English](2026-07-30-source-checkout-workdir-distinction.md) | 繁體中文

## 問題

`harness:source` 提示詞段遵循[原始碼位置決策](../../archived/feature/2026-07-21-dsh-system-prompt-source-path.md)，但原有措辭把 checkout 稱為「你自己的原始碼」，卻沒有區分該路徑與工作階段 workspace。在 persona 不聲明 `{{cwd}}` 的普通 TUI 設定中，這可能是系統提示詞開頭附近唯一固定的絕對路徑。因此，DeepSeek V4 可能會直接用 harness checkout 回答「what's the workdir?」，而不是確定會話的當前工作目錄。

直接斷言 checkout 不是工作目錄同樣不準確。`dsh meta` 會有意讓原始碼 checkout 同時充當這兩個值。

## 決策

該提示詞段將路徑標識為「DeepSeek Harness implementation checkout」。它說明 checkout 位置與當前工作目錄是兩個可能不同的值，禁止從 checkout 路徑推斷工作目錄，指示模型使用 `pwd`，並限定該 checkout 只用於檢查或擴充 DSH 自身。

路徑推導方式、全域性 `harness:source` 所有權和 `-99` 順序均保持不變。將兩者描述為概念上獨立、而不是始終不相等，使這條指令在普通項目工作階段和 `dsh meta` 中都準確。

## 驗證

`dsh-app-boot` 單元測試固定了完整文字及其順序。CLI（命令列介面）無金鑰 PTY 冒煙測試檢查組裝後的請求 header。TUI 的 `source-checkout-workdir` 快照把該提示詞段掛載為 `/opt/dsh-source`，透過錄制的 DeepSeek V4 turn 提問「what's the workdir?」，並要求重播 transcript（文字記錄）執行 `pwd`，報告生成的 workspace 而不是 checkout。

## 考慮過的替代方案

**聲明 checkout 永遠不是工作目錄。**拒絕：`dsh meta` 會有意讓它們指向同一路徑。

**把當前工作目錄寫入全域性原始碼提示詞段。**拒絕：原始碼提示詞段由 launcher 全域性持有，而工作目錄屬於各個工作階段；將兩者合併會與 agent loop（代理循環）對 `cwd` 的所有權重複，還會讓穩定的原始碼事實隨 agent 變化。

**從提示詞中刪除原始碼路徑。**拒絕：launcher 從無關項目啟動時，自引用 DSH 工具仍需要可靠的 checkout 位置。

## 後果

提示詞會變長，直接詢問工作目錄時可能多花一次廉價的 `pwd` 工具呼叫。作為交換，模型不再把 harness 實作路徑當作隱含的任務 workspace；當 meta 模式使兩個值重合時，提示詞仍然準確。
