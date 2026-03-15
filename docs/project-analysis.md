# OpenLens 项目分析与设计文档

> 本文档记录了项目立项前的完整分析过程，包括技术选型、方案对比、架构设计和规范约束。

---

## 一、项目背景与目标

将收集的行业研究报告（PDF为主，未来扩展到其他格式）通过 AI 分析提炼后，以结构化 Markdown 形式发布到 GitHub Pages 上，形成可检索、可浏览的知识库。

### 核心需求

- 定期收集行业报告 PDF
- AI 读取分析 PDF，生成结构化摘要（标题、分类、标签、关键数据、核心结论）
- 以静态网站形式发布到 GitHub Pages
- 原始 PDF 提供下载
- 分类和标签基于 AI 分析报告内容自动生成，而非人工手动分类
- 未来支持更多文件格式（MD/DOCX/Excel 等）

---

## 二、PDF 转 Markdown 可行性分析

### 结论：视觉密集型报告不适合全文转换

通过实际查看一份 34 页的 AI 玩具报告（艺恩出品），发现以下问题：

- 大量图表（柱状图、饼图、气泡图、趋势线）— 转换后只剩数字碎片
- 精心设计的排版（三分格局图、功能矩阵图）— 转换后结构全部丢失
- 产品实拍图、品牌 logo、社媒截图 — 转换后要么丢失要么变成无上下文的图片
- 装饰性视觉元素（星星、卡通形象）— 转换后变成噪音

### Marker 工具评估

| 维度 | 评估 |
|------|------|
| 功能 | PDF/图片/PPTX/DOCX -> Markdown/JSON/HTML，GitHub 32.5k stars |
| 本地模型 | **需要**。底层用 Surya 做 OCR/布局检测，需要 PyTorch + 模型文件 |
| 硬件要求 | 建议 GPU（CUDA），CPU 也能跑但很慢；macOS 支持 MPS 加速 |
| 中文支持 | 支持，但中文排版复杂的报告效果一般 |
| 表格/图表 | 简单表格可以，复杂图表（如气泡图、趋势图）基本不可用 |
| 依赖体积 | Python 3.10+ + PyTorch + Surya 模型，环境占数 GB |
| **结论** | **适合文字密集型文档（论文、书籍），不适合视觉密集的行业报告** |

---

## 三、方案对比

### 方案 A：PDF 全文转 Markdown

| 优点 | 缺点 |
|------|------|
| 信息完整 | 图表丢失，排版崩溃 |
| 可被搜索引擎索引 | 转换质量不稳定，每份 PDF 都需人工校对 |
| 纯 Markdown 生态友好 | 维护成本极高 |
| | 读者体验差：不如直接看 PDF |

### 方案 B：AI 摘要 + PDF 原文下载

| 优点 | 缺点 |
|------|------|
| 阅读效率极高 | 需要对每份 PDF 做一次 AI 分析 |
| 保留了 PDF 原始品质 | AI 可能遗漏某些细节 |
| 维护成本低 | |
| 搜索引擎可索引摘要 | |
| 读者体验好：先快速了解，感兴趣再下载 | |

### 方案 C（最终采用）：结构化知识卡片 + PDF 原文

在方案 B 基础上的升级：

- 每份 PDF 对应一个 Markdown 页面
- 包含标准化结构：报告概览、关键数据、核心结论、行业图谱、原文下载
- 分类和标签由 AI 基于内容自动生成
- PDF 放在静态资源目录供下载

**核心思路：不追求"复刻 PDF"，而是"提炼价值 + 保留原始"。**

---

## 四、静态站点框架选型

### 候选框架对比

| 维度 | VitePress | Astro | Hugo | Docusaurus |
|------|-----------|-------|------|------------|
| 定位 | 技术文档 | 内容网站 | 通用静态站 | 开源项目文档 |
| 构建速度 | 快 | 快 | 极快 | 慢 |
| 学习曲线 | 低 | 中 | 中 | 中 |
| Markdown 扩展 | Vue 组件 | MDX/组件 | shortcode | MDX/React |
| 中文支持 | 好 | 好 | 好 | 好 |
| 自定义灵活度 | 中 | **高** | 中 | 中 |
| 分类/标签系统 | 弱（需手搭） | **强（Content Collections）** | 强 | 中 |
| GitHub Pages | 支持 | 支持 | 支持 | 支持 |

### 最终选择：Astro

核心理由：

1. **Content Collections** — 内置内容管理能力，Schema 验证 + TypeScript 类型安全，保证每篇内容质量一致
2. **高度灵活** — 不是纯文档框架的限制，可以自由定义页面结构和组件
3. **Islands 架构** — 默认零 JS，性能极佳，符合知识库类站点需求
4. **内容驱动设计** — Astro 官方定位就是"内容驱动网站"的框架
5. **扩展性强** — 未来想加交互组件（如 PDF 预览、数据可视化）可以按需引入 React/Vue

---

## 五、Astro 核心概念速览

### 心智模型

```
你写的东西                    Astro 做的事                  最终产出
─────────                  ──────────                 ────────
Markdown 文件(.md)     -->   读取 frontmatter 元数据   -->   静态 HTML 页面
Astro 组件(.astro)     -->   服务端渲染组件            -->   静态 HTML 片段
public/ 下的文件        -->   原封不动复制              -->   /pdf/xxx.pdf
```

### 6 个核心概念

1. **文件路由** — `src/pages/` 下的文件路径 = URL 路径，没有额外路由配置
2. **Content Collections** — 定义内容 Schema，保证 frontmatter 格式一致，提供查询 API
3. **Frontmatter** — 每篇 Markdown 头部的 YAML 元数据（标题、分类、标签等）
4. **`.astro` 组件** — 上半部分写 JS/TS（构建时执行），下半部分写 HTML 模板
5. **Layouts** — 页面共享的外壳模板，通过 `<slot />` 插入内容
6. **`public/` 目录** — 存放 PDF 等静态文件，不经处理原封不动复制到最终网站

### 开发命令

```bash
npm create astro@latest    # 创建项目
npm run dev                # 启动开发服务器 localhost:4321
npm run build              # 构建静态网站到 dist/
```

---

## 六、项目目录结构

```
openlens/
│
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Pages 自动部署
│
├── docs/                           # 项目规划和文档（非 Astro 内容，不参与构建）
│   ├── project-analysis.md         # 本文档：项目分析与设计
│   ├── architecture.opml           # 项目架构思维导图
│   ├── taxonomy.opml               # 分类体系思维导图
│   ├── workflow.opml               # 工作流思维导图
│   └── roadmap.opml                # 发展路线图
│
├── inbox/                          # 原始资源投递目录（.gitignore，不进 Git）
│   ├── pdf/                        # 待处理的 PDF 文件
│   ├── md/                         # 待处理的 Markdown 文件
│   ├── docx/                       # 待处理的 Word 文件
│   └── xlsx/                       # 待处理的 Excel 文件
│
├── public/
│   ├── pdf/                        # 已处理的 PDF 文件（英文 slug 命名，进 Git）
│   │   ├── ai-toy-market-2026.pdf
│   │   ├── roland-berger-china-2026.pdf
│   │   └── ...
│   └── favicon.svg
│
├── src/
│   ├── content/
│   │   └── reports/                # 所有报告 Markdown（Content Collection）
│   │       ├── ai-toy-market-2026.md
│   │       ├── embodied-intelligence-2026.md
│   │       └── ...
│   │
│   ├── pages/
│   │   ├── index.astro             # 首页：报告列表
│   │   ├── reports/
│   │   │   └── [...slug].astro     # 单篇报告页面（动态路由）
│   │   ├── categories/
│   │   │   └── [category].astro    # 分类页面（动态路由）
│   │   └── tags/
│   │       └── [tag].astro         # 标签页面（动态路由）
│   │
│   ├── layouts/
│   │   ├── BaseLayout.astro        # 基础 HTML 外壳
│   │   └── ReportLayout.astro      # 报告详情页布局
│   │
│   ├── components/
│   │   ├── ReportCard.astro        # 报告卡片组件
│   │   ├── TagList.astro           # 标签列表组件
│   │   ├── CategoryNav.astro       # 分类导航组件
│   │   ├── PdfDownload.astro       # PDF 下载按钮组件
│   │   └── KeyDataTable.astro      # 关键数据表格组件
│   │
│   ├── styles/
│   │   └── global.css              # 全局样式
│   │
│   └── content.config.ts           # Content Collection Schema 定义
│
├── scripts/                        # 工具脚本（验证、处理等）
│   └── validate.ts                 # 校验标签一致性、PDF 文件是否存在等
│
├── .claude.md                      # Claude Code 项目规范
├── .gitignore                      # inbox/ 和 node_modules/ 等
├── astro.config.mjs                # Astro 配置
├── package.json
├── tsconfig.json
└── README.md
```

### 关键设计决策

- **PDF 用英文 slug 命名**：URL 友好、Git 友好、跨平台兼容
- **Markdown 文件名和 PDF 文件名保持一致**：`ai-toy-market-2026.md` 对应 `ai-toy-market-2026.pdf`
- **不用文件系统做分类**：分类信息放在 frontmatter 的 `category` 字段里，一篇报告可以改分类而不用移动文件
- **OPML 放 `docs/` 目录**：项目级规划物料，不参与 Astro 构建，不会被部署到网站
- **inbox 加入 .gitignore**：临时中转站，处理完即弃，不进 Git 历史
- **scripts 目录独立存放**：工具脚本与 Astro 源码分离，职责清晰

---

## 七、Content Collection Schema 设计

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const CATEGORIES = [
  '人工智能',
  '消费科技',
  '前沿趋势',
  '投资研究',
  '产业研究',
  '技术深度',
] as const;

const reports = defineCollection({
  loader: glob({ base: './src/content/reports', pattern: '**/*.md' }),
  schema: z.object({
    // === 基础信息 ===
    title: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    source: z.string(),
    date: z.coerce.date(),
    pageCount: z.number().int().positive().optional(),

    // === 分类与标签 ===
    category: z.enum(CATEGORIES),
    tags: z.array(z.string()).min(1).max(8),

    // === AI 生成的结构化摘要 ===
    summary: z.string().min(10).max(300),
    keyFindings: z.array(z.string()).min(1).max(6),
    keyData: z.array(z.object({
      metric: z.string(),
      value: z.string(),
      note: z.string().optional(),
    })).optional(),

    // === 资源链接 ===
    pdf: z.string().startsWith('/pdf/'),
    cover: z.string().optional(),

    // === 元信息 ===
    draft: z.boolean().default(false),
  }),
});

export const collections = { reports };
```

### Schema 约束能力

| 约束 | 效果 |
|------|------|
| `category: z.enum(CATEGORIES)` | 分类只能从预定义列表选，不会出现 "AI" 和 "人工智能" 两种写法 |
| `tags: z.array().min(1).max(8)` | 每篇必须有标签，且不超过 8 个 |
| `slug: z.string().regex(/^[a-z0-9-]+$/)` | slug 只能是小写英文+连字符，URL 规范 |
| `pdf: z.string().startsWith('/pdf/')` | PDF 路径格式统一，不会出现路径错误 |
| `keyFindings: z.array().min(1).max(6)` | 关键结论至少 1 条，最多 6 条 |

---

## 八、AI 分析工作流

### 流程图

```
原始 PDF 文件
      │
      │ 1. 给 Claude/GPT 读取
      v
AI 分析（使用标准化 Prompt）
      │
      │ 2. 输出完整 Markdown（含 frontmatter + 正文）
      v
┌─────────────┐     ┌──────────────┐
│ reports/*.md │     │ public/pdf/  │
│ (内容文件)    │     │ (原始 PDF)    │
└──────┬──────┘     └──────┬───────┘
       │                    │
       v                    v
      git push 触发 GitHub Actions 构建部署
```

### 标准化 AI Prompt

每次分析新 PDF 时使用：

```
请分析这份 PDF 报告，输出以下结构化信息：

1. title: 报告中文标题
2. slug: 英文 URL 标识（小写，用连字符，如 ai-toy-market-2026）
3. source: 出品机构
4. date: 发布日期（YYYY-MM-DD 格式）
5. pageCount: 总页数
6. category: 从以下分类中选择最匹配的一个：
   - 人工智能
   - 消费科技
   - 前沿趋势
   - 投资研究
   - 产业研究
   - 技术深度
7. tags: 3-8 个标签，基于报告实际内容（如"AI硬件","市场报告","Z世代"等）
8. summary: 一句话核心发现（50-150 字）
9. keyFindings: 3-6 条关键结论
10. keyData: 报告中最重要的 3-8 个数据点（指标名+数值+备注）
11. 正文: 按报告章节结构，提取核心内容，用 Markdown 格式输出

请直接输出完整的 Markdown 文件（包含 frontmatter），可以直接复制使用。
```

### 分类与标签设计思路

- **category（分类）**：受控词表，枚举约束，一篇只能有一个，数量控制在 6-10 个
- **tags（标签）**：自由文本，AI 根据内容自动生成，一篇可以有多个，允许长尾
- 分类提供稳定的导航骨架，标签提供灵活的发现路径

---

## 九、单篇报告 Markdown 模板示例

```markdown
---
title: "AI玩具市场发展与用户洞察（2026）"
slug: "ai-toy-market-2026"
source: "艺恩"
date: 2026-01-15
pageCount: 34
category: "消费科技"
tags: ["AI硬件", "玩具", "市场报告", "用户洞察", "Z世代"]
summary: "2030年全球AI玩具市场规模将达351亿美元（CAGR=53%），中国市场增速更快达75%"
keyFindings:
  - "全球AI玩具2030年市场规模351亿美元，中国38.6亿美元"
  - "市场三分天下：传统制造商、IP运营方、互联网科技公司"
  - "教育机器人占品类32%，是绝对主导品类"
  - "核心用户画像：18-34岁女性（67.3%），三类人群各有诉求"
  - "Haivivi以+969.6%增长登顶，宇树+4744.5%增速最猛"
  - "社媒声量同比增长252%，情感陪伴类+512%爆发"
keyData:
  - metric: "2030年全球市场规模"
    value: "351亿美元"
    note: "CAGR=53%"
  - metric: "2030年中国市场规模"
    value: "38.6亿美元"
    note: "CAGR=75%"
  - metric: "存续企业数量"
    value: "1,766家"
  - metric: "TOP1品牌销售额"
    value: "1.055亿元"
    note: "Haivivi，+969.6%"
  - metric: "社媒声量同比增长"
    value: "+252%"
  - metric: "核心用户女性占比"
    value: "67.3%"
pdf: "/pdf/ai-toy-market-2026.pdf"
draft: false
---

## 报告背景

本报告由艺恩于2026年1月出品，聚焦AI玩具市场的规模、竞争格局、技术演进与用户需求分层。

## 市场概览

### 市场规模

到2030年，全球AI玩具市场规模预计达到351亿美元，年复合增长率超50%。
中国市场增速更为强劲，预计2030年达38.6亿美元，CAGR高达75%。

### 竞争格局

| 类型 | 优势 | 代表企业 |
|------|------|---------|
| 传统玩具制造商 | 供应链+产品化能力 | 星辉娱乐、高乐股份、实丰文化 |
| IP运营公司 | 情感资产+内容生态 | 汤姆猫、上海电影、阅文集团 |
| 互联网科技公司 | 算法+数据+平台 | 字节跳动、百度、京东 |

### 品类结构

- 教育机器人：32%（年增长45%）
- 智能编程玩具：24%（年增长53%）
- 智能陪伴玩具：18%（年增长38%）
- 智能潮玩：16%（年增长28%）
- 智能互动玩具：10%（年增长25%）

## 用户洞察

### 核心人群

核心兴趣人群为18-34岁女性（67.3%），分化为三类典型用户：

1. **Z世代父母**（25-30岁）：教育学习类需求占60%
2. **悦己型青年**（18-30岁）：情感陪伴类占48%
3. **补偿型子女**（30岁以上）：银发群体健康护理场景占59%

### 市场情绪

社媒整体感知积极（NSR=90%），正面关键词：高效、治愈、有趣。
```

---

## 十、原始资源目录（inbox）设计

### 设计思路

提供一个"投递口"：把拿到的原始文件丢进去，经过 AI 分析处理后，输出到 Astro 对应的目录中。

### 目录结构

```
inbox/                    # 原始资源投递目录（.gitignore，不进 Git）
├── pdf/                  # 待处理的 PDF 文件（可保留中文原名）
├── md/                   # 待处理的 Markdown 文件
├── docx/                 # 待处理的 Word 文件
└── xlsx/                 # 待处理的 Excel 文件
```

### 为什么 inbox 不纳入 Git

1. inbox 是临时中转站，文件处理后就不需要了
2. 原始文件名是中文（如"罗兰贝格_预见2026.pdf"），不适合进 Git
3. 同一个 PDF 会存在两份（inbox 原文 + public/ 下的 slug 版本），浪费空间
4. inbox 的文件可能很大，没必要进入 Git 历史

### 处理流程

```
                手动操作                     AI/脚本自动化
               ──────────                  ──────────────

  拿到 PDF  -->  丢到 inbox/pdf/    -->  给 Claude 读取分析
                                              │
                                              v
                                      Claude 输出:
                                      1. slug 名（如 ai-toy-market-2026）
                                      2. 完整 Markdown 文件
                                              │
                                              v
                                      执行两步操作:
                                      1. cp inbox/pdf/原文.pdf --> public/pdf/{slug}.pdf
                                      2. 保存 Markdown 到 --> src/content/reports/{slug}.md
                                              │
                                              v
                                      git add && git push
                                              │
                                              v
                                      GitHub Actions 自动构建部署
```

### Pipeline 自动化路径规划

| 路径 | 方式 | 适用阶段 |
|------|------|---------|
| 路径 A | 本地脚本监控（fswatch）-> 调用 AI API | 成熟期 |
| 路径 B | push 到 Git inbox/ -> GitHub Actions 调用 AI API | 成熟期 |
| **路径 C（当前采用）** | **半自动：Claude Code 交互式处理** | **起步期** |

**当前决策：先用路径 C（半自动）。**

理由：
- AI 分析 PDF 这个步骤本身就是在 Claude Code 里做的，流程顺畅
- 全自动 Pipeline 需要调 AI API、处理异常、管理费用，复杂度高
- 半自动的"人工审核"环节有价值 — 可以检查 AI 分析的质量
- 流程稳定后（跑了 20-30 篇），再考虑全自动化

### 文件不直接传到 public/ 的理由

- 原始文件名是中文，需要重命名为英文 slug
- slug 需要 AI 分析后才能确定
- 流程应该是：**先分析得到 slug --> 再用 slug 命名文件移到 public/**

---

## 十一、PDF 存储策略分析

### Git LFS 原理

Git LFS（Large File Storage）的核心机制是**指针替代**：

```
普通 Git 的方式：
  commit 一个 20MB 的 PDF --> Git 完整存入 .git/objects/（20MB 快照）
  修改后再 commit --> 又存一份 20MB（共 40MB）
  clone 时要下载全部历史

Git LFS 的方式：
  commit 一个 20MB 的 PDF --> Git 仓库里只存一个指针文件（约 150 字节）：
      version https://git-lfs.github.com/spec/v1
      oid sha256:4cac19622fc3ada9c0fdeadb...
      size 20971520
  20MB 真身上传到 GitHub LFS 存储服务器
  clone 时：先拉指针（秒级），再按需下载真身
```

### Git LFS 免费额度

| 项目 | GitHub Free | GitHub Team/Enterprise |
|------|------------|----------------------|
| 存储 | 10 GiB | 250 GiB |
| 带宽（每月） | 10 GiB | 250 GiB |

### Git LFS 是否压缩

**不压缩。** LFS 原封不动存储文件。PDF 本身已经是压缩格式（内部用 FlateDecode/JPEG 压缩），再压缩收益极小。普通 Git 的 packfile 机制对二进制文件也几乎无效。

### Git LFS 的带宽陷阱

**每次 GitHub Actions 构建都会消耗 LFS 带宽：**

```
每次 push --> GitHub Actions clone 仓库 --> 下载 LFS 文件 --> 消耗带宽
假设总 PDF 2GB，每月 push 20 次 = 40GB 带宽 --> 远超 10GB 免费额度
```

这是 Git LFS 在 CI/CD 场景下的关键问题。

### 三种存储方案对比

#### 方案 1：直接放 Git 仓库（不用 LFS）

| 优点 | 缺点 |
|------|------|
| 最简单，零额外配置 | 仓库体积持续膨胀 |
| clone 下来就有所有 PDF | clone 速度随文件增多变慢 |
| GitHub Pages 部署零问题 | GitHub 建议仓库不超过 5GB，强制限制单文件 100MB |
| 无带宽限制（Pages 有 100GB/月） | 历史不可清理（除非 rewrite history） |

#### 方案 2：Git LFS

| 优点 | 缺点 |
|------|------|
| 仓库体积小（只有指针） | 免费存储只有 10GB |
| clone 快（默认不下载 LFS 文件） | GitHub Actions 每次构建消耗带宽 |
| | 超出额度需付费 |
| | GitHub Pages 部署时需要额外步骤拉取 LFS 文件 |

#### 方案 3：外部对象存储（OSS/R2/S3）

| 优点 | 缺点 |
|------|------|
| Git 仓库完全轻量 | 需要额外维护存储服务 |
| 无存储/带宽限制 | 增加架构复杂度 |
| CDN 加速 | |

### 当前存储规模评估

现有 8 个 PDF 共 101MB。按每周新增 2-3 个 PDF、平均 10MB 估算：

- 半年后：~750MB
- 一年后：~1.4GB
- 两年后：~2.7GB

GitHub 仓库 5GB 软限制，**2 年内没问题**。

### 存储决策

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 当前方案 | **直接放 Git（方案 1）** | 101MB 离 5GB 很远，零配置最简单 |
| Git LFS | **暂不使用** | 带宽陷阱（Actions 每次构建都下载），收益不明显 |
| 压缩 PDF | 不需要 | PDF 本身已压缩，再压收益极小 |
| 未来瓶颈后 | 迁移到外部对象存储（R2/OSS） | 比 LFS 更适合 CI/CD + 静态站场景 |

**迁移路径：** 从方案 1 到方案 3 很顺畅 — 只需把 PDF 移到外部存储，批量修改 frontmatter 里的 `pdf` 路径即可。

---

## 十二、前期风险和坑点预警

| 问题 | 应对 |
|------|------|
| PDF 文件过大，GitHub 仓库臃肿 | 当前 101MB 离 5GB 限制很远；2 年内直接放 Git，之后迁移外部存储 |
| 分类体系后期要调整 | category 用枚举约束在 `content.config.ts`，改一处全局生效 |
| 标签拼写不一致 | 可加脚本定期扫描所有 tags，输出频次表，手动合并低频标签 |
| slug 和 PDF 文件名不一致 | Schema 约束 + 构建前检查脚本 |
| 报告数量增多后首页加载慢 | 静态生成不存在运行时性能问题；首页做分页即可 |
| GitHub Pages 的 base 路径问题 | 仓库名非 `<username>.github.io` 时需设置 `base` |
| 中文搜索 | 后续集成 pagefind（静态搜索引擎，对中文支持好） |
| inbox 文件堆积 | inbox 不进 Git，处理完手动清理或写脚本定期清理 |
| GitHub Actions 构建带宽 | 不用 LFS，PDF 直接在 Git 里，Actions 正常 clone 即可 |

---

## 十三、实施计划

```
Phase 1: 项目初始化
  - 创建 Astro 项目
  - 配置 Content Collection Schema
  - 搭建基础页面模板（首页、报告详情页、分类页、标签页）
  - 配置 .gitignore（inbox/、node_modules/、dist/）
  - 配置 GitHub Pages 部署（GitHub Actions）
  - 创建 inbox/ 子目录结构

Phase 2: 内容填充（先做 2-3 篇验证流程）
  - 将 2-3 份 PDF 放入 inbox/pdf/
  - 用 Claude 分析 PDF，生成完整 Markdown（含 frontmatter）
  - 将 PDF 以 slug 命名复制到 public/pdf/
  - 将 Markdown 保存到 src/content/reports/
  - 本地 npm run dev 预览确认效果
  - 推送到 GitHub，确认 Pages 部署成功

Phase 3: 完善体验
  - 分类页面、标签页面动态路由
  - 样式美化（卡片布局、响应式）
  - 添加搜索功能（pagefind）
  - 添加 scripts/validate.ts 校验脚本

Phase 4: 批量扩展
  - 处理剩余 PDF
  - 优化 AI 分析 Prompt（根据前几篇经验调整）
  - 创建 OPML 思维导图

Phase 5: 自动化（可选，流程稳定后）
  - 评估全自动 Pipeline 的必要性
  - 选择本地脚本监控或 GitHub Actions 方案
  - 实现自动化处理流程
```

---

## 十四、决策汇总

| 问题 | 决策 | 理由 |
|------|------|------|
| 框架选择 | Astro | Content Collections 强大，灵活度高，内容驱动 |
| PDF 转换方式 | AI 摘要 + PDF 原文下载 | 视觉密集型报告不适合全文转 Markdown |
| 分类方式 | AI 基于内容自动分析，受控枚举约束 | 不人工手动分类，也不用文件目录分类 |
| PDF 存储 | 直接放 Git 仓库 | 101MB 离 5GB 很远，零配置 |
| Git LFS | 暂不使用 | CI/CD 带宽陷阱，当前规模不需要 |
| 未来存储迁移 | 外部对象存储（R2/OSS） | 比 LFS 更适合静态站 + CI/CD 场景 |
| inbox 目录 | 加 .gitignore，不进 Git | 临时中转站，处理完即弃 |
| Pipeline | 先半自动（Claude Code） | 先跑通流程，稳定后再全自动 |
| OPML 位置 | docs/ 目录（同一仓库，独立于 Astro） | 项目级规划物料，不参与构建 |
| Marker 工具 | 不作为主力，仅辅助纯文字类文档 | 行业报告场景下 AI 直读更优 |
