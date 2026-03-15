/**
 * PDF 自动化处理系统 — 全局配置
 *
 * 通过环境变量覆盖默认值：
 *   OPENLENS_API_KEY   — AI 网关认证密钥
 *   OPENLENS_API_URL   — AI 网关地址
 *   OPENLENS_CONCURRENCY — 并发数
 */

import { resolve } from 'node:path';

// ── 项目根目录 ──────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, '..');

// ── 受控分类枚举（与 src/content.config.ts 保持同步） ────────
export const CATEGORIES = [
  '人工智能',
  '消费科技',
  '前沿趋势',
  '投资研究',
  '产业研究',
  '技术深度',
] as const;

export type Category = (typeof CATEGORIES)[number];

// ── 配置常量 ────────────────────────────────────────────────
export const CONFIG = {
  // AI 网关
  apiUrl: process.env.OPENLENS_API_URL ?? 'http://localhost:8000/v1/chat/completions',
  apiKey: process.env.OPENLENS_API_KEY ?? '',

  // 模型（使用 @ 语法显式指定上游，绕过网关的前缀路由兜底规则）
  primaryModel: 'gemini-2.5-flash@nanohajimi',
  fallbackModel: 'gemini-2.5-pro@nanohajimi',

  // 并发控制
  concurrency: Number(process.env.OPENLENS_CONCURRENCY) || 3,

  // 请求参数
  requestTimeoutMs: 300_000,  // 单次请求 5 分钟超时（大 PDF 需要较久）
  maxTokens: 16_384,          // 输出 token 上限

  // 分片策略
  maxPdfSizeBytes: 30 * 1024 * 1024, // 超过 30MB 触发分片
  maxPagesPerChunk: 50,               // 每个 chunk 最多 50 页

  // 重试策略
  maxRetries: 3,
  retryBaseDelayMs: 2_000,

  // 目录路径
  inboxDir: resolve(ROOT, 'inbox/pdf'),
  outputReportsDir: resolve(ROOT, 'src/content/reports'),
  outputPdfDir: resolve(ROOT, 'public/pdf'),

  // 日志
  logDir: resolve(ROOT, 'scripts/logs'),
} as const;
