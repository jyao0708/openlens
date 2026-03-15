/**
 * PDF 分片工具
 *
 * 当 PDF 文件过大时，按页拆分为多个较小的 PDF chunk，
 * 每个 chunk 独立发送给 AI 分析，最后合并结果。
 */

import { readFile, stat as fsStat } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { CONFIG } from '../config.js';
import { log } from './logger.js';

export interface PdfChunk {
  /** chunk 序号（从 1 开始） */
  index: number;
  /** 总 chunk 数 */
  total: number;
  /** 该 chunk 包含的起始页码（从 1 开始） */
  startPage: number;
  /** 该 chunk 包含的结束页码 */
  endPage: number;
  /** 该 chunk 的 PDF 内容（base64 编码） */
  base64: string;
  /** 该 chunk 的字节大小 */
  sizeBytes: number;
}

export interface PdfInfo {
  /** PDF 总页数 */
  pageCount: number;
  /** 原始文件字节大小 */
  sizeBytes: number;
  /** 是否需要分片 */
  needsSplit: boolean;
  /** 缓存的文件内容（避免后续重复读取） */
  buffer: Buffer;
}

/**
 * 读取 PDF 基本信息并缓存文件内容
 *
 * 返回的 buffer 会在后续 pdfToBase64 / splitPdf 中复用，避免对大文件重复读取。
 */
export async function getPdfInfo(filePath: string): Promise<PdfInfo> {
  const buffer = Buffer.from(await readFile(filePath));
  const sizeBytes = buffer.byteLength;

  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();

  return {
    pageCount,
    sizeBytes,
    needsSplit: sizeBytes > CONFIG.maxPdfSizeBytes,
    buffer,
  };
}

/**
 * 将已缓存的 PDF buffer 编码为 base64（整体，不分片）
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * 将 PDF 文件编码为 base64（整体，不分片）
 * 当没有缓存 buffer 时使用
 */
export async function pdfToBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return Buffer.from(buffer).toString('base64');
}

/**
 * 从已缓存的 buffer 拆分大 PDF 为多个小 chunk
 *
 * 分片策略：按 maxPagesPerChunk 分割
 */
export async function splitPdfFromBuffer(buffer: Buffer, fileName: string): Promise<PdfChunk[]> {
  const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = sourcePdf.getPageCount();

  const ctx = fileName;
  log.info(`开始分片: 共 ${totalPages} 页`, ctx);

  // 计算 chunk 数量
  const pagesPerChunk = CONFIG.maxPagesPerChunk;
  const chunkCount = Math.ceil(totalPages / pagesPerChunk);

  log.info(`分片方案: ${chunkCount} 个 chunk, 每 chunk ≤${pagesPerChunk} 页`, ctx);

  const chunks: PdfChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const startPage = i * pagesPerChunk;
    const endPage = Math.min(startPage + pagesPerChunk, totalPages);
    const pageIndices = Array.from({ length: endPage - startPage }, (_, j) => startPage + j);

    // 创建新的 PDF 文档，只包含这些页
    const chunkPdf = await PDFDocument.create();
    const copiedPages = await chunkPdf.copyPages(sourcePdf, pageIndices);
    for (const page of copiedPages) {
      chunkPdf.addPage(page);
    }

    const chunkBytes = await chunkPdf.save();
    const base64 = Buffer.from(chunkBytes).toString('base64');

    const chunk: PdfChunk = {
      index: i + 1,
      total: chunkCount,
      startPage: startPage + 1, // 转为 1-based
      endPage,
      base64,
      sizeBytes: chunkBytes.byteLength,
    };

    chunks.push(chunk);

    const sizeMB = (chunkBytes.byteLength / 1024 / 1024).toFixed(1);
    log.debug(`chunk ${i + 1}/${chunkCount}: 第 ${startPage + 1}-${endPage} 页, ${sizeMB}MB`, ctx);
  }

  return chunks;
}

/**
 * 将大 PDF 文件拆分为多个小 chunk（从文件路径读取）
 * 兼容旧接口，内部会读取文件
 */
export async function splitPdf(filePath: string): Promise<PdfChunk[]> {
  const buffer = Buffer.from(await readFile(filePath));
  const fileName = filePath.split('/').pop() ?? filePath;
  return splitPdfFromBuffer(buffer, fileName);
}
