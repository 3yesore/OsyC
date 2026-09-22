# 第三方代码与参考出处

本插件以 MIT 分发。下表列出**实际带入本仓**的第三方代码，以及仅供设计参考、未带入代码的上游。

## 带入本仓的第三方代码

| 上游 | 许可证 | 版权 | 位置 | 带入方式 |
|---|---|---|---|---|
| [BCS1037/SmartPick](https://github.com/BCS1037/SmartPick) @ `57022feaabf9aef32bf4ec8ca585de08f5c32bbb` | MIT | Copyright (c) 2026 BCS | `src/osyc/vendored/smartpick-toolbar/` | 按上游实现**改写**选择工具栏的机制层（事件分流、触摸位移判定、关闭守卫、定位数学、iOS 选区还原）；UI 层用 Svelte 重写，未采用上游样式与业务动作。详见该目录 `PROVENANCE.md` |
| [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) | MIT | Copyright (c) 2021 vorotamoroz | 插件主体来源（本仓是它的 fork） | 见仓根 `LICENSE` |

上游 MIT 全文副本随代码放在 `src/osyc/vendored/smartpick-toolbar/LICENSE`。

## 仅供设计参考、未带入任何代码

| 上游 | 许可证 | 用途 |
|---|---|---|
| [nhaouari/obsidian-textgenerator-plugin](https://github.com/nhaouari/obsidian-textgenerator-plugin) | MIT | 对照其 `overlayToolbar-service` 的 CM6 方案；**未采用**（桌面专用且零移动端处理） |
| [uuq007/obsidian-annotation-marker](https://github.com/uuq007/obsidian-annotation-marker) | MIT | 移动端行为参考（真机回归较多）；**未带入代码** |
| [obsidian-power-plugins/obsidian-power-editor](https://github.com/obsidian-power-plugins/obsidian-power-editor) | MIT | 备选路线参考（移动端改覆写原生 `mobileToolbarCommands`）；**未带入代码** |

## 明确未使用

- [logancyang/obsidian-copilot](https://github.com/logancyang/obsidian-copilot)：**AGPL-3.0，未读取、未复制任何代码**。
- `PKM-er/obsidian-editing-toolbar`：**MPL-2.0**，其文件级隔离在打成单文件 `main.js` 后无法保持，因此不采用其源码。
