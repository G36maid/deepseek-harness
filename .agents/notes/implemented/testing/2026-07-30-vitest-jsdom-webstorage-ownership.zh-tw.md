# Agent Note: 在 Vitest 中將瀏覽器儲存交由 jsdom 管理

Status: implemented

[English](2026-07-30-vitest-jsdom-webstorage-ownership.md) | [简体中文](2026-07-30-vitest-jsdom-webstorage-ownership.zh.md) | 繁體中文

## 問題

受支持的 Node 版本範圍包含會預留行程級 `globalThis.localStorage` 的版本。未設定 `--localstorage-file` 時，Node 26 將該屬性暴露為 `undefined`；Vitest 偵測到這個預留鍵後，不會用 jsdom 的隔離 `Storage` 對象覆蓋該屬性。因此，元件測試套件尚未驗證產品行為便會失敗，而主要的 Node 24 覆蓋率通道仍能透過，因為該執行時期默認不會預留此鍵。

## 決策

當執行時期聲明支持 `--webstorage` 標志時，Vitest worker 會停用 Node 的行程級 Web Storage。設定透過每個測試項目的 `execArgv` 傳入 `--no-webstorage`；未聲明該標志的執行時期則不傳入此參數。因此，Node 環境測試套件不載入瀏覽器環境，而透過 `@vitest-environment jsdom` 選擇 jsdom 的文件會獲得 jsdom 隔離的 `localStorage`。

Node 相容性彙總任務會在每條聲明支持的相容版本線上執行專用的 jsdom 冒煙測試。該測試同時斷言 worker 參數按條件傳入且儲存可用，因此未來 Node 或 Vitest 的變化不會讓主要的 Node 24 測試套件成為唯一偵測訊號。

## 曾考慮的替代方案

- **在包指令碼或 CI 中設定 `NODE_OPTIONS=--no-webstorage`。** 否決：這會將測試執行器策略傳播到子行程，也無法覆蓋直接呼叫 `pnpm exec vitest` 的情況。
- **向 Node 傳入 `--localstorage-file`。** 否決：單個行程級持久化儲存與每個 jsdom 環境分別建立的瀏覽器儲存具有不同的歸屬和隔離語義。
- **在初始化程式碼中修改 `globalThis.localStorage`，或為每個元件測試增加保護邏輯。** 否決：初始化邏輯會相依性 Vitest 私有的 jsdom 對映細節，而逐測試新增的保護邏輯會掩蓋瀏覽器環境損壞，並在多個測試套件中重複該策略。
- **將測試固定在 Node 24。** 否決：包的引擎範圍聲明支持更新的偶數 Node 版本線，而相容性矩陣正是為了暴露這些版本的執行時期變化。

## 後果

同一條 `pnpm test` 命令在有無內建 Web Storage 的 Node 版本上均可執行。測試 worker 被有意禁止使用 Node 的行程級 Web Storage；未來若產品需要該 API，必須使用獨立且顯式的測試設定，而不能削弱 jsdom 隔離。相容性通道只增加一個專項 Vitest 行程，無需在每個 Node 版本上重複整套單元測試。
