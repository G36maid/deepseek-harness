# 設定模型

[English](providers.md) | [简体中文](providers.zh.md) | 繁體中文

本指南假定你已按照[根 README](../../../README.md#run)啟動 Web UI。模型變更會在下一次請求時生效，不需要重新啟動伺服器。

## 設定 DeepSeek

打開**設定 → 模型**。DeepSeek 卡片提供一個 API 金鑰欄位；輸入金鑰並保存。

![模型頁：DeepSeek 卡片，以及新增提供方與新增自訂提供方兩個入口](providers-models-page.zh.png)

金鑰是隻寫的。保存後，頁面只會收到脫敏描述符，永遠不會收到明文金鑰。金鑰儲存在 `$DSH_HOME/.credentials.yaml` 中，settings 只保留它的憑據引用。

## 新增目錄提供方

選擇**新增提供方**，選取 Anthropic 或 OpenAI 等提供方，輸入其 API 金鑰並保存。已安裝目錄會提供端點、協議和模型清單。

使用原生認證的提供方需要各自的原生憑據。Bedrock、Vertex、Azure 和 Codex 分別使用 AWS 憑據與區域、ADC 項目、`api-version` 和 OAuth；只填寫 API 金鑰欄位無法完成設定。

## 新增自訂提供方

對於公司閘道、自建伺服器或已安裝目錄中不存在的提供方，選擇**新增自訂提供方**。提供小寫 Provider ID、基礎 URL、API 協議、憑據和至少一個模型。

![自訂提供方表單：Provider ID、顯示名稱、API 地址、API 協議、API 金鑰](providers-custom-form.zh.png)

Provider ID 是永久的，因為請求、已保存工作階段、模型預設值和憑據引用都會使用它。如需重新命名提供方，請新增新提供方並刪除舊提供方。顯示名稱、基礎 URL、協議、憑據和模型仍可編輯。

在**模型目錄**中選擇**取得可用模型**，可查詢表單當前顯示的基礎 URL 和憑據。選擇候選項只會更新草稿；保存前不會儲存提供方。目錄提供方使用已安裝目錄，不發起網路請求。

### 圖片輸入

手動輸入的模型在自己聲明之前一律按純文字對待，因為沒有任何環節能去詢問端點接受哪些模態。給這類模型附加圖片，會在傳送前就被拒絕，並點名該模型。

因此自訂提供方下的視覺模型需要加一行。表單沒有對應欄位；請在 `$DSH_HOME/settings.yaml` 中給該模型加上 `input`：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` 接受 `text` 和 `image`，且只作用於該模型，因此一條路由可以同時服務兩類模型。省略它——或寫成空清單，兩者同義——則保留已安裝目錄為該模型記錄的模態；目錄未描述的模型則回退到該路由的 `defaultInput`。

如果你手動錄入的模型全都接受圖片，可以在路由上設定一次回退值，不必逐個模型寫：

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` 是回退值而不是覆蓋值，預設為 `[text]`：在目錄提供方上，它只為目錄未描述的模型作答，因此絕不會把目錄中本就具備圖片能力的模型的該能力去掉。要收窄這類模型，請用它自己的 `input`。目錄提供方沒有可供填寫的 `models` 清單，因此寫在 `modelOverrides` 下，以模型 id 為鍵：

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

除模型自身的清單外，每個清單都至少要寫一項模態；模型自身的空清單與省略它同義。未知模態在任何位置寫入都會被拒絕。

這兩個欄位都是對你端點的斷言，而不是對它的檢查。聲明瞭端點並不提供的圖片能力的模型不會在這裡被攔下，改由提供方拒絕該請求。

## 選擇模型

已設定的提供方會出現在模型選擇器中。選擇模型也會將其設為新工作階段的預設值。已傳送過請求的工作階段會保留自身日誌中記錄的模型。

如果已保存預設值指向已刪除的提供方，輸入框會顯示**選擇模型**，並在選擇其他模型前阻止輸入。

## 排錯

- **`MISSING_CREDENTIAL`**：透過模型頁儲存提供方金鑰，或提供被引用的環境變數。
- **`UNKNOWN_MODEL`**：選擇已設定的模型，或向自訂提供方新增缺失的模型。
- **取得可用模型返回 401**：檢查金鑰。模型發現會呼叫 OpenAI 相容的 `GET /models` 端點；對於不提供該端點的服務，請手動輸入模型。
- **圖片在傳送前被拒絕**：該模型未聲明圖片模態。請給自訂提供方的模型加上 `input: [text, image]`；DeepSeek 自身的 chat-completions 路由是純文字的，且無法透過設定改變。
- **提供方拒絕了帶圖片的請求**：該模型聲明瞭其端點實際並不提供的圖片能力。請從授予它圖片能力的那個清單中移除 `image`——可能是模型的 `input`，也可能是路由的 `defaultInput`——然後開啟新工作階段：附加的圖片會留在工作階段日誌裡，因此在工作階段離開它之前，同一個請求會不斷重複。

## 進階設定

自動生成的[外掛程式設定目錄](../../config-catalog.md)列出所有受支持的欄位與預設值。[`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) 和 [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) 參考文件負責直接 `settings.yaml` 設定、目錄解析、推理控制、憑據與配接器錯誤。
