/**
 * /open command implementation
 *
 * Opens a tmux session with split panes to monitor each agent's log file.
 * Agent logs are stored in ~/.takt/logs/agents/{agentName}.log
 * Agents are determined from the selected workflow.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getAgentLogsDir, getAgentLogFile } from '../utils/debug.js';
import { error, info, success, warn } from '../utils/ui.js';
import { createLogger } from '../utils/debug.js';
import { loadWorkflow, listWorkflows } from '../config/workflowLoader.js';
import { getCurrentWorkflow } from '../config/paths.js';
import { selectOption } from '../prompt/index.js';
import type { WorkflowConfig } from '../models/types.js';

const log = createLogger('open');

/** Agent pane configuration */
interface AgentPane {
  name: string;
  displayName: string;
}

/** tmux session name */
const TMUX_SESSION_NAME = 'takt-monitor';

/** Maximum panes to show (tmux layout limit) */
const MAX_PANES = 6;

/** Check if tmux is installed */
export function isTmuxInstalled(): boolean {
  try {
    execSync('which tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Check if tmux session already exists */
export function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Ensure agent log file exists with placeholder content */
function ensureAgentLogFile(agentName: string): string {
  const logsDir = getAgentLogsDir();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const logFile = getAgentLogFile(agentName);
  if (!existsSync(logFile)) {
    writeFileSync(
      logFile,
      `=== ${agentName.toUpperCase()} Agent Log ===\nWaiting for activity...\n`,
      'utf-8'
    );
  }
  return logFile;
}

/** Build the tail command for an agent pane */
function buildTailCommand(agent: AgentPane): string {
  const logFile = ensureAgentLogFile(agent.name);
  return `echo '=== ${agent.displayName} ===' && tail -f '${logFile}' 2>/dev/null || (echo 'Waiting for logs...' && sleep infinity)`;
}

/**
 * Extract unique agents from workflow steps.
 * Returns agents in the order they appear in the workflow.
 */
function getAgentsFromWorkflow(workflow: WorkflowConfig): AgentPane[] {
  const seen = new Set<string>();
  const agents: AgentPane[] = [];

  for (const step of workflow.steps) {
    const name = step.agentDisplayName;
    if (!seen.has(name)) {
      seen.add(name);
      agents.push({
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
      });
    }
  }

  return agents;
}

/**
 * Select workflow interactively or use the provided/current workflow.
 */
async function selectWorkflow(cwd: string, workflowName?: string): Promise<WorkflowConfig | null> {
  // If workflow name is provided, load it directly
  if (workflowName) {
    const workflow = loadWorkflow(workflowName);
    if (!workflow) {
      error(`Workflow not found: ${workflowName}`);
      return null;
    }
    return workflow;
  }

  // Try to get current workflow
  const currentWorkflowName = getCurrentWorkflow(cwd);
  const workflows = listWorkflows();

  if (workflows.length === 0) {
    error('No workflows found in ~/.takt/workflows/');
    return null;
  }

  // Build options for selection
  const options = workflows.map((name) => ({
    label: name === currentWorkflowName ? `${name} (current)` : name,
    value: name,
  }));

  const selected = await selectOption('Select workflow to monitor:', options);
  if (!selected) {
    return null;
  }
  return loadWorkflow(selected);
}

/**
 * Build tmux commands for dynamic number of agents.
 * Layout: 2 columns, agents distributed across rows.
 */
function buildTmuxCommands(agents: AgentPane[]): string[] {
  const commands: string[] = [];
  const paneCount = Math.min(agents.length, MAX_PANES);

  if (paneCount === 0) {
    return commands;
  }

  // Create session with first pane
  const firstCmd = buildTailCommand(agents[0]!);
  commands.push(`tmux new-session -d -s ${TMUX_SESSION_NAME} -x 200 -y 50 '${firstCmd.replace(/'/g, "'\\''")}'`);

  if (paneCount === 1) {
    commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.0 -T '${agents[0]!.displayName}'`);
    return commands;
  }

  // Split horizontally for second pane (right side)
  const secondCmd = buildTailCommand(agents[1]!);
  commands.push(`tmux split-window -h -t ${TMUX_SESSION_NAME} '${secondCmd.replace(/'/g, "'\\''")}'`);

  // For 3+ agents, split vertically
  if (paneCount >= 3) {
    const thirdCmd = buildTailCommand(agents[2]!);
    commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.0 '${thirdCmd.replace(/'/g, "'\\''")}'`);
  }

  if (paneCount >= 4) {
    const fourthCmd = buildTailCommand(agents[3]!);
    commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.1 '${fourthCmd.replace(/'/g, "'\\''")}'`);
  }

  if (paneCount >= 5) {
    const fifthCmd = buildTailCommand(agents[4]!);
    commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.2 '${fifthCmd.replace(/'/g, "'\\''")}'`);
  }

  if (paneCount >= 6) {
    const sixthCmd = buildTailCommand(agents[5]!);
    commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.3 '${sixthCmd.replace(/'/g, "'\\''")}'`);
  }

  // Set pane titles
  for (let i = 0; i < paneCount; i++) {
    commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.${i} -T '${agents[i]!.displayName}'`);
  }

  // Enable pane border status
  commands.push(`tmux set-option -t ${TMUX_SESSION_NAME} pane-border-status top`);
  commands.push(`tmux set-option -t ${TMUX_SESSION_NAME} pane-border-format ' #{pane_title} '`);

  return commands;
}

/**
 * Print layout diagram based on agent count.
 */
function printLayoutDiagram(agents: AgentPane[]): void {
  const count = Math.min(agents.length, MAX_PANES);

  info('');
  info('Layout:');

  if (count === 1) {
    info(`  +----------------------------+`);
    info(`  |  ${agents[0]!.displayName.padEnd(24)}  |`);
    info(`  +----------------------------+`);
  } else if (count === 2) {
    info(`  +--------------+--------------+`);
    info(`  |  ${agents[0]!.displayName.padEnd(10)}  |  ${agents[1]!.displayName.padEnd(10)}  |`);
    info(`  +--------------+--------------+`);
  } else if (count <= 4) {
    info(`  +--------------+--------------+`);
    info(`  |  ${agents[0]!.displayName.padEnd(10)}  |  ${agents[1]!.displayName.padEnd(10)}  |`);
    info(`  +--------------+--------------+`);
    if (count >= 3) {
      info(`  |  ${agents[2]!.displayName.padEnd(10)}  |  ${(agents[3]?.displayName || '').padEnd(10)}  |`);
      info(`  +--------------+--------------+`);
    }
  } else {
    info(`  +--------------+--------------+`);
    info(`  |  ${agents[0]!.displayName.padEnd(10)}  |  ${agents[1]!.displayName.padEnd(10)}  |`);
    info(`  +--------------+--------------+`);
    info(`  |  ${agents[2]!.displayName.padEnd(10)}  |  ${agents[3]!.displayName.padEnd(10)}  |`);
    info(`  +--------------+--------------+`);
    if (count >= 5) {
      info(`  |  ${agents[4]!.displayName.padEnd(10)}  |  ${(agents[5]?.displayName || '').padEnd(10)}  |`);
      info(`  +--------------+--------------+`);
    }
  }
  info('');
}

/**
 * Open tmux session with split panes for agent monitoring.
 * @param cwd Current working directory
 * @param workflowName Optional workflow name (prompts for selection if not provided)
 */
export async function openTmuxMonitor(cwd: string, workflowName?: string): Promise<void> {
  log.info('Starting tmux monitor', { workflowName });

  // Check tmux installation
  if (!isTmuxInstalled()) {
    error('tmux is not installed. Please install tmux first.');
    info('  Ubuntu/Debian: sudo apt install tmux');
    info('  macOS: brew install tmux');
    return;
  }

  // Check if session already exists
  if (tmuxSessionExists(TMUX_SESSION_NAME)) {
    warn(`tmux session '${TMUX_SESSION_NAME}' already exists.`);
    info('Attaching to existing session...');

    try {
      spawnSync('tmux', ['attach-session', '-t', TMUX_SESSION_NAME], {
        stdio: 'inherit',
      });
    } catch (err) {
      error(`Failed to attach to session: ${err}`);
    }
    return;
  }

  // Select or load workflow
  const workflow = await selectWorkflow(cwd, workflowName);
  if (!workflow) {
    return;
  }

  // Get agents from workflow
  const agents = getAgentsFromWorkflow(workflow);
  if (agents.length === 0) {
    error('No agents found in workflow');
    return;
  }

  info(`Workflow: ${workflow.name}`);
  info(`Agents: ${agents.map((a) => a.name).join(', ')}`);

  if (agents.length > MAX_PANES) {
    warn(`Showing first ${MAX_PANES} agents (workflow has ${agents.length})`);
  }

  // Ensure agent logs directory exists
  const agentLogsDir = getAgentLogsDir();
  if (!existsSync(agentLogsDir)) {
    mkdirSync(agentLogsDir, { recursive: true });
  }

  // Build and execute tmux commands
  const commands = buildTmuxCommands(agents);

  try {
    for (const cmd of commands) {
      log.debug('Executing tmux command', { cmd });
      execSync(cmd, { stdio: 'pipe' });
    }

    success(`tmux session '${TMUX_SESSION_NAME}' created.`);
    printLayoutDiagram(agents);
    info(`Agent logs directory: ${agentLogsDir}`);
    info('');

    // Attach to the session (interactive)
    info('Attaching to session... (Ctrl+B, D to detach)');
    spawnSync('tmux', ['attach-session', '-t', TMUX_SESSION_NAME], {
      stdio: 'inherit',
    });

  } catch (err) {
    error(`Failed to create tmux session: ${err}`);
    log.error('tmux session creation failed', { error: err });

    // Clean up failed session
    try {
      execSync(`tmux kill-session -t ${TMUX_SESSION_NAME}`, { stdio: 'pipe' });
    } catch {
      // Session might not exist, ignore
    }
  }
}

/**
 * Create tmux session without attaching (for use during workflow execution).
 * Uses the current workflow to determine agents.
 * Returns true if session was created or already exists.
 */
export function createTmuxSession(cwd: string): boolean {
  log.info('Creating tmux session (no attach)');

  if (!isTmuxInstalled()) {
    return false;
  }

  // If session already exists, return success
  if (tmuxSessionExists(TMUX_SESSION_NAME)) {
    return true;
  }

  // Try to get current workflow
  const currentWorkflowName = getCurrentWorkflow(cwd);
  const workflow = loadWorkflow(currentWorkflowName);

  if (!workflow) {
    log.warn('No workflow found, cannot create session');
    return false;
  }

  const agents = getAgentsFromWorkflow(workflow);
  if (agents.length === 0) {
    log.warn('No agents found in workflow');
    return false;
  }

  // Ensure agent logs directory exists
  const agentLogsDir = getAgentLogsDir();
  if (!existsSync(agentLogsDir)) {
    mkdirSync(agentLogsDir, { recursive: true });
  }

  // Build and execute tmux commands
  const commands = buildTmuxCommands(agents);

  try {
    for (const cmd of commands) {
      log.debug('Executing tmux command', { cmd });
      execSync(cmd, { stdio: 'pipe' });
    }
    return true;
  } catch (err) {
    log.error('Failed to create tmux session', { error: err });
    // Clean up failed session
    try {
      execSync(`tmux kill-session -t ${TMUX_SESSION_NAME}`, { stdio: 'pipe' });
    } catch {
      // Session might not exist, ignore
    }
    return false;
  }
}

/** Kill the tmux monitor session */
export function killTmuxMonitor(): boolean {
  if (!tmuxSessionExists(TMUX_SESSION_NAME)) {
    warn(`tmux session '${TMUX_SESSION_NAME}' does not exist.`);
    return false;
  }

  try {
    execSync(`tmux kill-session -t ${TMUX_SESSION_NAME}`, { stdio: 'pipe' });
    success(`tmux session '${TMUX_SESSION_NAME}' killed.`);
    return true;
  } catch (err) {
    error(`Failed to kill session: ${err}`);
    return false;
  }
}
