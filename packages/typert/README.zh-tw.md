# Typert

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Typert 將原始碼分析、執行時期儲存和 Loader 發現機制分離。

| 包 | 職責 | Cordis 鍵 |
|---|---|---|
| [`registry/`](registry/README.md) | 儲存執行時期包反射和 schema | `ctx.typert` |
| [`loader/`](loader/README.md) | 發現 Loader 條目並註冊生成的宿主產物 | 使用 `ctx.loader`、`ctx.typert` |
| [`generator/`](generator/README.md) | 從原始碼類型生成執行時期產物 | 建置時庫 |
