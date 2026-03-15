/**
 * PDF 分析器 — 核心处理逻辑
 *
 * 负责单个 PDF 的完整处理流程：
 * 1. 读取 PDF 信息，判断是否需要分片
 * 2. 调用 AI 分析（整体或分片 + 合并）
 * 3. 规范化 + 校验输出格式（区分 fatal / fixable）
 * 4. 仅 fatal 错误才触发模型降级重试
 * 5. 写入结果文件
 *
 * 核心设计理念：
 *   AI 的职责 = 内容分析（理解 PDF、提炼信息）
 *   代码的职责 = 格式合规（截断、默认值、路径修正等）
 *   二者不应混淆 — tags 多了 1 个，不该浪费数万 token 重新跑 AI。
 */

import { chat, buildPdfMessage, type RequestOptions } from './ai-client.js';
import { getPdfInfo, bufferToBase64, splitPdfFromBuffer, type PdfInfo } from './pdf-splitter.js';
import {
  buildFullAnalysisPrompt,
  buildChunkAnalysisPrompt,
  buildMergePrompt,
} from './prompt.js';
import {
  validateMarkdown,
  rebuildMarkdown,
  parseMarkdown,
  normalizeFrontmatter,
  type Frontmatter,
  type ValidationResult,
} from './schema-validator.js';
import { saveResult, isSlugExists, markAsProcessed, formatSize } from './file-manager.js';
import { CONFIG } from '../config.js';
import { log } from './logger.js';

// ── 类型定义 ────────────────────────────────────────────────

export interface AnalysisResult {
  /** 是否成功 */
  success: boolean;
  /** 原始 PDF 文件名 */
  fileName: string;
  /** 生成的 slug（成功时有值） */
  slug?: string;
  /** 错误信息（失败时有值） */
  error?: string;
  /** 处理耗时（毫秒） */
  durationMs: number;
}

// ── AI 分析（不分片） ───────────────────────────────────────

/**
 * 对 PDF 进行整体分析（文件不超过 maxPdfSizeBytes）
 */
async function analyzeWhole(
  buffer: Buffer,
  ctx: string,
  opts?: RequestOptions,
): Promise<string> {
  const model = opts?.model ?? CONFIG.primaryModel;
  log.info(`整体分析模式 [${model}]`, ctx);

  const base64 = bufferToBase64(buffer);
  const prompt = buildFullAnalysisPrompt();
  const message = buildPdfMessage(prompt, base64);

  return await chat([message], opts);
}

// ── AI 分析（分片） ─────────────────────────────────────────

/**
 * 对大 PDF 进行分片分析 + 合并
 */
async function analyzeChunked(
  buffer: Buffer,
  fileName: string,
  ctx: string,
  opts?: RequestOptions,
): Promise<string> {
  const model = opts?.model ?? CONFIG.primaryModel;
  log.info(`分片分析模式（文件过大）[${model}]`, ctx);

  // 第一步：从缓存 buffer 拆分 PDF
  const chunks = await splitPdfFromBuffer(buffer, fileName);
  log.info(`已拆分为 ${chunks.length} 个 chunk`, ctx);

  // 第二步：逐个分析 chunk（串行，避免 rate limit）
  const chunkSummaries: string[] = [];

  for (const chunk of chunks) {
    log.info(
      `分析 chunk ${chunk.index}/${chunk.total}（第 ${chunk.startPage}-${chunk.endPage} 页, ${formatSize(chunk.sizeBytes)}）`,
      ctx,
    );

    const prompt = buildChunkAnalysisPrompt(
      chunk.index,
      chunk.total,
      chunk.startPage,
      chunk.endPage,
    );
    const message = buildPdfMessage(prompt, chunk.base64);
    const summary = await chat([message], opts);

    chunkSummaries.push(summary);
    log.success(`chunk ${chunk.index}/${chunk.total} 完成`, ctx);
  }

  // 第三步：合并所有 chunk 的分析结果
  log.info('合并所有 chunk 分析结果...', ctx);
  const mergePrompt = buildMergePrompt(chunkSummaries);
  const mergedResult = await chat([{ role: 'user', content: mergePrompt }], opts);

  return mergedResult;
}

// ── 内部：调用 AI + 规范化 + 校验 ──────────────────────────

/**
 * 调用 AI 分析并进行规范化校验
 *
 * 返回 ValidationResult，调用方根据 severity 决定是否重试
 */
async function analyzeAndValidate(
  info: PdfInfo,
  fileName: string,
  ctx: string,
  opts?: RequestOptions,
): Promise<{ validation: ValidationResult; rawMarkdown: string }> {
  // 调用 AI
  let rawMarkdown: string;
  if (info.needsSplit) {
    rawMarkdown = await analyzeChunked(info.buffer, fileName, ctx, opts);
  } else {
    rawMarkdown = await analyzeWhole(info.buffer, ctx, opts);
  }

  // 规范化 + 校验（三层处理已内置于 validateMarkdown）
  const validation = validateMarkdown(rawMarkdown);

  // 如果校验通过且有修正，需要用规范化后的数据重建 Markdown
  if (validation.valid && validation.fixes && validation.fixes.length > 0) {
    // 重新解析并用规范化后的 frontmatter 重建
    try {
      const parsed = parseMarkdown(rawMarkdown);
      const { normalized } = normalizeFrontmatter(parsed.frontmatter);
      rawMarkdown = rebuildMarkdown(normalized, parsed.body);
    } catch {
      // 重建失败不影响结果（原始 rawMarkdown 已通过校验）
      log.warn('重建 Markdown 失败，使用原始输出', ctx);
    }
  }

  return { validation, rawMarkdown };
}

// ── 公开接口 ────────────────────────────────────────────────

/**
 * 处理单个 PDF 文件的完整流程
 *
 * 降级策略（精细化）：
 *   1. 主力模型分析 → 规范化 → 校验
 *   2. 校验通过 → 直接保存（即使 L2 做了截断修正，也不算失败）
 *   3. 校验失败 + severity=fixable → 记录警告，视为成功但标记 draft
 *   4. 校验失败 + severity=fatal → 换备用模型重试（真正的内容分析失败）
 *   5. 备用模型也 fatal → 最终失败
 */
export async function processPdf(
  filePath: string,
  fileName: string,
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const ctx = fileName;

  try {
    // ── 1. 获取 PDF 信息（同时缓存 buffer 避免重复读取） ──
    const info = await getPdfInfo(filePath);
    log.info(
      `文件大小: ${formatSize(info.sizeBytes)}, 页数: ${info.pageCount}, 需要分片: ${info.needsSplit ? '是' : '否'}`,
      ctx,
    );

    // ── 2. 主力模型：分析 + 规范化 + 校验 ──
    let { validation, rawMarkdown } = await analyzeAndValidate(info, fileName, ctx);

    if (validation.valid) {
      // 主力模型一次成功（大多数情况应该走这里）
      if (validation.fixes && validation.fixes.length > 0) {
        log.info(`主力模型分析成功，代码自动修正了 ${validation.fixes.length} 项格式问题`, ctx);
      }
    } else if (validation.severity === 'fatal') {
      // ── 3. 致命错误：真正需要 AI 重新分析 ──
      log.warn(
        `主力模型分析结果存在致命问题: ${validation.errors?.join('; ')}`,
        ctx,
      );
      log.info(`使用备用模型 ${CONFIG.fallbackModel} 重新分析...`, ctx);

      const fallbackOpts: RequestOptions = { model: CONFIG.fallbackModel };
      const fallback = await analyzeAndValidate(info, fileName, ctx, fallbackOpts);
      validation = fallback.validation;
      rawMarkdown = fallback.rawMarkdown;

      if (!validation.valid) {
        // 备用模型也失败了
        const errMsg = `主力模型和备用模型均校验失败 [${validation.severity}]: ${validation.errors?.join('; ')}`;
        log.error(errMsg, ctx);
        return {
          success: false,
          fileName,
          error: errMsg,
          durationMs: Date.now() - startTime,
        };
      }

      log.success('备用模型分析成功', ctx);
    } else {
      // ── severity=fixable: 非致命错误，不值得重新跑 AI ──
      // 这种情况理论上不应该出现（L2 应该已经修复了所有 fixable 问题）
      // 如果出现，说明 normalizeFrontmatter 有遗漏，记录日志待后续完善
      log.warn(
        `校验存在非致命问题（不触发重试）: ${validation.errors?.join('; ')}`,
        ctx,
      );
      log.warn('该问题不影响内容质量，已记录待后续优化 normalizeFrontmatter 覆盖', ctx);

      // 仍然视为失败，但不浪费 token 重试
      const errMsg = `非致命校验问题（未触发重试）: ${validation.errors?.join('; ')}`;
      return {
        success: false,
        fileName,
        error: errMsg,
        durationMs: Date.now() - startTime,
      };
    }

    // ── 4. 到这里，validation.valid === true ──
    const frontmatter = validation.data!;
    const slug = frontmatter.slug;

    // ── 5. 幂等性检查 ──
    if (await isSlugExists(slug)) {
      log.warn(`slug "${slug}" 已存在，跳过写入`, ctx);
      await markAsProcessed(fileName, slug);
      return {
        success: true,
        fileName,
        slug,
        durationMs: Date.now() - startTime,
      };
    }

    // ── 6. 保存结果 ──
    await saveResult(filePath, slug, rawMarkdown);

    // ── 7. 标记为已处理 ──
    await markAsProcessed(fileName, slug);

    const duration = Date.now() - startTime;
    log.success(`处理完成 (${(duration / 1000).toFixed(1)}s) → slug: ${slug}`, ctx);

    return { success: true, fileName, slug, durationMs: duration };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`处理失败: ${errMsg}`, ctx);

    return {
      success: false,
      fileName,
      error: errMsg,
      durationMs: Date.now() - startTime,
    };
  }
}
