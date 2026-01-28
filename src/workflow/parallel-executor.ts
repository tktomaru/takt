/**
 * Parallel execution module for workflow steps
 *
 * Manages concurrent execution of multiple tasks using a worker pool pattern
 * with semaphore-based concurrency control.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { EventEmitter } from 'node:events';
import type {
  WorkflowStep,
  AgentResponse,
  ParallelJobResult,
  ParallelStepResult,
} from '../models/types.js';
import { runAgent, type RunAgentOptions } from '../agents/runner.js';
import { createLogger } from '../utils/debug.js';

const log = createLogger('parallel-executor');

/** Task file content */
interface TaskFile {
  name: string;
  path: string;
  content: string;
}

/** Options for parallel execution */
export interface ParallelExecutorOptions {
  /** Working directory for agent execution */
  cwd: string;
  /** Project root directory (where .takt/ lives) */
  projectCwd: string;
  /** Base instruction template variables */
  baseInstruction: string;
  /** Agent options passed to runAgent */
  agentOptions: Omit<RunAgentOptions, 'cwd'>;
  /** Event emitter for progress updates */
  emitter?: EventEmitter;
}

/**
 * Semaphore for controlling concurrent access
 */
class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

/**
 * Load task files from a source directory
 *
 * Reads all .md and .txt files from the specified directory.
 * Files are sorted by name for deterministic execution order.
 */
export function loadTasksFromSource(taskSource: string, projectCwd: string): TaskFile[] {
  const taskDir = join(projectCwd, taskSource);

  if (!existsSync(taskDir)) {
    log.warn('Task source directory not found', { taskDir });
    return [];
  }

  const stat = statSync(taskDir);
  if (!stat.isDirectory()) {
    log.warn('Task source is not a directory', { taskDir });
    return [];
  }

  const files = readdirSync(taskDir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
    .sort();

  const tasks: TaskFile[] = [];

  for (const file of files) {
    const filePath = join(taskDir, file);
    const fileStat = statSync(filePath);

    if (!fileStat.isFile()) continue;

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      log.debug('Skipping empty task file', { file });
      continue;
    }

    tasks.push({
      name: basename(file, file.endsWith('.md') ? '.md' : '.txt'),
      path: filePath,
      content,
    });
  }

  log.debug('Loaded tasks from source', {
    taskSource,
    count: tasks.length,
    tasks: tasks.map((t) => t.name),
  });

  return tasks;
}

/**
 * Execute a single job (task file) with the specified agent
 */
async function executeJob(
  task: TaskFile,
  step: WorkflowStep,
  options: ParallelExecutorOptions
): Promise<ParallelJobResult> {
  const instruction = options.baseInstruction.replace('{task}', task.content);

  log.debug('Executing parallel job', {
    taskName: task.name,
    agent: step.agent,
  });

  const agentOptions: RunAgentOptions = {
    ...options.agentOptions,
    cwd: options.cwd,
    // Don't reuse session for parallel jobs - each needs its own
    sessionId: undefined,
  };

  try {
    const response = await runAgent(step.agent, instruction, agentOptions);

    const success = response.status === 'done' || response.status === 'approved';

    return {
      taskName: task.name,
      taskFile: task.path,
      response,
      success,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Job execution failed', { taskName: task.name, error: errorMessage });

    return {
      taskName: task.name,
      taskFile: task.path,
      response: {
        agent: step.agent,
        status: 'blocked',
        content: `Execution error: ${errorMessage}`,
        timestamp: new Date(),
        error: errorMessage,
      },
      success: false,
    };
  }
}

/**
 * Execute a workflow step in parallel mode
 *
 * Loads task files from the specified source directory and executes them
 * concurrently, limited by maxWorkers.
 */
export async function executeParallelStep(
  step: WorkflowStep,
  options: ParallelExecutorOptions
): Promise<ParallelStepResult> {
  if (!step.taskSource) {
    throw new Error(`Parallel step "${step.name}" requires task_source to be specified`);
  }

  const tasks = loadTasksFromSource(step.taskSource, options.projectCwd);

  if (tasks.length === 0) {
    log.warn('No tasks found for parallel execution', {
      step: step.name,
      taskSource: step.taskSource,
    });

    return {
      jobs: [],
      totalJobs: 0,
      successCount: 0,
      failedCount: 0,
      allSucceeded: true,
    };
  }

  const maxWorkers = step.maxWorkers;
  const semaphore = new Semaphore(maxWorkers);

  log.info('Starting parallel execution', {
    step: step.name,
    totalTasks: tasks.length,
    maxWorkers,
  });

  // Emit parallel start event if emitter is provided
  options.emitter?.emit('parallel:start', step, tasks.length, maxWorkers);

  const jobPromises = tasks.map(async (task) => {
    await semaphore.acquire();
    try {
      const result = await executeJob(task, step, options);

      // Emit job complete event
      options.emitter?.emit('parallel:job_complete', step, task.name, result.success);

      return result;
    } finally {
      semaphore.release();
    }
  });

  const jobs = await Promise.all(jobPromises);

  const successCount = jobs.filter((j) => j.success).length;
  const failedCount = jobs.length - successCount;

  const result: ParallelStepResult = {
    jobs,
    totalJobs: jobs.length,
    successCount,
    failedCount,
    allSucceeded: failedCount === 0,
  };

  log.info('Parallel execution completed', {
    step: step.name,
    totalJobs: result.totalJobs,
    successCount: result.successCount,
    failedCount: result.failedCount,
  });

  // Emit parallel complete event
  options.emitter?.emit('parallel:complete', step, result);

  return result;
}

/**
 * Convert parallel step result to a single AgentResponse
 *
 * Aggregates all job results into a summary response that can be used
 * for workflow transitions.
 */
export function aggregateParallelResult(
  step: WorkflowStep,
  result: ParallelStepResult
): AgentResponse {
  const summaryLines: string[] = [
    `## Parallel Execution Summary`,
    '',
    `- **Total jobs**: ${result.totalJobs}`,
    `- **Successful**: ${result.successCount}`,
    `- **Failed**: ${result.failedCount}`,
    '',
  ];

  if (result.jobs.length > 0) {
    summaryLines.push('### Job Results', '');

    for (const job of result.jobs) {
      const statusIcon = job.success ? '✓' : '✗';
      summaryLines.push(`#### ${statusIcon} ${job.taskName}`);
      summaryLines.push('');
      summaryLines.push(`**Status**: ${job.response.status}`);
      if (job.response.error) {
        summaryLines.push(`**Error**: ${job.response.error}`);
      }
      // Include a truncated version of the response content
      const contentPreview = job.response.content.length > 500
        ? job.response.content.slice(0, 500) + '...'
        : job.response.content;
      summaryLines.push('');
      summaryLines.push(contentPreview);
      summaryLines.push('');
    }
  }

  // Determine overall status based on job results
  const status = result.allSucceeded ? 'done' : 'blocked';

  // Add status marker for workflow transition
  const statusMarker = result.allSucceeded
    ? `[${step.agentDisplayName.toUpperCase()}:DONE]`
    : `[${step.agentDisplayName.toUpperCase()}:BLOCKED]`;

  summaryLines.push('', statusMarker);

  return {
    agent: step.agent,
    status,
    content: summaryLines.join('\n'),
    timestamp: new Date(),
  };
}
