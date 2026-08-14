# 1. 編寫第一個外掛程式

[English](01-first-plugin.md) | 繁體中文

在本教程使用的 loader 設定中，Cordis 外掛程式模組透過命名匯出提供 `apply` 函式。Cordis 載入模組時，會用一個 **上下文** 呼叫 `apply`；該上下文就是 `ctx` 對象，外掛程式透過它註冊自己貢獻的所有內容。

## 編寫外掛程式

在 `tmp/cordis-tutorial` 目錄中（參見[環境設定](index.md#setup)）建立 `hello.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

`name` 匯出項是選填的顯示元資料；它用於在診斷資訊中標識外掛程式。

## 組合應用

本教程的啟動器透過設定組裝應用。建立 `cordis.yml`：

```yaml
- name: './hello.ts'
```

該文件是一組 Cordis 設定項的清單。`name` 是模組指定符，可以是相對路徑或 NPM 包名；loader 會掛載每個設定項。各項會並行啟動，因此它們在清單中的位置不保證外掛程式的載入先後；順序由服務相依性（`inject`，參見[第 3 章](03-services.md)）決定，而非文件中的位置。

## 執行

```sh
node --import tsx ../../vendor/cordis/bin.js
```

預期輸出：

```
hello from my first plugin
```

當沒有任何內容繼續執行時期，行程會自行退出。具體過程如下：

1. 啟動器建立根 `Context`，並掛載 **Loader** 外掛程式。
2. Loader 讀取 `cordis.yml`，解析 `./hello.ts`，然後將其作為子外掛程式掛載。
3. Cordis 呼叫你的 `apply(ctx)`。

你的文件中沒有框架啟動程式碼：外掛程式描述自己的貢獻，`cordis.yml` 則組合應用。例如，[`dsh` base](../../packages/bundle/base/cordis.patch.yml) 就是一份更長的外掛程式組合，由部署 overlay 對它進行修補。

## 其他兩種外掛程式形態

函式是最常見的形式，但 Cordis 接受三種形式：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

在你需要公開服務之前，請一直使用函式形態；[第 3 章](03-services.md)介紹了何時應當使用類形態。

## 嘗試製造錯誤

讓 `apply` 拋出例外：

```ts ignore-check
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

再次執行：行程會因該錯誤而終止。外掛程式載入失敗會明確報錯，不會僅跳過該設定項。

還需要儘早瞭解一個例外：如果某個設定項的模組無法被 **解析**，例如路徑或包名拼寫錯誤，Cordis 會透過 logger 服務報告錯誤，而不會使行程崩潰。在啟動階段，這條報告可能在 console 匯出器開始觀察之前丟失。如果新增設定項似乎沒有任何效果，請先檢查拼寫。

下一章：[生命週期與 effect](02-lifecycle-and-effects.md)：外掛程式解除安裝時會發生什麼。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
