# Netflix Dual Subtitles

Netflix 双语字幕扩展与用户脚本。

这个项目不会下载字幕文件，也不会绕过 DRM。它只是在 Netflix 页面中读取已经渲染出来的字幕文本，再用本地覆盖层把两条字幕轨同时排版显示出来，用来实现双语字幕效果。

## 功能特点

- 支持双语字幕同时显示
- 支持 `Chrome`、`Edge`、`Firefox`、`Safari`
- 支持一键安装用户脚本
- 提供 `Chromium` 与 `Firefox` 扩展版本
- 提供页内设置面板，不再依赖脚本管理器菜单
- 支持热键 `Alt + Shift + D`
- 支持 Netflix 单页应用路由切换与自动续播场景

## 浏览器支持

| 浏览器 | 安装方式 | 状态 |
| --- | --- | --- |
| Chrome | `Tampermonkey` / `Violentmonkey` / 加载扩展 | 支持 |
| Edge | `Tampermonkey` / `Violentmonkey` / 加载扩展 | 支持 |
| Firefox | `Tampermonkey` / `Violentmonkey` / 加载扩展 | 支持 |
| Safari | `Tampermonkey` | 支持 |

## 安装

### 方式一：一键安装用户脚本

适合大多数用户，安装最快。

1. 先安装脚本管理器：
   - Chrome / Edge / Safari 推荐 `Tampermonkey`
   - Chrome / Edge / Firefox 也可使用 `Violentmonkey`
2. 打开下面的原始脚本地址并确认安装：

[点击安装 `Netflix-dual-subtitles.user.js`](https://raw.githubusercontent.com/dangoZhang/Netflix-dual-subtitles/main/Netflix-dual-subtitles.user.js)

### 方式二：加载浏览器扩展

如果你更希望使用原生扩展形式：

- `Chromium` 内核浏览器请加载 [`dist/chromium`](./dist/chromium)
- `Firefox` 请加载 [`dist/firefox`](./dist/firefox)

本地重新生成发布产物：

```bash
npm run build
```

## 使用方法

1. 安装用户脚本或扩展
2. 打开任意 Netflix 播放页
3. 在 Netflix 播放器里先开启一次字幕
4. 点击页面右上角的 `Dual Subtitles` 按钮，或按下 `Alt + Shift + D`
5. 在设置面板中选择上行字幕和下行字幕
6. 点击 `Save & Restart`

之后脚本会在播放器区域维持一个双语字幕覆盖层；当 Netflix 切换剧集、自动播放下一集或发生 SPA 路由跳转时，会自动重新挂载。

## v6 更新内容

- 重构为共享核心运行时，同时服务用户脚本与扩展版本
- 新增 `Chromium` / `Firefox` 扩展构建产物
- 根目录保留 `Netflix-dual-subtitles.user.js`，方便直接通过 GitHub Raw 一键安装
- 将原本依赖脚本管理器菜单的设置流程改为页内设置面板
- 优化字幕轨匹配逻辑，优先选择更合适的 `PRIMARY` 字幕轨
- 停止双语字幕时会恢复原始 Netflix 字幕轨

## 项目结构

- `src/core.js`
  共享核心逻辑，包含字幕采样、覆盖层渲染、设置面板、自动重连等能力
- `src/extension/content-script.js`
  扩展注入桥接脚本
- `src/extension/popup.html`
  扩展弹窗页面
- `scripts/build.mjs`
  构建脚本，用于生成用户脚本和浏览器扩展产物
- `Netflix-dual-subtitles.user.js`
  根目录发布版用户脚本
- `dist/chromium`
  Chrome / Edge / Brave 等浏览器可直接加载的扩展目录
- `dist/firefox`
  Firefox 扩展目录

## 验证情况

- `2026-03-16`：`npm run build` 已通过，用户脚本与两个扩展目录均可正常生成
- `2026-03-16`：已在真实 `netflix.com` 页面验证扩展注入、浮动按钮挂载与覆盖层显示逻辑
- `2026-03-17`：播放渲染能力沿用上一版已验证可用的实现策略，本次更新主要集中在跨浏览器分发、安装体验与设置界面

## 开发

```bash
npm run build
```

这个项目不依赖打包器；构建脚本会直接生成：

- 根目录发布用用户脚本
- `dist/chromium`
- `dist/firefox`

## 实现原则

- 不下载字幕文件
- 不绕过 DRM
- 不依赖网络拦截
- 只重排 Netflix 已经在页面中渲染出的字幕文本

## English Summary

Netflix bilingual subtitle overlay for Netflix playback pages.
This repo ships a one-click userscript plus Chromium and Firefox extension builds.
