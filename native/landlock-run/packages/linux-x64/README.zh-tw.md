# @deepseek-ai/node-addon-landlock-run-linux-x64

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向 linux-x64 的預建置 `bin/landlock-run` Landlock 啟動器：一個由 [`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run) 包所附的 C 原始碼原生編譯而成的靜態 musl 二進位檔案（不使用交叉工具鏈）。npm 的 `os`/`cpu` 欄位在安裝時選擇此包；入口包將其定位到檔案路徑。該包不包含 JavaScript，也絕不會被匯入。

該二進位檔案被 git 忽略，並透過 `files` 清單進入 npm tarball；如果文件缺失或 ELF 架構錯誤，`prepack` 閘門會拒絕打包，發布管線則會按位元組核驗打包的二進位檔案與其來源 CI 建置產物一致。靜態 musl 連結使同一個二進位檔案同時適用於 glibc 和 musl 發行版，因此名稱中沒有 libc 後綴。

同級包：`@deepseek-ai/node-addon-landlock-run-linux-arm64`。
