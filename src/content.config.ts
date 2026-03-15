// Content Collection Schema 定义
// 修改此文件后，必须同步更新 .claude.md 中对应的文档

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 受控分类枚举 — 新增分类需同时更新 .claude.md
export const CATEGORIES = [
  '人工智能',
  '消费科技',
  '前沿趋势',
  '投资研究',
  '产业研究',
  '技术深度',
] as const;

const reports = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reports' }),
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
