# dsh-persona

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

把 agent（代理）人設做成一個可組裝的行：它既可以遮蔽部署級人設，也可以擁有完整系統提示詞。

[`dsh-system-prompt`](../../core/system-prompt/README.md) 以自身設定持有部署級人設，並且無條件註冊該段落，因此一個行程只有一份。[agent preset](../agent-presets/README.md) 無法自行掛載提示詞登錄檔——若沒有屬於自己的行，preset 能改變 agent 的工具，卻永遠改不了它的身份。本包就是那一行。

## 僅限 scope 內使用

在 agent scope 之外掛載本行，會與登錄檔自身的 `deployment:persona` 註冊相撞並明確報錯。這不是需要繞開的限制：部署級人設已經有歸屬，而本行存在的意義正是為某一個 agent 遮蔽它。請把它掛在 preset 組裝內部，由 preset 的掛載過程提供 agent scope。

## 設定

| 欄位 | 預設值 | 含義 |
|---|---|---|
| `text` | 必填 | 作為 `deployment:persona` 段落算繪的人設文字 |
| `complete` | `false` | 組裝後將此人設復原為唯一的系統提示詞段落 |
| `includeRuntimeContext` | `true` | 是否為此 agent 作用域包含動態 runtime-context 快照；false 會抑制所有上下文貢獻，但不停用擁有它們的服務 |

`text` 與任何提示詞段落一樣是樣板：完整的 `{{…}}` 組在提示詞**算繪**時（而非組裝時）嚴格解析為已註冊的提示詞變數。空文字同樣佔據該槽位，因此會把部署級人設整個遮蔽掉，然後在算繪時消失。啟用 `complete: true` 時，組裝仍會解析上下文、工具、變數和協作式監聽器，之後提示詞登錄檔將這份確切人設復原為唯一段落；身份、工具引導或監聽器都無法追加提示詞文字。啟用 `includeRuntimeContext: false` 時，此作用域的上下文提供方不會被求值，組裝監聽器新增的上下文也會被丟棄。

## 模型體驗

### 人設段落

#### What the model sees

位於 order 0 的 `deployment:persona` 段落，緊隨 harness 身份開場白之後，攜帶本行設定的 `text`，其中的提示詞變數已解析。對於其 preset 掛載了本行的 agent，它會替換部署所設定的任何人設。在完整模式下，模型只會看到這個算繪後的段落作為系統提示詞。Runtime context 預設保持啟用。停用後，新建 agent 不會收到來自沙盒策略、批准策略、委派或其他 system-prompt 上下文提供方的 runtime-context 快照。

#### Token effect

對給定 preset 而言是固定的：該 agent 的每次請求都攜帶人設自身的 token，其他 agent 一個都不帶。空文字不貢獻任何 token。完整模式會移除該 agent 的其他所有系統提示詞 token。

#### KV Cache effect

在一個 agent 的整個生命週期內保持前綴穩定——本行只掛載一次，發生在 agent 發布之前、因而也在它的首個請求之前，且在 agent 執行期間文字不再改變。兩個使用不同 preset 的 agent 從該段落起建立各自不同的前綴，誰都無法讓對方失去快取複用。

## 已知限制與暫緩事項

- **不支援全域性掛載** —— 提示詞登錄檔擁有未加 scope 的人設槽位，因此本行只能從帶 scope 的組裝中使用。要改變部署級人設，應在 `system-prompt` 行自身的設定中修改。
