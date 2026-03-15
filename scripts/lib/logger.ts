/**
 * 轻量日志工具
 *
 * 提供带颜色的终端输出和文件日志记录，不引入第三方依赖。
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG } from '../config.js';

// ── ANSI 颜色 ───────────────────────────────────────────────
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

const LEVEL_STYLES: Record<LogLevel, { color: string; prefix: string }> = {
  info:    { color: COLORS.cyan,    prefix: 'INFO' },
  success: { color: COLORS.green,   prefix: ' OK ' },
  warn:    { color: COLORS.yellow,  prefix: 'WARN' },
  error:   { color: COLORS.red,     prefix: 'FAIL' },
  debug:   { color: COLORS.dim,     prefix: 'DBG ' },
};

// ── 确保日志目录存在 ─────────────────────────────────────────
mkdirSync(CONFIG.logDir, { recursive: true });

const logFilePath = resolve(
  CONFIG.logDir,
  `process-${new Date().toISOString().slice(0, 10)}.log`,
);

/** 获取当前时间戳字符串 */
function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

/** 写入日志文件（纯文本，无颜色） */
function writeToFile(level: string, message: string): void {
  const line = `[${timestamp()}] [${level}] ${message}\n`;
  try {
    appendFileSync(logFilePath, line);
  } catch {
    // 日志写入失败不应阻塞主流程
  }
}

/** 输出到终端 */
function print(level: LogLevel, message: string, context?: string): void {
  const style = LEVEL_STYLES[level];
  const ts = `${COLORS.dim}${timestamp()}${COLORS.reset}`;
  const tag = `${style.color}[${style.prefix}]${COLORS.reset}`;
  const ctx = context ? ` ${COLORS.magenta}(${context})${COLORS.reset}` : '';

  console.log(`${ts} ${tag}${ctx} ${message}`);
  writeToFile(style.prefix.trim(), context ? `[${context}] ${message}` : message);
}

// ── 导出的日志方法 ───────────────────────────────────────────
export const log = {
  info:    (msg: string, ctx?: string): void => print('info', msg, ctx),
  success: (msg: string, ctx?: string): void => print('success', msg, ctx),
  warn:    (msg: string, ctx?: string): void => print('warn', msg, ctx),
  error:   (msg: string, ctx?: string): void => print('error', msg, ctx),
  debug:   (msg: string, ctx?: string): void => print('debug', msg, ctx),

  /** 打印分隔线 */
  separator: (): void => {
    const line = `${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`;
    console.log(line);
  },

  /** 打印处理进度 */
  progress: (current: number, total: number, fileName: string): void => {
    const pct = Math.round((current / total) * 100);
    const bar = `[${current}/${total}]`;
    print('info', `${bar} (${pct}%) ${fileName}`);
  },
};
