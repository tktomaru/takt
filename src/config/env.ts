/**
 * Environment variable loading for Claude SDK options
 *
 * Loads .env files and extracts Claude-specific configuration
 * for local models and custom API endpoints.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load .env file from the specified directory.
 * Does nothing if the file doesn't exist.
 */
export function loadEnv(projectDir: string): void {
  const envPath = join(projectDir, '.env');
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

/**
 * Get extra CLI arguments for Claude from environment variables.
 * These are passed to the SDK via the extraArgs option.
 *
 * Supported environment variables:
 * - CLAUDE_MODEL: Model name override
 * - CLAUDE_EXTRA_ARGS: JSON object of additional arguments
 */
export function getClaudeExtraArgs(): Record<string, string | null> {
  const extraArgs: Record<string, string | null> = {};

  // Model override
  if (process.env.CLAUDE_MODEL) {
    extraArgs['model'] = process.env.CLAUDE_MODEL;
  }

  // Parse additional args from JSON if provided
  if (process.env.CLAUDE_EXTRA_ARGS) {
    try {
      const parsed = JSON.parse(process.env.CLAUDE_EXTRA_ARGS);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(extraArgs, parsed);
      }
    } catch {
      // Ignore JSON parse errors - invalid config is silently skipped
    }
  }

  return extraArgs;
}

/**
 * Get environment variables to pass to the Claude process.
 * Includes ANTHROPIC_API_KEY and any CLAUDE_ENV_* prefixed variables.
 */
export function getClaudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};

  // Pass through ANTHROPIC_API_KEY if set
  if (process.env.ANTHROPIC_API_KEY) {
    env['ANTHROPIC_API_KEY'] = process.env.ANTHROPIC_API_KEY;
  }

  // Pass through any CLAUDE_ENV_* variables (stripping the prefix)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_ENV_')) {
      const envKey = key.slice('CLAUDE_ENV_'.length);
      env[envKey] = value;
    }
  }

  return env;
}
