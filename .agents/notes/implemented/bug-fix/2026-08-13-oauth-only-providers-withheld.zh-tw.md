# Agent Note：可設定提供方目錄不再提供僅以 OAuth 認證的提供方

Status: implemented

[English](2026-08-13-oauth-only-providers-withheld.md) | [简体中文](2026-08-13-oauth-only-providers-withheld.zh.md) | 繁體中文

## 問題

模型設定頁把 `openai-codex` 當作普通 pi-ai 路由提供出來，配的還是每個 pi-ai 提供方共用的那句佔位文案：填入 API 金鑰，或留空使用環境認證。照此設定後傳送訊息，本輪以 `Provider is not configured: openai-codex` 失敗，並被配接器歸入兜底的 `PI_AI_ERROR`。

佔位文案所邀請的那種設定姿態在這條路由上不可能工作。pi-ai 的 `resolveProviderAuth` 抵達 OAuth 提供方只有一條路徑——集合的 `CredentialStore` 裡已經存著的憑據——對它沒有任何 ambient 回退；而 `openai-codex` 正是已安裝 catalog 中唯一隻聲明 `auth.oauth`、沒有 `auth.apiKey` 的提供方。`PiAiAdapter.current()` 以不帶參數的 `createModels()` 構造集合，於是用的是 pi-ai 默認的 `InMemoryCredentialStore`：每次啟動都是空的，每次設定變更產生新快照時又重建一份。本倉庫沒有任何位置呼叫 `Models.login()`；pi-ai 庫這一半也不會去讀 Codex 自己的 `~/.codex/auth.json`——它的 OAuth 模組是一套 PKCE 登入流程，憑據由*宿主*應用持久化，這正是 pi CLI 提供、而本配接器沒有提供的東西。

於是頁面用自己佔位文案所描述的「留空」姿態，提供了一個根本沒有「留空」姿態的提供方——而失敗資訊指向的是設定鍵，不是缺失的能力。唯一能讓這條路由完成認證的，是把一個 ChatGPT OAuth token 粘進金鑰框，那既不是這個提供所描述的用法，也會過期且這裡沒有任何環節會去刷新它。

## 決策

目錄只提供本配接器認得的東西。`catalogProviderTakesApiKey(provider)` 回答 pi-ai 為某路由安裝的提供方是否聲明瞭 api-key 方法——這是 harness 唯一能供給的方法，因為它透過自己的憑據 seam 解析金鑰，再作為請求的 `apiKey` 覆蓋交給 pi-ai——`directoryEntries()` 跳過不滿足它的 catalog 路由。

不嘗試實作 OAuth。它需要持久化憑據儲存、登入流程，以及執行登入的介面；這三樣都不是發布阻塞項的修復，而在它們缺席時仍把提供方擺出來，正是這次報告的成因。

兩條邊界把「不提供」的範圍收窄：

- **catalog 成員身份不變。** `catalogProviderIds()` 仍回答 pi-ai 裝了什麼，因此目錄條目上的 `declared` 標記仍然表示「沒有已安裝提供方對應這條路由」，而不是「這條路由不被提供」。
- **聯合的 profile 那一半無條件保留。** settings 文件已經寫過的路由保留條目，因此已儲存的 `openai-codex` profile 仍然可見、可編輯、可刪除，而不會滯留在文件裡、頁面上卻沒有任何入口能移除它。

resolution 未被觸動。在僅 OAuth 的路由上指定 `apiKeyEnv` 的 profile 仍會構造出可用的提供方——`routeAuth` 會在 catalog 的 OAuth 旁邊補上 harness 的 api-key 方法，而 pi-ai 的 Codex API 從 token 本身推導 account id——因此把它寫進 `settings.yaml` 或 `cordis.yml` 的部署保留這條路徑。改為在 `resolveProfiles` 裡強制拒絕會在註冊時就否掉這類 profile；又因為 `validate` 在啟動時與寫入時同樣執行，一份已經寫有無金鑰 OAuth 路由的文件會讓整個 namespace 註冊失敗，而不只是一個提供方失敗。

## 備選方案

- **在 `resolveProfiles` 裡拒絕無金鑰的僅 OAuth 路由。** 這纔是本倉庫通常強制決策的位置，而目錄過濾是一層 `cordis.yml` entry 可以繞過的表面。因上述啟動行為被否決：已儲存的 profile 會連帶拖垮該 namespace 中其他所有路由，對一次發布而言，這是拿一個提供方的缺陷換取全體的缺陷。留下的缺口是：被修的是「提供」而不是「能力」——部署仍可手寫一條頁面上已經無法新增的路由。
- **保留提供，只修正佔位文案。** 那麼該輸入框只能寫「此提供方需要本建置無法執行的登入」，等於一張唯一誠實內容就是「它不能用」的卡片。
- **把 `Provider is not configured` 對映成具名 `LlmError`。** 值得做，而且觸發原因本次改動並未消除——任何留空金鑰、其提供方又在行程環境裡找不到東西的 api-key 路由，都會產生同一句話。作為獨立改動暫緩：它改進的是診斷，而不是移除一個壞掉的提供。
- **把 `~/.codex/auth.json` 讀進 pi-ai 的 `CredentialStore`。** 這能讓 Codex 在沒有登入流程的情況下可用，刷新也由 pi-ai 負責。但它為一個提供方把 harness 綁定到另一個工具的私有檔案格式上，這屬於 OAuth 那項工作的決策，而不是發布期的修復。

## 影響

`openai-codex` 從提供方選擇器、以及模型設定頁所 join 的目錄中消失；其餘已安裝提供方一概不受影響，包括在 api-key 方法*之外*另提供 OAuth 的那六個（`anthropic`、`github-copilot`、`kimi-coding`、`openrouter`、`radius`、`xai`），它們保留條目也保留金鑰路徑。將來若出現只帶 OAuth 的提供方，會被自動排除，而不是靠列名。

兩處相鄰缺口仍在，並記錄在包 README 中：不指定憑據的路由仍走 catalog 提供方自帶的發現，而它只讀行程環境變數——不讀 `~/.aws/credentials`，也不讀 harness 憑據 seam——且由此產生的失敗仍是兜底的 `PI_AI_ERROR`。

## 測試

包測試釘住聯合的兩半：不予提供的路由不出現在 `listConfigurableProviders()` 中，而 `anthropic` 與 `openai` 仍在；已儲存的 `openai-codex` profile 仍產出完整條目且 `declared: false`。既有的 resolution 測試未改動且依然透過，這正是「不提供」沒有收窄手寫 profile 可服務範圍的證據。`models-settings` 與 `onboarding-usable-provider` 兩條 web e2e golden 恰好各少了 `openai-codex` 這一行選項，錄自真實裝配的應用。
