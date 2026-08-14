# Agent Note: 已交付組閤中的默認 Web 搜尋

Status: implemented

[English](2026-07-31-web-default-search.md) | [简体中文](2026-07-31-web-default-search.zh.md) | 繁體中文

## 問題

該 harness 已具備完整的 Web 能力體系：提供方登錄檔、DeepSeek、Exa 和 Perplexity 搜尋提供方、本機抓取、穩定的面向模型工具，以及結構化結果呈現，但已交付的 `dsh web` 組合沒有掛載其中任何一項。除非部署提供自訂覆蓋層，否則模型無法發現最新資訊。僅掛載現有 DeepSeek 提供方仍無法打通 WebUI 鏈路：Models 頁面透過 `ctx.credentials` 儲存 `DEEPSEEK_API_KEY`，而搜尋提供方只會在外掛程式載入時固定讀取行程環境，因此在執行中的 UI 輸入或輪換的金鑰無法用於搜尋。

## 決策

`apps/cli/config/base.cordis.yml` 明確掛載 `dsh-web`，設定 `searchProvider: deepseek-official`，同時掛載 `dsh-web-search-deepseek`，並以 `fetch: false` 和 `searchTimeoutMs: 60000` 掛載 `dsh-tool-web`。它不掛載 `dsh-web-fetch-http`，也不選擇抓取提供方。共享 base 只將 `web_search` 設為 TUI、瀏覽器與無頭工作階段的默認工具。顯式搜尋提供方 id 使選擇不受註冊順序影響，同時個人覆蓋層或 `--config` 覆蓋層仍可替換或停用這些設定項。已交付的一分鐘預算用於覆蓋一次輔助 DeepSeek Messages 請求及伺服器端檢索，同時保持 `dsh-tool-web` 提供方無關的 30 秒預設值不變，以供自訂組合使用。

DeepSeek 搜尋使用與官方工作階段配接器相同的 `DEEPSEEK_API_KEY` 憑據引用。提供方在每次搜尋內部透過選填的 `ctx.credentials` 服務解析該引用；只有未掛載該 seam 的組合才會回退到啟動行程的環境變數，非空的 `apiKey` 字面值仍作為程序化設定的最後兜底。因此，由 Web 的 Models 頁儲存或輪換的金鑰無需重新啟動即可用於下一次搜尋，提供方也無需保留該值。由於 `WebSearchProvider.available()` 是同步方法，它會將已安裝解析器視為本機可用；若動態憑據缺失，操作會以提供方專屬錯誤碼 `WEB_PROVIDER_CREDENTIAL_MISSING` 失敗，而穩定的工具 schema 仍保持註冊。

搜尋端點與 chat completions 保持獨立：`DEEPSEEK_SEARCH_BASE_URL` 覆蓋 Anthropic 相容基址，`DEEPSEEK_BASE_URL` 則繼續設定工作階段請求。每次 `web_search` 都會發起一次輔助 DeepSeek Messages 呼叫，並攜帶原生搜尋伺服器工具。寄出請求前一刻，提供方會向發起請求的 agent（代理）工作階段追加僅用於日誌的 LLM（大型語言模型）請求事件 `web/deepseek-search-llm-request`，其中包含已解析端點、API 版本，以及不含金鑰的精確 JSON 請求體。憑據預檢仍留在提供方內部，並與呼叫方取消存在競態；這兩項關注點都不會擴充通用 Web seam 或憑據 seam。

默認掛載不會建立 Web 專用權限策略。`web_search` 在 bash／檔案系統沙盒及審批預設之外執行，並遵循 `dsh-tool-web` 的現有約定。組合不掛載 `web_fetch` 或本機抓取提供方，因此預設配置不會允許模型自行選擇任意 URL 進行抓取。已交付的 `workspace-write` 預設值只管轄文件修改；若產品採取受限網路策略，就需要新增 `tools/pre-execute` 策略或按能力限制網路訪問，而不能暗示檔案系統訪問模式會管轄 Web 呼叫。

## 考慮過的替代方案

**僅掛載 `dsh-tool-web`。** 不予採納：穩定的 schema 如果沒有已註冊提供方，每次默認呼叫都會失敗。啟用狀態與後端可用性刻意分離，但已交付的預設配置必須提供其預期實作。

**從 `cordis.yml` 讀取 `$DSH_HOME/.env`，或將其提升到 `process.env`。** 不予採納：憑據提供方擁有該文件，環境變數值是隻讀覆蓋；提升後儲存的金鑰將無法輪換，還會繞過經審計的金鑰邊界。

**在提供方載入時固定讀取 `process.env.DEEPSEEK_API_KEY`。** 不予採納：Web Models 頁面透過 `ctx.credentials` 寫入金鑰；產品文件規定的首次執行路徑必須保證下一次操作無需重新啟動即可生效。

**將 Web 工具保留在 `web.cordis.yml` 中。** 不予採納：這會保留 TUI 與 Web／無頭介面之間無法解釋的工具清單差異。這些設定行並非介面特有，因此其唯一歸屬是 `base.cordis.yml`；[工具清單決策](2026-07-31-even-out-shipped-tool-rosters.md)記錄了這一共享組合。

**提高 `dsh-tool-web` 的提供方無關逾時。** 不予採納：自訂提供方和部署有各自不同的延遲預期；這一部署預算應歸已交付的 DeepSeek 組合所有。

**同時啟用搜尋和抓取。** 不予採納：預設啟用 `web_fetch` 會允許模型自行選擇任意 URL，執行匿名出站 HTTP(S) 抓取。搜尋負責發現資訊；接受更廣泛抓取範圍的部署可以在覆蓋層中選擇啟用 `dsh-web-fetch-http`，並將 `dsh-tool-web` 的 `fetch` 選項設為 `true`。

## 後果

每個已交付介面的原生模型請求都只會攜帶 `web_search` schema，以及僅用於搜尋的提示詞指引；Web／無頭 Code Mode 透過 `run_code` 公開相同的搜尋能力。該提示詞要求模型使用返回的 snippet，且絕不會向模型提及已停用的 `web_fetch` 工具。搜尋會增加一次完整的輔助模型呼叫，並可能多次使用原生伺服器工具；發起工作階段的日誌仍可精確重建其不含金鑰的請求。預設配置會提供搜尋結果 snippet 與來源元資料，但不支持任意頁面抓取；需要抓取完整頁面的部署必須自行選擇啟用抓取。Web 快照通道會啟動已交付設定樹，使用本機 Messages fixture（測試前置資料），經由真實 DeepSeek 提供方驅動一次重播的 `web_search` 呼叫，斷言持久化的輔助請求與結構化結果，並固定最終瀏覽器呈現。TUI/Web 組合冒煙測試固定了共享的 `web_search` 清單及不提供 `web_fetch` 這一事實；建置後組合設定的轉儲固定了已交付的一分鐘搜尋預算；提供方測試固定缺失、已儲存及已輪換憑據的行為，以及字面值與環境變數的相容性。
