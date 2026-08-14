# 6. 組合與 HMR（熱模組替換）

[English](06-composition-and-hmr.md) | [简体中文](06-composition-and-hmr.zh.md) | 繁體中文

到目前為止建置的每項能力都是外掛程式，`cordis.yml` 則選擇應用的外掛程式樹。本章會改變這種組合、熱重新載入一個外掛程式，並診斷始終無法載入的外掛程式。

## Cordis 設定項不只有名稱

Cordis 設定項除了 `name` 和 `config`，還接受其他中繼資料：

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

`id` 為 Cordis 設定項提供穩定標識，使 loader 能區分修改現有 Cordis 設定項與先刪除再新增。`disabled: true` 會解除安裝外掛程式而不刪除其 Cordis 設定項；改回原值後，外掛程式以及所有因相依性其服務而處於 PENDING 的外掛程式都會再次載入。

組可以巢狀一份 Cordis 設定項子清單，並將其作為一個單元載入和解除安裝；`isolate` 則為一個組提供某項服務名稱的獨立實例，因此兩個組可以各自看到設定不同的 `shell` 提供方，互不影響。[Cordis 入門](../cordis-primer.md)和[服務隔離示例](../user/develop/framework/service.md#service-isolation)介紹了詳細內容。

## 熱模組替換

解除安裝會釋放 effect（[第 2 章](02-lifecycle-and-effects.md)），載入則遵循相依性關係（[第 3 章](03-services.md)），因此 HMR 可以先解除安裝、再載入，以替換正在執行的外掛程式。`@deepseek-ai/cordis-plugin-hmr` 外掛程式會監視文件，並在保存時執行這一程序。

在 `tmp/cordis-tutorial` 中編寫 `cordis.yml`：

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
- id: hello
  name: './hello.ts'
```

清單中增加了兩個輔助外掛程式：HMR 透過 Cordis logger 服務記錄日誌，因此沒有控制台匯出器時看不到其訊息；它還會 `inject` `timer` 服務來實作去抖，如果沒有 `@deepseek-ai/cordis-plugin-timer`，它就會永遠停在 PENDING，而且不寄出任何提示。下一節就討論這種靜默狀態。

HMR 透過 Loader 的原生輔助工具讀取 Node 的 loader 內部結構。請在 tsx 下執行 Cordis：

```sh
node --import tsx ../../vendor/cordis/bin.js
```

現在編輯 `hello.ts`，修改日誌訊息並保存：

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

舊實例先解除安裝（其所有 effect 都會回捲），新程式碼隨後載入，`apply` 再次執行。按 Ctrl-C 停止行程。編輯 `cordis.yml` 本身也會觸發更新：loader 按 `id` 比較 Cordis 設定項，只掛載、解除安裝或重新設定發生變化的部分。這就是上述 Cordis 設定項顯式攜帶 `id` 的原因：不帶該欄位的 Cordis 設定項在每次讀取時都會獲得一個新生成的 id，所以只要設定檔發生任何編輯，即使自身文字未變，它也會被視為先刪除再新增並重新掛載。

## 診斷始終無法載入的外掛程式

相依性驅動載入也有另一面：如果外掛程式的 `inject` 指定了無人提供的服務，它就會一直等待，不輸出任何內容。這不是錯誤，因為 PENDING 是合法狀態，提供方可能稍後才掛載。

你可以直接查看這些狀態。每個上下文都能枚舉外掛程式登錄檔；建立 `diagnose.ts`：

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

再建立一個相依性無法滿足的外掛程式 `needs-timer.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  console.log('needs-timer loaded')
}
```

```yaml
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

執行它（直接執行 `node --import tsx ../../vendor/cordis/bin.js`，按 Ctrl-C 停止）：

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']` 沒有提供方。向清單新增 `- name: '@deepseek-ai/cordis-plugin-timer'` 後，外掛程式就會載入。如果外掛程式既不執行任何操作，也不報告任何內容，請檢查其 fiber 狀態。不加 PENDING 過濾條件進行迭代時，還會看到 loader 自身的外掛程式（Loader、Include）處於 ACTIVE，因為設定檔本身也是透過外掛程式掛載的。

下一章：[進入 harness](07-into-the-harness.md)：把相同模式用於真實的 harness 服務。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
