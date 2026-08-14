# @deepseek-ai/node-addon-landlock-run

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用於在 Linux 上限制子行程的 Landlock「先限制自身、再執行」啟動器：此入口包定位對應平臺的預建置二進位檔案，執行功能性強制執行探測，並建置其授權 argv。消費端無需自行拼寫啟動器標志或解析啟動器輸出。

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const launcher = launcherPath();
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'] }), '--', 'bash', '-c', command];
}
```

啟動器在自身上安裝 Landlock 規則集，再 `exec` 被包裝的命令；該規則集會跨 `execve` 繼承，因此整個行程樹都在限制下執行。未授予的一切都被拒絕；啟動器失敗時以 `125` 退出且不執行命令：採用失敗閉合策略，絕不在失敗時放行。二進位約定鎖定在倉庫的 `docs/cli-contract.md` 中；C 原始碼作為 `src/main.c` 隨該 tarball 分發，便於審計。

平臺包（由 `os`/`cpu` 選擇的選填相依性，內部不含 JavaScript）：`@deepseek-ai/node-addon-landlock-run-linux-x64`、`@deepseek-ai/node-addon-landlock-run-linux-arm64`。在缺少對應包的宿主上，`launcherPath()` 返回一個固定但不存在的路徑，`probe()` 報告 `'unusable'`；系統有意不提供安裝時編譯回退。
