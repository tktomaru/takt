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
 * Note: override=true ensures .env values take precedence over shell environment.
 */
export function loadEnv(projectDir: string): void {
  const envPath = join(projectDir, '.env');
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

/**
 * Get extra CLI arguments for Claude from environment variables.
 * These are passed to the SDK via the extraArgs option.
 *
 * Supported environment variables:
 * - MODEL or CLAUDE_MODEL: Model name override
 * - CLAUDE_EXTRA_ARGS: JSON object of additional arguments
 */
export function getClaudeExtraArgs(): Record<string, string | null> {
  const extraArgs: Record<string, string | null> = {};

  // Model override (MODEL takes precedence over CLAUDE_MODEL for Ollama compatibility)
  const model = process.env.MODEL ?? process.env.CLAUDE_MODEL;
  if (model) {
    extraArgs['model'] = model;
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
 * Starts with process.env and overlays Anthropic API settings.
 *
 * Supported environment variables:
 * - ANTHROPIC_API_KEY: API key (can be empty for local models)
 * - ANTHROPIC_BASE_URL: Custom API endpoint (e.g., http://localhost:11434 for Ollama)
 * - ANTHROPIC_AUTH_TOKEN: Auth token (e.g., "ollama" for local models)
 * - CLAUDE_ENV_*: Any variable with this prefix is passed with prefix stripped
 *
 * Returns undefined if no custom settings are needed (SDK will use process.env by default).
 */
export function getClaudeEnv(): Record<string, string | undefined> | undefined {
  // Check if any custom env vars are set
  const hasAnthropicSettings =
    process.env.ANTHROPIC_API_KEY !== undefined ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_AUTH_TOKEN;

  const hasClaudeEnvVars = Object.keys(process.env).some((key) =>
    key.startsWith('CLAUDE_ENV_')
  );

  // If no custom settings, return undefined to let SDK use process.env directly
  if (!hasAnthropicSettings && !hasClaudeEnvVars) {
    return undefined;
  }

  // Start with a copy of process.env to preserve PATH and other essential vars
  const env: Record<string, string | undefined> = { ...process.env };

  // Pass through any CLAUDE_ENV_* variables (stripping the prefix)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_ENV_')) {
      const envKey = key.slice('CLAUDE_ENV_'.length);
      env[envKey] = value;
    }
  }

  return env;
}
