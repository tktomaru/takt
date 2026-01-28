/**
 * User input handling for workflow execution
 *
 * Manages readline interface, input queue, and interrupt handling.
 */

import * as readline from 'node:readline';
import { interruptAllQueries } from '../claude/query-manager.js';
import { writeAgentLog, createLogger } from '../utils/debug.js';
import { info, warn } from '../utils/ui.js';
import { selectOption, promptInput } from '../prompt/index.js';
import type { IterationLimitRequest, UserInputRequest } from '../workflow/types.js';
import type { WorkflowConfig } from '../models/types.js';

const log = createLogger('input-handler');

/** Input handler state */
export interface InputHandlerState {
  /** Queue of user inputs waiting to be processed */
  inputQueue: string[];
  /** Whether the input listener is active */
  isActive: boolean;
  /** Current agent name for logging */
  currentAgentName: string | null;
}

/** Input handler interface */
export interface InputHandler {
  /** Get the current state */
  getState(): InputHandlerState;
  /** Set the current agent name for logging */
  setCurrentAgent(name: string | null): void;
  /** Get and remove the next queued input */
  dequeueInput(): string | undefined;
  /** Check if there are queued inputs */
  hasQueuedInput(): boolean;
  /** Show the input prompt */
  showPrompt(): void;
  /** Cleanup and close the handler */
  close(): void;
}

/**
 * Create an input handler for workflow execution.
 * Sets up readline for background input monitoring and interrupt handling.
 */
export function createInputHandler(): InputHandler {
  const state: InputHandlerState = {
    inputQueue: [],
    isActive: true,
    currentAgentName: null,
  };

  // Setup readline for background input monitoring
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle user input - interrupt current agent and queue input
  rl.on('line', (input: string) => {
    if (!state.isActive) return;

    const trimmedInput = input.trim();
    if (trimmedInput) {
      state.inputQueue.push(trimmedInput);
      log.info('User input received, interrupting current agent', { input: trimmedInput });

      // Interrupt all running queries to inject user input
      interruptAllQueries();

      // Write to current agent's log
      if (state.currentAgentName) {
        writeAgentLog(state.currentAgentName, `\n[USER_INPUT] ${trimmedInput}\n`);
      }
    }
  });

  return {
    getState(): InputHandlerState {
      return { ...state };
    },

    setCurrentAgent(name: string | null): void {
      state.currentAgentName = name;
    },

    dequeueInput(): string | undefined {
      return state.inputQueue.shift();
    },

    hasQueuedInput(): boolean {
      return state.inputQueue.length > 0;
    },

    showPrompt(): void {
      process.stdout.write('> ');
    },

    close(): void {
      state.isActive = false;
      rl.close();
    },
  };
}

/**
 * Create a user input handler for BLOCKED status.
 * Returns user input or null to abort.
 */
export function createUserInputHandler(
  inputHandler: InputHandler
): (request: UserInputRequest) => Promise<string | null> {
  return async (request: UserInputRequest): Promise<string | null> => {
    // Check if we have queued input from interrupt
    if (inputHandler.hasQueuedInput()) {
      const queuedInput = inputHandler.dequeueInput()!;
      info(`Using queued input: ${queuedInput.slice(0, 50)}...`);
      return queuedInput;
    }

    console.log();
    warn(`Agent is blocked: ${request.step.name}`);
    if (request.prompt) {
      info(request.prompt);
    }

    const userInput = await promptInput('Your response (empty to abort)');
    return userInput || null;
  };
}

/**
 * Create an iteration limit handler.
 * Returns additional iterations or null to stop.
 */
export function createIterationLimitHandler(
  workflowConfig: WorkflowConfig
): (request: IterationLimitRequest) => Promise<number | null> {
  return async (request: IterationLimitRequest): Promise<number | null> => {
    console.log();
    warn(
      `最大イテレーションに到達しました (${request.currentIteration}/${request.maxIterations})`
    );
    info(`現在のステップ: ${request.currentStep}`);

    const action = await selectOption('続行しますか？', [
      {
        label: '続行する（追加イテレーション数を入力）',
        value: 'continue',
        description: '入力した回数だけ上限を増やします',
      },
      { label: '終了する', value: 'stop' },
    ]);

    if (action !== 'continue') {
      return null;
    }

    while (true) {
      const input = await promptInput('追加するイテレーション数を入力してください（1以上）');
      if (!input) {
        return null;
      }

      const additionalIterations = Number.parseInt(input, 10);
      if (Number.isInteger(additionalIterations) && additionalIterations > 0) {
        workflowConfig.maxIterations += additionalIterations;
        return additionalIterations;
      }

      warn('1以上の整数を入力してください。');
    }
  };
}
