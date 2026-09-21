# KAN-49 界面审计的证据（2026-09-21）

**这里不是业务原件。** `docs/reference/README.md` 说明的是「用户提供的原始业务资料」，
本目录是 KAN-49 自己产出的审计证据，两者别混。目录里全部为合成演示数据的界面截图与扫描结果，
不含任何真实人员或业主资料。

## 内容

| 文件 | 是什么 |
|---|---|
| `before/scan-*.json` `after/scan-*.json` | `scripts/ui_color_scan.js` 采到的去重色值与出现次数 |
| `before/overflow.json` | 6 条路由 × 375/390/430 的 `scrollWidth`/`clientWidth` 实测 |
| `before/*.png` `after/*.png` | 工作台与项目总览在 375px 下的改前改后对照 |

## 基线（改前改后必须一致，否则不可对照）

`actor=负责人`、Dashboard 布局 localStorage key 清空走默认、同一份演示数据。
`reviewTags` 改前是 `on`（当时的默认），改后分两种都测：默认（关）与 `on`（开会态）。

## 怎么复算

```bash
node --experimental-strip-types scripts/ui_color_report.ts docs/reference/ui-audit-2026-09-21/before
node --experimental-strip-types scripts/ui_color_report.ts docs/reference/ui-audit-2026-09-21/after
```

判定规则在 `frontend/src/lib/colorPolicy.ts`，有单测；口径见 `docs/界面风格与AWS对照.md` 第 2 节。

## 一条必须带着的限制

截图与宽度测量都是**桌面 Chrome 模拟**（同源 iframe 精确控宽），按 `AGENTS.md:57`
不得冒充真机。真机未验证项见审计文档第 7 节。
