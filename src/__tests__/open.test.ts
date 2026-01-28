/**
 * /open command tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// Mock child_process module
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
    spawnSync: vi.fn(),
  };
});

import {
  isTmuxInstalled,
  tmuxSessionExists,
} from '../commands/open.js';

describe('open command', () => {
  const testDir = `/tmp/takt-open-test-${Date.now()}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(join(testDir, '.takt', 'logs'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('isTmuxInstalled', () => {
    it('should return true when tmux is installed', () => {
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from('/usr/bin/tmux'));
      expect(isTmuxInstalled()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which tmux', { stdio: 'pipe' });
    });

    it('should return false when tmux is not installed', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('tmux not found');
      });
      expect(isTmuxInstalled()).toBe(false);
    });
  });

  describe('tmuxSessionExists', () => {
    it('should return true when session exists', () => {
      vi.mocked(execSync).mockReturnValueOnce(Buffer.from(''));
      expect(tmuxSessionExists('test-session')).toBe(true);
      expect(execSync).toHaveBeenCalledWith('tmux has-session -t test-session', { stdio: 'pipe' });
    });

    it('should return false when session does not exist', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('session not found');
      });
      expect(tmuxSessionExists('nonexistent')).toBe(false);
    });
  });
});
