# @deepseek-ai/node-addon-landlock-run

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個 [Landlock](https://landlock.io/)「先限制自身、再執行」啟動器，用於在 Linux 上限制子行程。它以按平臺預建置的 npm 包以及一個輕量 JS 入口包的形式發布；入口包負責解析二進位檔案並遵循其 CLI（命令列介面）約定。該啟動器面向需要讓不可信命令在檔案系統允許清單約束下執行、同時保持自身不受限制的 agent harness（代理框架）和其他宿主。

該工具是 **`landlock-run`**：一個「先限制自身、再執行」的 [Landlock](https://landlock.io/) 啟動器（基於原始核心 UAPI 編寫，約 300 行 C11，並與 musl 靜態連結）。它在自身上安裝 Landlock 規則集，再 `exec` 被包裝的命令；該規則集會跨 `execve` 繼承，因此命令及其產生的每個行程都在限制下執行，呼叫行程仍不受限制。它採用失敗閉合：如果核心無法強制執行，則不執行命令並直接結束。

## 安裝

```sh
npm install @deepseek-ai/node-addon-landlock-run
```

已發布包由一個入口包和選填平臺包組成：

```text
@deepseek-ai/node-addon-landlock-run
@deepseek-ai/node-addon-landlock-run-linux-x64
@deepseek-ai/node-addon-landlock-run-linux-arm64
```

npm 的 `os`/`cpu` 欄位使安裝器只拉取匹配的平臺包。系統有意不提供安裝時建置回退：在沒有對應平臺包的宿主上，解析後的路徑絕不存在，探測會報告 `unusable`，消費端以失敗閉合方式處理。

## 用法

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const launcher = launcherPath();
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'] }), '--', 'bash', '-c', command];
  // spawn argv with your process runner of choice
}
```

公開 API 有意保持精簡：

- `launcherPath()`：當前宿主啟動器的絕對路徑（有意不檢查是否存在；探測結果纔是可用性訊號）。
- `probe(launcher?, { timeoutMs? })`：功能性強制執行探測，返回 `'full' | 'partial' | 'unusable'`。
- `grantArgs({ readOnly?, readWrite? })`：啟動器的授權 argv；未授予的一切都被拒絕。
- `LAUNCHER_BIN` 和 `LAUNCHER_FAILURE_EXIT`（125）：約定常數。成功完成 exec 的子行程也可能返回 125，因此消費端必須同時看到致命診斷和該狀態，才能將結果歸因為啟動器失敗。

完整的二進位約定（argv 文法、結束碼、報告行）鎖定在 [docs/cli-contract.md](docs/cli-contract.md) 中。

## 支援範圍

支援 linux-x64 和 linux-arm64，且核心已啟用 Landlock（5.13+；ABI 等級決定強制執行為 `full` 還是 `partial`，詳見 [docs/support-matrix.md](docs/support-matrix.md)）。其他平臺有意不提供對應包：消費端會在這些平臺上執行其他限制後端。

## 開發

```sh
corepack enable
pnpm install
pnpm build:ts        # entry packages → lib/
pnpm build:native    # this Linux architecture's binaries (apt-get install musl-tools)
pnpm test
```

二進位檔案被 git 忽略，並且按架構原生建置：本機只建置當前機器的版本，CI 各架構 runner 產出的建置則作為正式發布依據。發布流程詳見 [docs/release.md](docs/release.md)。
