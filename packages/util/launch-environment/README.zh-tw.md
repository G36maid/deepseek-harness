# dsh-launch-environment

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

把本次執行的環境凍結為一份不可變快照，並記住**每個值來自哪一層**。消費端用它而不是 `process.env` 解析面向使用者的值，因為各層的可信程度並不相同，而壓平後的檢視表無法區分它們。

| 層 | 來源 id | 它是什麼 |
|---|---|---|
| 繼承的行程環境 | `process` | 啟動 shell、CI 任務或容器傳入的東西——本次執行的明確意圖 |
| `<invocation cwd>/.env` | `project-env` | harness 被啟動於其中的項目；產品信任它設定自己的 agent（代理） |
| `$DSH_HOME/.env` | `user-env` | 使用者自己的機器級預設值 |

這些值同樣會進入 `process.env`——使用者自己的 `--config` 樹和第三方庫要讀它——但那份壓平的檢視表不是 harness 解析任何值的依據。

## 解析

`get(name)` 按可信度從高到低搜尋所有層。`getFrom(name, sources)` 只搜尋指定的層，不改變這一可信順序。

**省略某一層是拒絕，不是降級**——絕不能接受某一層的呼叫方直接不把它列進去，後續任何重新排序都無法讓它回來。提供方配接器三層全列，因為產品信任它所執行的項目；該機制是為那些「並非如此」的決策準備的。

變數名按平臺自身的規則匹配：POSIX 上精確匹配，Windows 上不區分大小寫。在 Windows 上做大小寫敏感的尋找會選錯層——shell 裡的 `deepseek_api_key` 與項目 `.env` 裡的 `DEEPSEEK_API_KEY` 對作業系統而言是同一個變數，把它們當成兩個就會讓項目勝出。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

declare const ctx: Context
const endpoint = launchEnvironmentOf(ctx).get('DEEPSEEK_BASE_URL')?.value
```

當產品 CLI（命令列介面）啟動了這棵樹時，`launchEnvironmentOf(ctx)` 返回啟動器的快照；否則返回只含繼承環境的那一層。該回退並不削弱規則：SDK 宿主或裸 `cordis.yml` 從未發現過任何文件，因此它擁有的一切確實就是它被啟動時的環境。

## 已知限制與暫緩事項

- **快照不是子行程邊界**：每一層同樣會被物化進 `process.env`，因此項目裡的普通變數會按 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 的清洗規則抵達子行程。產品啟動器的 [`.env` 約定](../../boot/app-boot/README.md#profiles) 會在物化之前拒絕 bootstrap 變數。
- **沒有按工作區劃分的層**：項目層是*呼叫*目錄，在啟動時固定。之後在 Web UI 中選擇的工作區不貢獻任何內容，這是刻意的：跟隨它等於讓模型自己的工作區在工作階段中途改變 harness 的環境。
