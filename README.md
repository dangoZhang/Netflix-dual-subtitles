Vibe Coding 声明
本脚本由“vibe coding”方式迭代完成：通过GPT-5.2真实使用场景驱动、快速试错、短周期修复与小步改进来提升可用性。
实现策略以稳定性和可维护性优先：脚本不尝试解析或下载字幕文件，也不绕过 DRM；仅在本地页面层面读取 Netflix 已渲染的字幕文本并以覆盖层方式重新排版显示，实现双语同时呈现。
由于 Netflix 前端实现与 DOM 结构可能随时更新，本脚本可能需要后续版本适配。欢迎提交 issue/PR 反馈问题与改进建议。

English version

Vibe Coding Statement
This userscript was developed via “vibe coding” powered by GPT-5.2: rapid, usage-driven iteration with short feedback loops, quick experiments, and incremental fixes to improve real-world usability.
The implementation prioritizes stability and maintainability: it does not download or parse subtitle files, and it does not bypass DRM. Instead, it reads subtitle text already rendered by Netflix on the client and reflows it locally into an overlay to display bilingual subtitles simultaneously.
Because Netflix’s frontend and DOM structure can change at any time, updates may be required for compatibility. Issues/PRs are welcome.