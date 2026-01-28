/**
 * Tests for src/config/env.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getClaudeEnv, getClaudeExtraArgs } from '../config/env.js';

describe('getClaudeExtraArgs', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.MODEL;
    delete process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_EXTRA_ARGS;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('returns empty object when no env vars are set', () => {
    const result = getClaudeExtraArgs();
    expect(result).toEqual({});
  });

  it('includes model when CLAUDE_MODEL is set', () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-20250514';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({ model: 'claude-sonnet-4-20250514' });
  });

  it('includes model when MODEL is set (Ollama compatibility)', () => {
    process.env.MODEL = 'gpt-oss:20b';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({ model: 'gpt-oss:20b' });
  });

  it('MODEL takes precedence over CLAUDE_MODEL', () => {
    process.env.MODEL = 'local-model';
    process.env.CLAUDE_MODEL = 'claude-model';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({ model: 'local-model' });
  });

  it('parses CLAUDE_EXTRA_ARGS as JSON', () => {
    process.env.CLAUDE_EXTRA_ARGS = '{"api-base": "http://localhost:11434/v1"}';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({ 'api-base': 'http://localhost:11434/v1' });
  });

  it('merges CLAUDE_MODEL with CLAUDE_EXTRA_ARGS', () => {
    process.env.CLAUDE_MODEL = 'llama3';
    process.env.CLAUDE_EXTRA_ARGS = '{"api-base": "http://localhost:11434/v1"}';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({
      model: 'llama3',
      'api-base': 'http://localhost:11434/v1',
    });
  });

  it('ignores invalid JSON in CLAUDE_EXTRA_ARGS', () => {
    process.env.CLAUDE_EXTRA_ARGS = 'not valid json';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({});
  });

  it('ignores non-object JSON in CLAUDE_EXTRA_ARGS', () => {
    process.env.CLAUDE_EXTRA_ARGS = '"just a string"';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({});
  });

  it('ignores null JSON in CLAUDE_EXTRA_ARGS', () => {
    process.env.CLAUDE_EXTRA_ARGS = 'null';
    const result = getClaudeExtraArgs();
    expect(result).toEqual({});
  });
});

describe('getClaudeEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    // Clear any CLAUDE_ENV_ prefixed vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CLAUDE_ENV_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('returns undefined when no relevant env vars are set', () => {
    const result = getClaudeEnv();
    expect(result).toBeUndefined();
  });

  it('includes ANTHROPIC_API_KEY when set (preserves process.env)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    // Should preserve PATH from process.env
    expect(result?.PATH).toBe(process.env.PATH);
  });

  it('includes empty ANTHROPIC_API_KEY for local models', () => {
    process.env.ANTHROPIC_API_KEY = '';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_API_KEY).toBe('');
  });

  it('includes ANTHROPIC_BASE_URL when set', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:11434';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
  });

  it('includes ANTHROPIC_AUTH_TOKEN when set', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'ollama';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
  });

  it('includes all Anthropic settings for Ollama setup', () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:11434';
    process.env.ANTHROPIC_AUTH_TOKEN = 'ollama';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_API_KEY).toBe('');
    expect(result?.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
    expect(result?.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
  });

  it('strips CLAUDE_ENV_ prefix and includes the value', () => {
    process.env.CLAUDE_ENV_MY_CUSTOM_VAR = 'custom-value';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.MY_CUSTOM_VAR).toBe('custom-value');
  });

  it('includes multiple CLAUDE_ENV_ prefixed vars', () => {
    process.env.CLAUDE_ENV_VAR1 = 'value1';
    process.env.CLAUDE_ENV_VAR2 = 'value2';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.VAR1).toBe('value1');
    expect(result?.VAR2).toBe('value2');
  });

  it('combines ANTHROPIC_API_KEY with CLAUDE_ENV_ vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.CLAUDE_ENV_CUSTOM = 'custom';
    const result = getClaudeEnv();
    expect(result).toBeDefined();
    expect(result?.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(result?.CUSTOM).toBe('custom');
  });
});
