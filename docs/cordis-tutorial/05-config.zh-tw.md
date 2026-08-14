# 5. 設定

[English](05-config.md) | [简体中文](05-config.zh.md) | 繁體中文

`cordis.yml` 中的每個 Cordis 設定項都可以攜帶 `config` 塊，外掛程式則聲明一個 schema，在執行 `apply` 前驗證該塊。錯誤設定會導致載入失敗，並給出準確的錯誤：外掛程式絕不會在設定不完整時啟動。

## 可設定外掛程式

建立 `config-demo.ts`，並將其放在 `tmp/cordis-tutorial` 中：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'config-demo'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

匯出的 `Config` 既是 TypeScript 介面，也是同名的執行時期 schema：消費端獲得類型，Cordis 獲得驗證器。本倉庫使用 [Schemastery](https://github.com/shigma/schemastery) 定義 schema；Cordis 本身接受任意 [Standard Schema](https://standardschema.dev/) 驗證器，因此將普通對象匯出為 `Config` 無法工作。

對其進行設定：

```yaml
- name: './config-demo.ts'
  config:
    targets: ['alpha', 'beta']
```

執行：

```
Hello, alpha!
Hello, beta!
```

未提供 `greeting`，因此 schema 預設值會將其補齊：`apply` 始終會收到完整且經過驗證的設定。

## 明確報錯

現在向它傳入無效內容：

```yaml
- name: './config-demo.ts'
  config:
    targets: 'not-an-array'
```

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

外掛程式的 fiber 進入 FAILED 狀態，本教程的啟動器列印錯誤後以狀態碼 1 退出。如果某個外掛程式的設定透過了 schema 驗證，但其中指定的資源或提供方不可用，該外掛程式也應當在能解析該引用時立即拒絕。

## 計算得到的設定值

本倉庫使用的 loader 支持 `!!js` 標籤，用於必須在載入時計算的設定值：

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js` 僅在 `config` 與條目 `disabled` 欄位內有效。`disabled: !!js ...` 在每次掛載決策時基於 loader 上下文求值（本倉庫的擴充），可以按平臺或環境門控一行；其餘元資料（`name`、`id`、`inject` 等）保持靜態，其中的表達式是普通真值資料。詳見 [loader 設定](../cordis-primer.md#loader-configuration)。

下一章：[組合與 HMR（熱模組替換）](06-composition-and-hmr.md)：將 `cordis.yml` 視為應用。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
