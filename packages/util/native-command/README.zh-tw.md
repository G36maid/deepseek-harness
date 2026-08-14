# dsh-native-command

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

宿主原生 OS 整合共享的**零相依性免 shell `execFile` 執行器**：一次 `runNativeCommand(command, args, signal)` 呼叫直接 spawn 可執行文件（絕不拼 shell 字串），以 utf8 捕獲 stdout/stderr，把呼叫方的 abort 傳播為子行程終止，並在 Windows 上隱藏瞬時控制台視窗。失敗時，呼叫會以錯誤拒絕；該錯誤附帶退出 `code` 與兩路已捕獲輸出，呼叫方無需重跑即可分類（工具缺失、已取消、真實失敗）。

它的兩個消費端都是宿主側原生整合：[`directory-picker-native`](../../host/directory-picker-native/README.md) 後端的 OS 選擇器命令，以及閘道將路徑交由默認應用打開的操作（[`dsh-host-apiproxy`](../../host/apiproxy/README.md) 的 `host.openPath`）。`NativeCommandRunner` 類型是這些呼叫方的可注入命令邊界。

它是**庫，不是服務或外掛程式**：沒有 `ctx`、不註冊任何東西、不持有狀態、不發事件。

## 介面面

```ts
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
```

## 模型體驗

無；這是宿主側子行程管道，這裡沒有任何東西進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **不做輸出限量**——兩路流在記憶體中無界緩衝；當前每個呼叫方只執行輸出為一個路徑或一行錯誤的小型原生工具。把它指向輸出量可觀的命令之前，先接入 `dsh-output-retention` 限量。
