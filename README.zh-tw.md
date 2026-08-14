# DeepSeek Harness

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 開發的開源 agent harness（代理框架）。

它採用**一切皆外掛程式**的架構，並由 [Cordis](https://github.com/cordiverse/cordis) 驅動，其設計參見論文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 開發者預覽

DeepSeek Harness 目前處於 _開發者預覽_ 階段，正在快速迭代。**未來將出現破壞相容性的變更。**

## 執行

### 透過 `npm` 執行

安裝 `Node.js`，然後執行：

```sh
npx @deepseek-ai/dsh web
```

該命令會啟動 Web UI，默認地址為 `http://127.0.0.1:3080`。詳見 [Web UI 指南](docs/user/guide/index.md)。

### 從原始碼執行

如需從倉庫原始碼執行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 社區與支持

- 歡迎透過 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交回饋或 bug 報告。
- 為你的外掛程式倉庫新增 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 話題，便於被發現。
- 歡迎加入 DeepSeek Harness 企微羣：掃描 QR Code新增企微小助手並填寫入羣問卷，完成後小助手會邀請你入羣。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入羣問卷</th>
      <th align="center">微信公眾號</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手QR Code" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入羣問卷QR Code" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 團隊微信公眾號QR Code" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 參與貢獻

參見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 開發

請先閱讀[開發指南](docs/development.md)與[架構文件](docs/architecture.md)。

面向 agent：請遵循 [AGENTS.md](AGENTS.md)。

## 授權條款

[MIT](LICENSE)

第三方相依性及其授權條款見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
