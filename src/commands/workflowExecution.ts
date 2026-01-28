/**
 * Workflow execution logic
 *
 * Executes workflows with minimal console output.
 * Agent output is written to log files only (use /open to monitor).
 * User input is always accepted and interrupts the current agent.
 */

import { WorkflowEngine } from '../workflow/engine.js';
import type { WorkflowConfig, Language } from '../models/types.js';
import type { StreamEvent } from '../claude/types.js';
import {
  loadAgentSessions,
  updateAgentSession,
  loadWorktreeSessions,
  updateWorktreeSession,
} from '../config/paths.js';
import {
  header,
  info,
  error,
  success,
  status,
} from '../utils/ui.js';
import {
  generateSessionId,
  createSessionLog,
  addToSessionLog,
  finalizeSessionLog,
  saveSessionLog,
  updateLatestPointer,
} from '../utils/session.js';
import {
  createLogger,
  initAgentLog,
  writeAgentLog,
  logAgentStepStart,
  logAgentStepComplete,
} from '../utils/debug.js';
import { notifySuccess, notifyError } from '../utils/notification.js';
import {
  createInputHandler,
  createUserInputHandler,
  createIterationLimitHandler,
} from './inputHandler.js';

const log = createLogger('workflow');

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(startTime: string, endTime: string): string {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const elapsedMs = end - start;
  const elapsedSec = elapsedMs / 1000;

  if (elapsedSec < 60) {
    return `${elapsedSec.toFixed(1)}s`;
  }

  const minutes = Math.floor(elapsedSec / 60);
  const seconds = Math.floor(elapsedSec % 60);
  return `${minutes}m ${seconds}s`;
}

/** Result of workflow execution */
export interface WorkflowExecutionResult {
  success: boolean;
  reason?: string;
}

/** Options for workflow execution */
export interface WorkflowExecutionOptions {
  /** Header prefix for display */
  headerPrefix?: string;
  /** Project root directory (where .takt/ lives). Defaults to cwd. */
  projectCwd?: string;
  /** Language for instruction metadata */
  language?: Language;
  /** Enable verbose console output (default: false, logs go to files only) */
  verbose?: boolean;
}

/**
 * Execute a workflow and handle all events
 */
export async function executeWorkflow(
  workflowConfig: WorkflowConfig,
  task: string,
  cwd: string,
  options: WorkflowExecutionOptions = {}
): Promise<WorkflowExecutionResult> {
  const {
    headerPrefix = 'Running Workflow:',
    verbose = false,
  } = options;

  // projectCwd is where .takt/ lives (project root, not worktree)
  const projectCwd = options.projectCwd ?? cwd;

  log.debug('Continuing session (use /clear to reset)');

  header(`${headerPrefix} ${workflowConfig.name}`);
  info('Type your input anytime to interrupt and provide feedback');
  console.log();

  const workflowSessionId = generateSessionId();
  const sessionLog = createSessionLog(task, projectCwd, workflowConfig.name);

  // Persist initial log + pointer at workflow start (enables crash recovery)
  saveSessionLog(sessionLog, workflowSessionId, projectCwd);
  updateLatestPointer(sessionLog, workflowSessionId, projectCwd, { copyToPrevious: true });

  // Setup input handler (pass cwd for slash commands like /open)
  const inputHandler = createInputHandler(cwd);

  // Create stream handler that writes to agent log file only (no console output)
  const streamHandler = (event: StreamEvent): void => {
    const state = inputHandler.getState();
    const agentName = state.currentAgentName;

    // Write to agent log file only
    if (agentName) {
      switch (event.type) {
        case 'text':
          writeAgentLog(agentName, event.data.text);
          break;
        case 'thinking':
          writeAgentLog(agentName, `[thinking] ${event.data.thinking}`);
          break;
        case 'tool_use':
          writeAgentLog(agentName, `\n[tool] ${event.data.tool}: ${JSON.stringify(event.data.input).slice(0, 200)}\n`);
          break;
        case 'tool_result':
          if (event.data.isError) {
            writeAgentLog(agentName, `[tool_error] ${event.data.content.slice(0, 500)}\n`);
          }
          break;
      }
    }

    // Verbose mode: also print to console (for debugging)
    if (verbose && event.type === 'text') {
      process.stdout.write(event.data.text);
    }
  };

  // Load saved agent sessions for continuity
  const isWorktree = cwd !== projectCwd;
  const savedSessions = isWorktree
    ? loadWorktreeSessions(projectCwd, cwd)
    : loadAgentSessions(projectCwd);

  // Session update handler
  const sessionUpdateHandler = isWorktree
    ? (agentName: string, agentSessionId: string): void => {
        updateWorktreeSession(projectCwd, cwd, agentName, agentSessionId);
      }
    : (agentName: string, agentSessionId: string): void => {
        updateAgentSession(projectCwd, agentName, agentSessionId);
      };

  const engine = new WorkflowEngine(workflowConfig, cwd, task, {
    onStream: streamHandler,
    initialSessions: savedSessions,
    onSessionUpdate: sessionUpdateHandler,
    onIterationLimit: createIterationLimitHandler(workflowConfig),
    onUserInput: createUserInputHandler(inputHandler),
    projectCwd,
    language: options.language,
  });

  let abortReason: string | undefined;

  engine.on('step:start', (step, iteration) => {
    log.debug('Step starting', { step: step.name, agent: step.agentDisplayName, iteration });

    // Minimal console output: just step info
    console.log(`[${iteration}/${workflowConfig.maxIterations}] ${step.name} (${step.agentDisplayName})`);

    // Initialize agent log and track current agent
    inputHandler.setCurrentAgent(step.agentDisplayName);
    if (iteration === 1) {
      initAgentLog(step.agentDisplayName);
    }
    logAgentStepStart(step.agentDisplayName, step.name, iteration);

    // Inject any queued user input
    while (inputHandler.hasQueuedInput()) {
      const queuedInput = inputHandler.dequeueInput()!;
      engine.addUserInput(queuedInput);
      info(`Injected user input: ${queuedInput.slice(0, 50)}...`);
    }
  });

  engine.on('step:complete', (step, response) => {
    log.debug('Step completed', {
      step: step.name,
      status: response.status,
      contentLength: response.content.length,
      sessionId: response.sessionId,
      error: response.error,
    });

    // Write step completion to agent log
    const state = inputHandler.getState();
    if (state.currentAgentName) {
      logAgentStepComplete(state.currentAgentName, response.status);
    }
    inputHandler.setCurrentAgent(null);

    // Minimal console output: just status
    status('Status', response.status);
    if (response.error) {
      error(`Error: ${response.error}`);
    }

    addToSessionLog(sessionLog, step.name, response);

    // Incremental save after each step
    saveSessionLog(sessionLog, workflowSessionId, projectCwd);
    updateLatestPointer(sessionLog, workflowSessionId, projectCwd);

    // Show prompt for next input
    inputHandler.showPrompt();
  });

  engine.on('workflow:complete', (state) => {
    log.info('Workflow completed successfully', { iterations: state.iteration });
    finalizeSessionLog(sessionLog, 'completed');
    const logPath = saveSessionLog(sessionLog, workflowSessionId, projectCwd);
    updateLatestPointer(sessionLog, workflowSessionId, projectCwd);

    const elapsed = sessionLog.endTime
      ? formatElapsedTime(sessionLog.startTime, sessionLog.endTime)
      : '';
    const elapsedDisplay = elapsed ? `, ${elapsed}` : '';

    console.log();
    success(`Workflow completed (${state.iteration} iterations${elapsedDisplay})`);
    info(`Session log: ${logPath}`);
    notifySuccess('TAKT', `ワークフロー完了 (${state.iteration} iterations)`);
  });

  engine.on('workflow:abort', (state, reason) => {
    log.error('Workflow aborted', { reason, iterations: state.iteration });
    abortReason = reason;
    finalizeSessionLog(sessionLog, 'aborted');
    const logPath = saveSessionLog(sessionLog, workflowSessionId, projectCwd);
    updateLatestPointer(sessionLog, workflowSessionId, projectCwd);

    const elapsed = sessionLog.endTime
      ? formatElapsedTime(sessionLog.startTime, sessionLog.endTime)
      : '';
    const elapsedDisplay = elapsed ? ` (${elapsed})` : '';

    console.log();
    error(`Workflow aborted after ${state.iteration} iterations${elapsedDisplay}: ${reason}`);
    info(`Session log: ${logPath}`);
    notifyError('TAKT', `中断: ${reason}`);
  });

  // Show initial prompt
  inputHandler.showPrompt();

  const finalState = await engine.run();

  // Cleanup input handler
  inputHandler.close();

  return {
    success: finalState.status === 'completed',
    reason: abortReason,
  };
}
