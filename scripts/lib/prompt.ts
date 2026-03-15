/**
 * AI 分析提示词模板
 *
 * 所有发送给 AI 的提示词集中管理，方便迭代优化。
 */

import { CATEGORIES } from '../config.js';

/** 可用分类列表（格式化为提示词文本） */
const CATEGORIES_TEXT = CATEGORIES.map((c) => `  - ${c}`).join('\n');

/**
 * 整体分析提示词 — 用于一次性处理完整 PDF
 *
 * 要求 AI 输出完整的 Markdown 文件（含 frontmatter + 正文）
 */
export function buildFullAnalysisPrompt(): string {
  return `你是一位专业的行业研究分析师。请仔细阅读这份 PDF 报告，输出一个**完整的 Markdown 文件**。

## 输出格式要求

输出必须严格遵循以下结构，**不要**添加 \`\`\`markdown 代码块包裹，直接输出纯文本：

---
title: "报告中文标题"
slug: "english-slug-with-hyphens"
source: "出品机构名称"
date: YYYY-MM-DD
pageCount: 数字
category: "从下方列表选一个"
tags: ["标签1", "标签2", "标签3"]
summary: "一句话核心发现（50-200字）"
keyFindings:
  - "关键结论1"
  - "关键结论2"
  - "关键结论3"
keyData:
  - metric: "指标名"
    value: "数值"
    note: "备注（可选）"
pdf: "/pdf/同slug.pdf"
draft: false
---

## 报告背景

（简述报告出品方、发布时间、研究对象）

## 核心内容

（按报告章节结构，提取核心内容，使用 Markdown 格式输出）

## 数据亮点

（提取报告中最重要的数据和图表结论）

## 趋势与展望

（总结报告的趋势判断和未来预测）

## 字段约束

- **slug**: 全小写英文 + 连字符，不超过 60 字符，年份放末尾（如 ai-toy-market-2026）
- **category**: 必须从以下列表中**精确选择一个**：
${CATEGORIES_TEXT}
- **tags**: 3-8 个中文标签，避免与 category 重复，使用具体词汇
- **summary**: 50-200 字，包含关键数据
- **keyFindings**: 3-6 条，每条是一个完整的结论句
- **keyData**: 3-8 个数据点，必须包含具体数字
- **pdf**: 格式为 \`/pdf/{slug}.pdf\`
- **date**: 如果报告未明确标注日期，根据内容推断大致发布时间

## 重要提醒

1. 输出必须是可以直接保存为 .md 文件的纯文本
2. frontmatter 中的字符串值用双引号包裹
3. 正文使用清晰的 Markdown 结构（标题、列表、表格）
4. 保留报告中的核心数据和结论，不要编造数据
5. 正文至少包含 3 个二级标题`;
}

/**
 * 分片分析提示词 — 用于处理大 PDF 的单个 chunk
 */
export function buildChunkAnalysisPrompt(
  chunkIndex: number,
  totalChunks: number,
  startPage: number,
  endPage: number,
): string {
  return `你是一位专业的行业研究分析师。这是一份大型 PDF 报告的**第 ${chunkIndex}/${totalChunks} 部分**（第 ${startPage}-${endPage} 页）。

请仔细阅读这部分内容，提取以下信息：

1. **核心内容概述**（200-500 字）：这部分讲了什么
2. **关键数据点**：所有出现的具体数字、百分比、金额等
3. **关键结论**：这部分得出的重要结论
4. **章节标题**：这部分包含的章节标题列表

${chunkIndex === 1 ? `
作为第一部分，还请额外提取：
- 报告标题
- 出品机构
- 发布日期（如果有）
- 报告总体研究主题
` : ''}

请以结构化的方式输出，使用 Markdown 格式。`;
}

/**
 * 分片合并提示词 — 将多个 chunk 的分析结果合并为最终 Markdown
 */
export function buildMergePrompt(chunkSummaries: string[]): string {
  const parts = chunkSummaries
    .map((s, i) => `### 第 ${i + 1} 部分分析结果\n\n${s}`)
    .join('\n\n---\n\n');

  return `你是一位专业的行业研究分析师。以下是一份大型 PDF 报告被拆分为 ${chunkSummaries.length} 个部分后的分别分析结果。

请将这些部分合并，输出一个**完整的 Markdown 文件**（与直接分析完整报告的格式完全一致）。

## 各部分分析结果

${parts}

## 输出格式要求

输出必须严格遵循以下结构，**不要**添加 \`\`\`markdown 代码块包裹，直接输出纯文本：

---
title: "报告中文标题"
slug: "english-slug-with-hyphens"
source: "出品机构名称"
date: YYYY-MM-DD
pageCount: 数字
category: "从下方列表选一个"
tags: ["标签1", "标签2", "标签3"]
summary: "一句话核心发现（50-200字）"
keyFindings:
  - "关键结论1"
  - "关键结论2"
  - "关键结论3"
keyData:
  - metric: "指标名"
    value: "数值"
    note: "备注（可选）"
pdf: "/pdf/同slug.pdf"
draft: false
---

（正文内容...）

## 字段约束

- **slug**: 全小写英文 + 连字符，不超过 60 字符
- **category**: 必须从以下列表中精确选择一个：
${CATEGORIES_TEXT}
- **tags**: 3-8 个中文标签
- **summary**: 50-200 字
- **keyFindings**: 3-6 条
- **keyData**: 3-8 个数据点
- **pdf**: 格式为 \`/pdf/{slug}.pdf\`

## 重要提醒

1. 综合所有部分的信息，不要遗漏重要数据
2. 去除重复内容，合理组织章节结构
3. 确保 frontmatter 格式正确，所有字段完整
4. 正文至少包含 3 个二级标题`;
}
