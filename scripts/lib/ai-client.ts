/**
 * AI 网关客户端
 *
 * 封装与 localhost:8000 的 OpenAI 兼容 API 通信，
 * 支持 multimodal 消息（PDF base64）、重试、超时、模型降级。
 */

import { CONFIG } from '../config.js';
import { log } from './logger.js';

// ── 类型定义 ────────────────────────────────────────────────

/** OpenAI 兼容的 multimodal 内容块 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: string;
    message: { content: string; role: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface RequestOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

// ── 辅助函数 ────────────────────────────────────────────────

/** 指数退避延迟 */
function backoffDelay(attempt: number): number {
  const jitter = Math.random() * 500;
  return CONFIG.retryBaseDelayMs * Math.pow(2, attempt) + jitter;
}

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── 核心请求函数 ────────────────────────────────────────────

/**
 * 发送聊天请求到 AI 网关（单次，不含重试逻辑）
 */
async function sendRequest(
  messages: ChatMessage[],
  opts: RequestOptions = {},
): Promise<ChatCompletionResponse> {
  const model = opts.model ?? CONFIG.primaryModel;
  const timeoutMs = opts.timeoutMs ?? CONFIG.requestTimeoutMs;

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: opts.maxTokens ?? CONFIG.maxTokens,
    temperature: opts.temperature ?? 0.3,
  });

  const resp = await fetchWithTimeout(
    CONFIG.apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body,
    },
    timeoutMs,
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    throw new Error(`API ${resp.status}: ${text}`);
  }

  return (await resp.json()) as ChatCompletionResponse;
}

// ── 带重试 + 降级的公开接口 ─────────────────────────────────

/**
 * 发送聊天请求，自动处理重试和模型降级。
 *
 * 重试策略：
 * 1. 先用 primaryModel 重试 maxRetries 次
 * 2. 全部失败后，用 fallbackModel 再试 1 次
 * 3. 仍然失败则抛出错误
 */
export async function chat(
  messages: ChatMessage[],
  opts: RequestOptions = {},
): Promise<string> {
  const model = opts.model ?? CONFIG.primaryModel;
  const ctx = `${model}`;

  // ── 主模型重试 ──
  for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
    try {
      const result = await sendRequest(messages, { ...opts, model });

      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI 返回了空内容');
      }

      // 打印 token 用量
      if (result.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        log.debug(
          `tokens: prompt=${prompt_tokens} completion=${completion_tokens} total=${total_tokens}`,
          ctx,
        );
      }

      // 检查是否被截断
      const finishReason = result.choices[0].finish_reason;
      if (finishReason === 'length') {
        log.warn('输出被截断（max_tokens 不足），将增加 token 重试', ctx);
        // 增加 token 限制重试
        const retryResult = await sendRequest(messages, {
          ...opts,
          model,
          maxTokens: (opts.maxTokens ?? CONFIG.maxTokens) * 2,
        });
        const retryContent = retryResult.choices?.[0]?.message?.content;
        if (retryContent) return retryContent;
      }

      return content;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`第 ${attempt + 1}/${CONFIG.maxRetries} 次请求失败: ${errMsg}`, ctx);

      if (attempt < CONFIG.maxRetries - 1) {
        const delay = backoffDelay(attempt);
        log.debug(`等待 ${Math.round(delay)}ms 后重试...`, ctx);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ── 降级到备用模型 ──
  if (model !== CONFIG.fallbackModel) {
    log.warn(`主模型 ${model} 全部失败，降级到 ${CONFIG.fallbackModel}`, ctx);
    try {
      const result = await sendRequest(messages, {
        ...opts,
        model: CONFIG.fallbackModel,
      });
      const content = result.choices?.[0]?.message?.content;
      if (content) {
        log.success(`备用模型 ${CONFIG.fallbackModel} 成功`, ctx);
        return content;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`备用模型也失败了: ${errMsg}`, ctx);
    }
  }

  throw new Error(`所有模型均失败，无法完成请求`);
}

/**
 * 构造包含 PDF base64 的 multimodal 消息
 */
export function buildPdfMessage(prompt: string, pdfBase64: string): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
      },
    ],
  };
}
