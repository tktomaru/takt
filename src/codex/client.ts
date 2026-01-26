/**
 * Codex SDK integration for agent interactions
 *
 * Uses @openai/codex-sdk for native TypeScript integration.
 */

import { Codex } from '@openai/codex-sdk';
import type { AgentResponse, Status } from '../models/types.js';
import { GENERIC_STATUS_PATTERNS } from '../models/schemas.js';
import { detectStatus } from '../claude/client.js';
import type { StreamCallback } from '../claude/process.js';
import { createLogger } from '../utils/debug.js';

const log = createLogger('codex-sdk');

/** Options for calling Codex */
export interface CodexCallOptions {
  cwd: string;
  sessionId?: string;
  model?: string;
  systemPrompt?: string;
  statusPatterns?: Record<string, string>;
  /** Enable streaming mode with callback (best-effort) */
  onStream?: StreamCallback;
}

function extractThreadId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.thread_id ?? record.threadId;
  return typeof id === 'string' ? id : undefined;
}

function normalizeCodexResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return String(result);

  const record = result as Record<string, unknown>;
  const directFields = ['output_text', 'output', 'content', 'text', 'message'];
  for (const field of directFields) {
    const value = record[field];
    if (typeof value === 'string') {
      return value;
    }
  }

  if (Array.isArray(record.output)) {
    const first = record.output[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const text = (first as Record<string, unknown>).text;
      if (typeof text === 'string') return text;
    }
  }

  if (Array.isArray(record.choices)) {
    const firstChoice = record.choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === 'string') return content;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function emitInit(
  onStream: StreamCallback | undefined,
  model: string | undefined,
  sessionId: string | undefined
): void {
  if (!onStream) return;
  onStream({
    type: 'init',
    data: {
      model: model || 'codex',
      sessionId: sessionId || 'unknown',
    },
  });
}

function emitText(onStream: StreamCallback | undefined, text: string): void {
  if (!onStream || !text) return;
  onStream({ type: 'text', data: { text } });
}

function emitResult(
  onStream: StreamCallback | undefined,
  success: boolean,
  result: string,
  sessionId: string | undefined
): void {
  if (!onStream) return;
  onStream({
    type: 'result',
    data: {
      result,
      sessionId: sessionId || 'unknown',
      success,
    },
  });
}

function determineStatus(content: string, patterns: Record<string, string>): Status {
  return detectStatus(content, patterns);
}

/**
 * Call Codex with an agent prompt.
 */
export async function callCodex(
  agentType: string,
  prompt: string,
  options: CodexCallOptions
): Promise<AgentResponse> {
  const codex = new Codex();
  const thread = options.sessionId
    ? await codex.resumeThread(options.sessionId)
    : await codex.startThread();
  const threadId = extractThreadId(thread) || options.sessionId;

  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${prompt}`
    : prompt;

  emitInit(options.onStream, options.model, threadId);

  try {
    log.debug('Executing Codex thread', {
      agentType,
      model: options.model,
      hasSystemPrompt: !!options.systemPrompt,
    });

    const runOptions = options.model ? { model: options.model } : undefined;
    const result = await (thread as { run: (p: string, o?: unknown) => Promise<unknown> })
      .run(fullPrompt, runOptions);

    const content = normalizeCodexResult(result).trim();
    emitText(options.onStream, content);
    emitResult(options.onStream, true, content, threadId);

    const patterns = options.statusPatterns || GENERIC_STATUS_PATTERNS;
    const status = determineStatus(content, patterns);

    return {
      agent: agentType,
      status,
      content,
      timestamp: new Date(),
      sessionId: threadId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitResult(options.onStream, false, message, threadId);

    return {
      agent: agentType,
      status: 'blocked',
      content: message,
      timestamp: new Date(),
      sessionId: threadId,
    };
  }
}

/**
 * Call Codex with a custom agent configuration (system prompt + prompt).
 */
export async function callCodexCustom(
  agentName: string,
  prompt: string,
  systemPrompt: string,
  options: CodexCallOptions
): Promise<AgentResponse> {
  return callCodex(agentName, prompt, {
    ...options,
    systemPrompt,
  });
}
