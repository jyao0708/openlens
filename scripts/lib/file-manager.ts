/**
 * 文件管理工具
 *
 * 处理 PDF 复制、Markdown 写入、已处理文件检测等文件系统操作。
 * 使用 processed.json 记录"原始文件名 → slug"的映射，实现幂等性过滤。
 */

import { readdir, copyFile, writeFile, readFile, access, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { CONFIG } from '../config.js';
import { log } from './logger.js';

// ── 类型定义 ────────────────────────────────────────────────

export interface PendingPdf {
  /** 原始文件名（含中文） */
  fileName: string;
  /** 完整文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  sizeBytes: number;
}

/** 已处理文件的记录格式 */
interface ProcessedRecord {
  [fileName: string]: {
    slug: string;
    processedAt: string;
  };
}

// ── 已处理文件记录 ──────────────────────────────────────────

const PROCESSED_FILE = resolve(CONFIG.inboxDir, '..', '.processed.json');

/**
 * 读取已处理文件记录
 */
async function loadProcessedRecord(): Promise<ProcessedRecord> {
  try {
    const data = await readFile(PROCESSED_FILE, 'utf-8');
    return JSON.parse(data) as ProcessedRecord;
  } catch {
    return {};
  }
}

/**
 * 保存已处理文件记录（追加一条）
 */
export async function markAsProcessed(fileName: string, slug: string): Promise<void> {
  const record = await loadProcessedRecord();
  record[fileName] = {
    slug,
    processedAt: new Date().toISOString(),
  };
  await writeFile(PROCESSED_FILE, JSON.stringify(record, null, 2), 'utf-8');
}

// ── 扫描待处理文件 ──────────────────────────────────────────

/**
 * 扫描 inbox/pdf/ 目录，返回所有待处理的 PDF 文件
 *
 * 已处理判定：
 * 1. 文件名出现在 .processed.json 中 → 跳过
 * 2. 对应 slug 已存在于 src/content/reports/ 中 → 跳过（兜底检查在处理时进行）
 */
export async function scanPendingPdfs(): Promise<PendingPdf[]> {
  // 检查 inbox 目录是否存在
  try {
    await access(CONFIG.inboxDir);
  } catch {
    log.error(`inbox 目录不存在: ${CONFIG.inboxDir}`);
    return [];
  }

  const entries = await readdir(CONFIG.inboxDir, { withFileTypes: true });
  const processedRecord = await loadProcessedRecord();
  const processedFileNames = new Set(Object.keys(processedRecord));

  // 获取已有的报告 slugs（兜底信息）
  const existingSlugs = await getExistingSlugs();

  const pdfs: PendingPdf[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (extname(entry.name).toLowerCase() !== '.pdf') continue;
    if (entry.name.startsWith('.')) continue; // 跳过隐藏文件

    // 通过 processed 记录过滤已处理文件
    if (processedFileNames.has(entry.name)) {
      skippedCount++;
      continue;
    }

    const filePath = resolve(CONFIG.inboxDir, entry.name);
    const fileStat = await stat(filePath);

    pdfs.push({
      fileName: entry.name,
      filePath,
      sizeBytes: fileStat.size,
    });
  }

  // 按文件大小排序（小文件优先，更快出结果）
  pdfs.sort((a, b) => a.sizeBytes - b.sizeBytes);

  log.info(`扫描完成: 找到 ${pdfs.length} 个待处理 PDF（已跳过 ${skippedCount} 个已处理文件）`);
  if (existingSlugs.size > 0) {
    log.debug(`已有 ${existingSlugs.size} 篇报告: ${[...existingSlugs].join(', ')}`);
  }

  return pdfs;
}

/**
 * 获取已有的报告 slug 集合
 */
async function getExistingSlugs(): Promise<Set<string>> {
  try {
    const entries = await readdir(CONFIG.outputReportsDir);
    return new Set(
      entries
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, '')),
    );
  } catch {
    return new Set();
  }
}

/**
 * 检查某个 slug 是否已存在（幂等性检查）
 */
export async function isSlugExists(slug: string): Promise<boolean> {
  try {
    await access(resolve(CONFIG.outputReportsDir, `${slug}.md`));
    return true;
  } catch {
    return false;
  }
}

// ── 文件写入 ────────────────────────────────────────────────

/**
 * 保存分析结果：复制 PDF + 写入 Markdown
 */
export async function saveResult(
  sourcePdfPath: string,
  slug: string,
  markdownContent: string,
): Promise<{ mdPath: string; pdfPath: string }> {
  const mdPath = resolve(CONFIG.outputReportsDir, `${slug}.md`);
  const pdfPath = resolve(CONFIG.outputPdfDir, `${slug}.pdf`);

  // 写入 Markdown
  await writeFile(mdPath, markdownContent, 'utf-8');
  log.success(`Markdown 已写入: ${mdPath}`, slug);

  // 复制 PDF（用 slug 重命名）
  await copyFile(sourcePdfPath, pdfPath);
  log.success(`PDF 已复制: ${pdfPath}`, slug);

  return { mdPath, pdfPath };
}

// ── 工具函数 ────────────────────────────────────────────────

/** 格式化文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
