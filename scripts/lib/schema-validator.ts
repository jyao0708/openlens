/**
 * Frontmatter Schema 验证与数据规范化
 *
 * 三层处理架构：
 *   L1  cleanRawOutput()        — 字符串层清理（去 ```markdown 包裹等）
 *   L2  normalizeFrontmatter()  — 结构化数据规范化（截断、默认值、格式修正）
 *   L3  validateMarkdown()      — Zod 严格校验（经过 L2 后应极高概率通过）
 *
 * 核心设计理念：
 *   AI 的职责 = 内容分析；格式合规 = 代码的职责。
 *   所有"确定性可修复"的格式偏差（tags 超量、summary 过长……）在 L2 由代码裁剪，
 *   只有"不可修复"的结构性错误（frontmatter 缺失、YAML 语法错误、正文为空）才向上报 fatal。
 *
 * 使用 js-yaml 进行标准 YAML 解析，确保引号、特殊字符等边界情况正确处理。
 */

import { z } from 'zod';
import yaml from 'js-yaml';
import { CATEGORIES, type Category } from '../config.js';
import { log } from './logger.js';

// ── Schema 定义（与 content.config.ts 保持同步） ────────────

const frontmatterSchema = z.object({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  source: z.string().min(1),
  date: z.coerce.date(),
  pageCount: z.number().int().positive().optional(),
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]),
  tags: z.array(z.string()).min(1).max(8),
  summary: z.string().min(10).max(300),
  keyFindings: z.array(z.string()).min(1).max(6),
  keyData: z
    .array(
      z.object({
        metric: z.string(),
        value: z.string(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  pdf: z.string().startsWith('/pdf/'),
  cover: z.string().optional(),
  draft: z.boolean().default(false),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;

// ── L1: 字符串层清理 ─────────────────────────────────────────

/**
 * 清理 AI 输出的原始字符串
 *
 * 处理：去除 ```markdown 包裹、首尾空白
 */
export function cleanRawOutput(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n/, '').replace(/\n```\s*$/, '');
  }
  return cleaned;
}

// ── Markdown 解析 ───────────────────────────────────────────

/**
 * 从清理后的 Markdown 中提取 frontmatter YAML 和正文
 *
 * 抛出异常 = 致命错误（frontmatter 结构完全缺失）
 */
export function parseMarkdown(raw: string): {
  yamlStr: string;
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const cleaned = cleanRawOutput(raw);

  const match = cleaned.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    throw new Error('无法解析 frontmatter：未找到 --- 分隔符');
  }

  const yamlStr = match[1];
  const body = match[2].trim();

  const frontmatter = yaml.load(yamlStr) as Record<string, unknown>;

  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error('YAML 解析结果无效：不是对象类型');
  }

  return { yamlStr, frontmatter, body };
}

// ── L2: 结构化数据规范化 ─────────────────────────────────────

/**
 * 对 AI 输出的 frontmatter 对象进行确定性规范化
 *
 * 每条规则都是"代码能 100% 确定怎么修"的确定性操作，
 * 不涉及需要 AI 重新理解内容的语义判断。
 *
 * 返回修正后的对象 + 所做修正的日志列表（方便调试）
 */
export function normalizeFrontmatter(
  fm: Record<string, unknown>,
): { normalized: Record<string, unknown>; fixes: string[] } {
  const fixes: string[] = [];
  const data = { ...fm };

  // ── slug 格式化 ──
  if (typeof data.slug === 'string') {
    const original = data.slug;
    // 转小写、只保留 [a-z0-9-]
    let slug = original.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    // 限制 60 字符
    if (slug.length > 60) {
      slug = slug.slice(0, 60).replace(/-$/, '');
    }
    if (slug !== original) {
      data.slug = slug;
      fixes.push(`slug 格式化: "${original}" → "${slug}"`);
    }
  }

  // ── pdf 路径自动生成（基于 slug） ──
  if (typeof data.slug === 'string') {
    const expectedPdf = `/pdf/${data.slug}.pdf`;
    if (data.pdf !== expectedPdf) {
      const old = data.pdf;
      data.pdf = expectedPdf;
      fixes.push(`pdf 路径修正: "${old}" → "${expectedPdf}"`);
    }
  }

  // ── tags 截断（最多 8 个） ──
  if (Array.isArray(data.tags) && data.tags.length > 8) {
    const removed = data.tags.length - 8;
    data.tags = data.tags.slice(0, 8);
    fixes.push(`tags 截断: 移除多余 ${removed} 个标签`);
  }

  // ── tags 去重 ──
  if (Array.isArray(data.tags)) {
    const unique = [...new Set(data.tags as string[])];
    if (unique.length < (data.tags as string[]).length) {
      fixes.push(`tags 去重: ${(data.tags as string[]).length} → ${unique.length} 个`);
      data.tags = unique;
    }
  }

  // ── summary 截断（最多 300 字符） ──
  if (typeof data.summary === 'string' && data.summary.length > 300) {
    const original = data.summary;
    // 在最后一个完整句子处截断，或直接截断到 297 字符 + ...
    let truncated = original.slice(0, 297);
    // 尝试在最后一个句号/分号处截断，避免截断半句话
    const lastPunctuation = Math.max(
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('；'),
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('.'),
    );
    if (lastPunctuation > 200) {
      truncated = original.slice(0, lastPunctuation + 1);
    } else {
      truncated = truncated + '...';
    }
    data.summary = truncated;
    fixes.push(`summary 截断: ${original.length} → ${truncated.length} 字符`);
  }

  // ── keyFindings 截断（最多 6 条） ──
  if (Array.isArray(data.keyFindings) && data.keyFindings.length > 6) {
    const removed = data.keyFindings.length - 6;
    data.keyFindings = data.keyFindings.slice(0, 6);
    fixes.push(`keyFindings 截断: 移除多余 ${removed} 条`);
  }

  // ── keyData 截断（最多 8 个数据点） ──
  if (Array.isArray(data.keyData) && data.keyData.length > 8) {
    const removed = data.keyData.length - 8;
    data.keyData = data.keyData.slice(0, 8);
    fixes.push(`keyData 截断: 移除多余 ${removed} 个数据点`);
  }

  // ── keyData.value 强制为字符串（AI 可能输出数字） ──
  if (Array.isArray(data.keyData)) {
    data.keyData = (data.keyData as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      value: String(item.value ?? ''),
      metric: String(item.metric ?? ''),
    }));
  }

  // ── draft 默认值 ──
  if (data.draft === undefined || data.draft === null) {
    data.draft = false;
  }

  // ── category 模糊匹配（AI 可能输出略有偏差的分类名） ──
  if (typeof data.category === 'string') {
    const exact = CATEGORIES.find((c) => c === data.category);
    if (!exact) {
      // 尝试模糊匹配：去空格、包含关系
      const fuzzy = CATEGORIES.find(
        (c) => c.includes(data.category as string) || (data.category as string).includes(c),
      );
      if (fuzzy) {
        fixes.push(`category 模糊匹配: "${data.category}" → "${fuzzy}"`);
        data.category = fuzzy;
      }
      // 如果模糊也匹配不到，留给 Zod 报 fatal 错误
    }
  }

  // ── date 确保存在 ──
  if (data.date === undefined || data.date === null) {
    data.date = new Date().toISOString().slice(0, 10);
    fixes.push(`date 填充默认值: ${data.date}`);
  }

  // ── pageCount 类型修正（AI 可能输出字符串数字） ──
  if (data.pageCount !== undefined && data.pageCount !== null) {
    const num = Number(data.pageCount);
    if (!isNaN(num) && num > 0) {
      data.pageCount = Math.round(num);
    } else {
      delete data.pageCount;
      fixes.push('pageCount 无效，已移除');
    }
  }

  return { normalized: data, fixes };
}

// ── L3: 校验入口 ────────────────────────────────────────────

/** 错误严重程度 */
export type ErrorSeverity = 'fatal' | 'fixable';

export interface ValidationResult {
  valid: boolean;
  /** 通过校验时的 frontmatter 数据 */
  data?: Frontmatter;
  /** 正文内容 */
  body?: string;
  /** 校验错误列表 */
  errors?: string[];
  /** 错误严重程度：fatal = 需要 AI 重新分析, fixable = 代码理论上可修复但本次未覆盖 */
  severity?: ErrorSeverity;
  /** 规范化过程中自动修正的项目（调试/审计用） */
  fixes?: string[];
}

/**
 * 对 AI 输出进行完整的 "清理 → 规范化 → 校验" 流程
 *
 * 流程:
 *   raw string  ──L1──▶  cleaned string
 *               ──parse──▶  { frontmatter, body }
 *               ──L2──▶  { normalized frontmatter, fixes }
 *               ──L3──▶  Zod validation
 *               ──extra──▶ pdf 路径一致性、正文长度
 *
 * 返回值中的 severity 帮助调用方决策：
 *   - fatal:   frontmatter 缺失 / YAML 语法错误 / 正文为空 / 关键必填字段缺失
 *              → 需要换模型重新分析
 *   - fixable: Zod 校验仍有少量问题，但不是结构性崩坏
 *              → 理论上可以代码修复，当前版本未覆盖到，可记录并跳过
 */
export function validateMarkdown(raw: string): ValidationResult {
  // ── 阶段 1: 解析 ──
  let frontmatter: Record<string, unknown>;
  let body: string;

  try {
    const parsed = parseMarkdown(raw);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch (err) {
    // 解析失败 = 结构性致命错误
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [msg], severity: 'fatal' };
  }

  // ── 阶段 2: 规范化 ──
  const { normalized, fixes } = normalizeFrontmatter(frontmatter);

  if (fixes.length > 0) {
    log.info(`自动规范化修正 ${fixes.length} 项: ${fixes.join('; ')}`);
  }

  // ── 阶段 3: Zod 校验 ──
  const parseResult = frontmatterSchema.safeParse(normalized);

  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );

    // 判断严重程度：如果只是可选字段的问题，算 fixable；否则 fatal
    const severity = classifyErrors(parseResult.error.issues);

    return { valid: false, errors, severity, fixes };
  }

  const data = parseResult.data as Frontmatter;

  // ── 阶段 4: 额外校验 ──

  // 正文至少有内容（AI 可能返回空正文 = 内容分析失败，需要重新分析）
  if (body.length < 100) {
    return {
      valid: false,
      errors: ['正文内容过短（不足 100 字符），AI 可能未能有效分析 PDF'],
      severity: 'fatal',
      fixes,
    };
  }

  return { valid: true, data, body, fixes };
}

/**
 * 根据 Zod 错误内容判断严重程度
 *
 * 致命（需要 AI 重新分析）：
 *   - title / slug / source / category 等核心标识字段缺失或格式完全错误
 *   - frontmatter 结构不是对象
 *
 * 可修复（代码理论上可补救）：
 *   - 数组长度超限（应该已被 L2 截断，走到这里说明有遗漏）
 *   - 可选字段格式不对
 */
function classifyErrors(issues: z.ZodIssue[]): ErrorSeverity {
  const fatalFields = new Set(['title', 'slug', 'source', 'category', 'tags', 'keyFindings']);

  for (const issue of issues) {
    const rootField = String(issue.path[0] ?? '');
    // 核心字段的"required"或"invalid_type"错误 → fatal
    if (fatalFields.has(rootField)) {
      if (issue.code === 'invalid_type' || issue.code === 'invalid_enum_value') {
        return 'fatal';
      }
      // 核心字段的必填缺失
      if (issue.message.toLowerCase().includes('required')) {
        return 'fatal';
      }
    }
  }

  // 其余都算 fixable
  return 'fixable';
}

// ── 工具函数：从规范化后的 frontmatter 重建 Markdown ────────

/**
 * 将规范化后的 frontmatter 对象 + 原始正文重组为完整 Markdown 字符串
 *
 * 用于在 normalizeFrontmatter 修正了数据后，生成最终可写入的内容。
 */
export function rebuildMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,         // 不折行
    quotingType: '"',      // 统一双引号
    forceQuotes: false,    // 仅需要时加引号
    sortKeys: false,       // 保持字段顺序
  });

  return `---\n${yamlStr.trim()}\n---\n\n${body}`;
}
