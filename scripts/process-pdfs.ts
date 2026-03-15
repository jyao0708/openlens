#!/usr/bin/env tsx
/**
 * PDF 自动化处理系统 — 主入口
 *
 * 扫描 inbox/pdf/ 目录中的所有 PDF 文件，
 * 通过 AI 网关并发分析，生成结构化 Markdown 并保存到 Astro Content Collection。
 *
 * 使用方式:
 *   npx tsx scripts/process-pdfs.ts              # 处理所有待处理 PDF
 *   npx tsx scripts/process-pdfs.ts --dry-run    # 仅扫描，不实际处理
 *   npx tsx scripts/process-pdfs.ts --file "某个报告.pdf"  # 只处理指定文件
 */

import pLimit from 'p-limit';
import { CONFIG } from './config.js';
import { log } from './lib/logger.js';
import { scanPendingPdfs, formatSize } from './lib/file-manager.js';
import { processPdf, type AnalysisResult } from './lib/pdf-analyzer.js';

// ── CLI 参数解析 ────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  targetFile: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { dryRun: false, targetFile: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--file' && args[i + 1]) {
      result.targetFile = args[i + 1];
      i++;
    }
  }

  return result;
}

// ── 主流程 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // ── 打印启动信息 ──
  console.log();
  log.separator();
  log.info('OpenLens PDF 自动化处理系统');
  log.separator();
  log.info(`AI 网关:  ${CONFIG.apiUrl}`);
  log.info(`主力模型: ${CONFIG.primaryModel}`);
  log.info(`备用模型: ${CONFIG.fallbackModel}`);
  log.info(`并发数:   ${CONFIG.concurrency}`);
  log.info(`inbox:    ${CONFIG.inboxDir}`);
  if (args.dryRun) {
    log.warn('DRY-RUN 模式：仅扫描，不实际处理');
  }
  log.separator();
  console.log();

  // ── 扫描待处理文件 ──
  let pdfs = await scanPendingPdfs();

  if (pdfs.length === 0) {
    log.info('没有发现待处理的 PDF 文件');
    return;
  }

  // 如果指定了目标文件，只处理该文件
  if (args.targetFile) {
    pdfs = pdfs.filter((p) => p.fileName === args.targetFile);
    if (pdfs.length === 0) {
      log.error(`未找到指定文件: ${args.targetFile}`);
      return;
    }
  }

  // ── 打印文件列表 ──
  log.info(`待处理文件 (${pdfs.length} 个):`);
  console.log();
  for (const pdf of pdfs) {
    const sizeStr = formatSize(pdf.sizeBytes).padStart(8);
    const needsSplit = pdf.sizeBytes > CONFIG.maxPdfSizeBytes ? ' [需分片]' : '';
    console.log(`  ${sizeStr}  ${pdf.fileName}${needsSplit}`);
  }
  console.log();

  if (args.dryRun) {
    log.info('DRY-RUN 完成');
    return;
  }

  // ── 并发处理 ──
  const limit = pLimit(CONFIG.concurrency);
  const startTime = Date.now();

  const tasks = pdfs.map((pdf, index) =>
    limit(async (): Promise<AnalysisResult> => {
      log.separator();
      log.progress(index + 1, pdfs.length, pdf.fileName);

      const result = await processPdf(pdf.filePath, pdf.fileName);

      return result;
    }),
  );

  // 使用 allSettled 确保一个失败不阻塞其他任务
  const settledResults = await Promise.allSettled(tasks);

  // ── 收集结果 ──
  const results: AnalysisResult[] = [];
  for (const settled of settledResults) {
    if (settled.status === 'fulfilled') {
      results.push(settled.value);
    } else {
      results.push({
        success: false,
        fileName: 'unknown',
        error: String(settled.reason),
        durationMs: 0,
      });
    }
  }

  // ── 打印汇总报告 ──
  const totalDuration = Date.now() - startTime;
  const successResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);

  console.log();
  log.separator();
  log.info('处理完成 — 汇总报告');
  log.separator();
  console.log();

  log.info(`总计:    ${results.length} 个文件`);
  log.success(`成功:    ${successResults.length} 个`);
  if (failedResults.length > 0) {
    log.error(`失败:    ${failedResults.length} 个`);
  }
  log.info(`总耗时:  ${(totalDuration / 1000).toFixed(1)}s`);
  console.log();

  // 成功列表
  if (successResults.length > 0) {
    log.info('成功处理:');
    for (const r of successResults) {
      const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
      console.log(`  ✓ ${r.fileName} → ${r.slug ?? '(已存在)'} (${dur})`);
    }
    console.log();
  }

  // 失败列表
  if (failedResults.length > 0) {
    log.info('处理失败:');
    for (const r of failedResults) {
      console.log(`  ✗ ${r.fileName}: ${r.error}`);
    }
    console.log();
  }

  log.separator();

  // 以失败数量作为退出码（0 表示全部成功）
  if (failedResults.length > 0) {
    process.exit(1);
  }
}

// ── 启动 ────────────────────────────────────────────────────

main().catch((err) => {
  log.error(`致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
