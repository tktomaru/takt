/**
 * Tests for debug logging utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initDebugLogger,
  resetDebugLogger,
  createLogger,
  isDebugEnabled,
  getDebugLogFile,
  setVerboseConsole,
  isVerboseConsole,
  debugLog,
  infoLog,
  errorLog,
  getAgentLogsDir,
  getAgentLogFile,
  initAgentLog,
  writeAgentLog,
  logAgentStepStart,
  logAgentStepComplete,
} from '../utils/debug.js';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('debug logging', () => {
  beforeEach(() => {
    resetDebugLogger();
  });

  afterEach(() => {
    resetDebugLogger();
  });

  describe('initDebugLogger', () => {
    it('should not enable debug when config is undefined', () => {
      initDebugLogger(undefined, '/tmp');
      expect(isDebugEnabled()).toBe(false);
      expect(getDebugLogFile()).toBeNull();
    });

    it('should not enable debug when enabled is false', () => {
      initDebugLogger({ enabled: false }, '/tmp');
      expect(isDebugEnabled()).toBe(false);
    });

    it('should enable debug when enabled is true', () => {
      initDebugLogger({ enabled: true }, '/tmp');
      expect(isDebugEnabled()).toBe(true);
      expect(getDebugLogFile()).not.toBeNull();
    });

    it('should use custom log file when provided', () => {
      const logDir = join(tmpdir(), 'takt-test-debug-' + Date.now());
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, 'test.log');

      try {
        initDebugLogger({ enabled: true, logFile }, '/tmp');
        expect(getDebugLogFile()).toBe(logFile);
        expect(existsSync(logFile)).toBe(true);

        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('TAKT Debug Log');
      } finally {
        rmSync(logDir, { recursive: true, force: true });
      }
    });

    it('should only initialize once', () => {
      initDebugLogger({ enabled: true }, '/tmp');
      const firstFile = getDebugLogFile();

      initDebugLogger({ enabled: false }, '/tmp');
      expect(isDebugEnabled()).toBe(true);
      expect(getDebugLogFile()).toBe(firstFile);
    });
  });

  describe('resetDebugLogger', () => {
    it('should reset all state', () => {
      initDebugLogger({ enabled: true }, '/tmp');
      setVerboseConsole(true);

      resetDebugLogger();

      expect(isDebugEnabled()).toBe(false);
      expect(getDebugLogFile()).toBeNull();
      expect(isVerboseConsole()).toBe(false);
    });
  });

  describe('setVerboseConsole / isVerboseConsole', () => {
    it('should default to false', () => {
      expect(isVerboseConsole()).toBe(false);
    });

    it('should enable verbose console', () => {
      setVerboseConsole(true);
      expect(isVerboseConsole()).toBe(true);
    });

    it('should disable verbose console', () => {
      setVerboseConsole(true);
      setVerboseConsole(false);
      expect(isVerboseConsole()).toBe(false);
    });
  });

  describe('verbose console output', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
    });

    it('should not output to stderr when verbose is disabled', () => {
      debugLog('test', 'hello');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should output debug to stderr when verbose is enabled', () => {
      setVerboseConsole(true);
      debugLog('test', 'hello debug');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('[DEBUG]');
      expect(output).toContain('[test]');
      expect(output).toContain('hello debug');
    });

    it('should output info to stderr when verbose is enabled', () => {
      setVerboseConsole(true);
      infoLog('mycomp', 'info message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('[INFO]');
      expect(output).toContain('[mycomp]');
      expect(output).toContain('info message');
    });

    it('should output error to stderr when verbose is enabled', () => {
      setVerboseConsole(true);
      errorLog('mycomp', 'error message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('[ERROR]');
      expect(output).toContain('[mycomp]');
      expect(output).toContain('error message');
    });

    it('should include timestamp in console output', () => {
      setVerboseConsole(true);
      debugLog('test', 'with timestamp');

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      // Timestamp format: HH:mm:ss.SSS
      expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });

  describe('createLogger', () => {
    it('should create a logger with the given component name', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      setVerboseConsole(true);

      const log = createLogger('my-component');
      log.debug('test message');

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('[my-component]');

      stderrSpy.mockRestore();
    });

    it('should provide debug, info, error, enter, exit methods', () => {
      const log = createLogger('test');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.enter).toBe('function');
      expect(typeof log.exit).toBe('function');
    });
  });

  describe('file logging with verbose console', () => {
    it('should write to both file and stderr when both are enabled', () => {
      const logDir = join(tmpdir(), 'takt-test-debug-both-' + Date.now());
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, 'test.log');

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        initDebugLogger({ enabled: true, logFile }, '/tmp');
        setVerboseConsole(true);

        debugLog('test', 'dual output');

        // Check stderr
        expect(stderrSpy).toHaveBeenCalledTimes(1);
        const stderrOutput = stderrSpy.mock.calls[0]?.[0] as string;
        expect(stderrOutput).toContain('dual output');

        // Check file
        const fileContent = readFileSync(logFile, 'utf-8');
        expect(fileContent).toContain('dual output');
      } finally {
        stderrSpy.mockRestore();
        rmSync(logDir, { recursive: true, force: true });
      }
    });

    it('should output to stderr even when file logging is disabled', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        // File logging not enabled, but verbose console is
        setVerboseConsole(true);
        debugLog('test', 'console only');

        expect(stderrSpy).toHaveBeenCalledTimes(1);
        const output = stderrSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('console only');
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  describe('agent-specific logging', () => {
    const testAgentLogsDir = getAgentLogsDir();

    afterEach(() => {
      // Clean up test agent logs
      try {
        const testLogFile = getAgentLogFile('test-agent');
        if (existsSync(testLogFile)) {
          rmSync(testLogFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    });

    describe('getAgentLogsDir', () => {
      it('should return path under ~/.takt/logs/agents', () => {
        const dir = getAgentLogsDir();
        expect(dir).toContain('.takt');
        expect(dir).toContain('logs');
        expect(dir).toContain('agents');
      });
    });

    describe('getAgentLogFile', () => {
      it('should return path for agent log file', () => {
        const logFile = getAgentLogFile('coder');
        expect(logFile).toContain('coder.log');
      });

      it('should normalize agent names with path separators', () => {
        const logFile = getAgentLogFile('default/coder');
        expect(logFile).toContain('default-coder.log');
      });

      it('should remove .md extension from agent names', () => {
        const logFile = getAgentLogFile('coder.md');
        expect(logFile).toContain('coder.log');
        expect(logFile).not.toContain('.md');
      });
    });

    describe('initAgentLog', () => {
      it('should create agent log file with header', () => {
        const logFile = initAgentLog('test-agent');
        expect(existsSync(logFile)).toBe(true);

        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('Agent: test-agent');
        expect(content).toContain('Started:');
      });
    });

    describe('writeAgentLog', () => {
      it('should append content to agent log file', () => {
        initAgentLog('test-agent');
        writeAgentLog('test-agent', 'Test content\n');
        writeAgentLog('test-agent', 'More content\n');

        const logFile = getAgentLogFile('test-agent');
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('Test content');
        expect(content).toContain('More content');
      });
    });

    describe('logAgentStepStart', () => {
      it('should write step start marker with iteration', () => {
        initAgentLog('test-agent');
        logAgentStepStart('test-agent', 'implement', 3);

        const logFile = getAgentLogFile('test-agent');
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('Step: implement');
        expect(content).toContain('iteration 3');
      });
    });

    describe('logAgentStepComplete', () => {
      it('should write step completion with status', () => {
        initAgentLog('test-agent');
        logAgentStepComplete('test-agent', 'done');

        const logFile = getAgentLogFile('test-agent');
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('completed with status: done');
      });
    });
  });
});
