/**
 * Tests for parallel execution functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTasksFromSource, executeParallelStep, aggregateParallelResult } from '../workflow/parallel-executor.js';
import type { WorkflowStep, ParallelStepResult } from '../models/types.js';

describe('parallel-executor', () => {
  let testDir: string;
  let taskDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `takt-parallel-test-${Date.now()}`);
    taskDir = join(testDir, 'tasks');
    mkdirSync(taskDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadTasksFromSource', () => {
    it('should load .md files from task directory', () => {
      writeFileSync(join(taskDir, 'task1.md'), 'Task 1 content');
      writeFileSync(join(taskDir, 'task2.md'), 'Task 2 content');

      const tasks = loadTasksFromSource('tasks', testDir);

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.name).toBe('task1');
      expect(tasks[0]?.content).toBe('Task 1 content');
      expect(tasks[1]?.name).toBe('task2');
      expect(tasks[1]?.content).toBe('Task 2 content');
    });

    it('should load .txt files from task directory', () => {
      writeFileSync(join(taskDir, 'task1.txt'), 'Task 1 content');

      const tasks = loadTasksFromSource('tasks', testDir);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.name).toBe('task1');
      expect(tasks[0]?.content).toBe('Task 1 content');
    });

    it('should skip empty files', () => {
      writeFileSync(join(taskDir, 'empty.md'), '');
      writeFileSync(join(taskDir, 'whitespace.md'), '   \n  ');
      writeFileSync(join(taskDir, 'valid.md'), 'Valid content');

      const tasks = loadTasksFromSource('tasks', testDir);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.name).toBe('valid');
    });

    it('should return empty array for non-existent directory', () => {
      const tasks = loadTasksFromSource('nonexistent', testDir);
      expect(tasks).toHaveLength(0);
    });

    it('should sort tasks by filename', () => {
      writeFileSync(join(taskDir, 'c-task.md'), 'C');
      writeFileSync(join(taskDir, 'a-task.md'), 'A');
      writeFileSync(join(taskDir, 'b-task.md'), 'B');

      const tasks = loadTasksFromSource('tasks', testDir);

      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.name).toBe('a-task');
      expect(tasks[1]?.name).toBe('b-task');
      expect(tasks[2]?.name).toBe('c-task');
    });

    it('should ignore non-md/txt files', () => {
      writeFileSync(join(taskDir, 'task.md'), 'Valid');
      writeFileSync(join(taskDir, 'data.json'), '{}');
      writeFileSync(join(taskDir, 'script.sh'), 'echo hello');

      const tasks = loadTasksFromSource('tasks', testDir);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.name).toBe('task');
    });
  });

  describe('aggregateParallelResult', () => {
    const mockStep: WorkflowStep = {
      name: 'test-step',
      agent: 'test-agent',
      agentDisplayName: 'TestAgent',
      instructionTemplate: '{task}',
      transitions: [],
      passPreviousResponse: false,
      parallel: true,
      maxWorkers: 4,
      taskSource: 'tasks',
    };

    it('should return done status when all jobs succeed', () => {
      const result: ParallelStepResult = {
        jobs: [
          {
            taskName: 'task1',
            taskFile: '/path/task1.md',
            response: { agent: 'test', status: 'done', content: 'Done', timestamp: new Date() },
            success: true,
          },
          {
            taskName: 'task2',
            taskFile: '/path/task2.md',
            response: { agent: 'test', status: 'approved', content: 'Approved', timestamp: new Date() },
            success: true,
          },
        ],
        totalJobs: 2,
        successCount: 2,
        failedCount: 0,
        allSucceeded: true,
      };

      const response = aggregateParallelResult(mockStep, result);

      expect(response.status).toBe('done');
      expect(response.content).toContain('[TESTAGENT:DONE]');
      expect(response.content).toContain('**Total jobs**: 2');
      expect(response.content).toContain('**Successful**: 2');
    });

    it('should return blocked status when some jobs fail', () => {
      const result: ParallelStepResult = {
        jobs: [
          {
            taskName: 'task1',
            taskFile: '/path/task1.md',
            response: { agent: 'test', status: 'done', content: 'Done', timestamp: new Date() },
            success: true,
          },
          {
            taskName: 'task2',
            taskFile: '/path/task2.md',
            response: { agent: 'test', status: 'blocked', content: 'Failed', timestamp: new Date() },
            success: false,
          },
        ],
        totalJobs: 2,
        successCount: 1,
        failedCount: 1,
        allSucceeded: false,
      };

      const response = aggregateParallelResult(mockStep, result);

      expect(response.status).toBe('blocked');
      expect(response.content).toContain('[TESTAGENT:BLOCKED]');
      expect(response.content).toContain('**Failed**: 1');
    });

    it('should handle empty job list', () => {
      const result: ParallelStepResult = {
        jobs: [],
        totalJobs: 0,
        successCount: 0,
        failedCount: 0,
        allSucceeded: true,
      };

      const response = aggregateParallelResult(mockStep, result);

      expect(response.status).toBe('done');
      expect(response.content).toContain('**Total jobs**: 0');
    });
  });

  describe('WorkflowStep parallel fields', () => {
    it('should have parallel fields in step interface', () => {
      const step: WorkflowStep = {
        name: 'parallel-step',
        agent: 'executor',
        agentDisplayName: 'Executor',
        instructionTemplate: '{task}',
        transitions: [],
        passPreviousResponse: false,
        parallel: true,
        maxWorkers: 8,
        taskSource: 'queue/tasks',
      };

      expect(step.parallel).toBe(true);
      expect(step.maxWorkers).toBe(8);
      expect(step.taskSource).toBe('queue/tasks');
    });

    it('should support non-parallel step defaults', () => {
      const step: WorkflowStep = {
        name: 'sequential-step',
        agent: 'planner',
        agentDisplayName: 'Planner',
        instructionTemplate: '{task}',
        transitions: [],
        passPreviousResponse: true,
        parallel: false,
        maxWorkers: 4,
      };

      expect(step.parallel).toBe(false);
      expect(step.taskSource).toBeUndefined();
    });
  });
});

describe('executeParallelStep', () => {
  let testDir: string;
  let taskDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `takt-parallel-exec-test-${Date.now()}`);
    taskDir = join(testDir, 'tasks');
    mkdirSync(taskDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw error when task_source is not specified', async () => {
    const step: WorkflowStep = {
      name: 'no-source',
      agent: 'test',
      agentDisplayName: 'Test',
      instructionTemplate: '{task}',
      transitions: [],
      passPreviousResponse: false,
      parallel: true,
      maxWorkers: 4,
      // taskSource is undefined
    };

    await expect(
      executeParallelStep(step, {
        cwd: testDir,
        projectCwd: testDir,
        baseInstruction: '{task}',
        agentOptions: {},
      })
    ).rejects.toThrow('requires task_source');
  });

  it('should return empty result for empty task directory', async () => {
    const step: WorkflowStep = {
      name: 'empty-tasks',
      agent: 'test',
      agentDisplayName: 'Test',
      instructionTemplate: '{task}',
      transitions: [],
      passPreviousResponse: false,
      parallel: true,
      maxWorkers: 4,
      taskSource: 'tasks',
    };

    const result = await executeParallelStep(step, {
      cwd: testDir,
      projectCwd: testDir,
      baseInstruction: '{task}',
      agentOptions: {},
    });

    expect(result.totalJobs).toBe(0);
    expect(result.allSucceeded).toBe(true);
  });
});
