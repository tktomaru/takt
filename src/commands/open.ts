/**
 * /open command implementation
 *
 * Opens a tmux session with split panes to monitor each agent's log file.
 * Agent logs are stored in ~/.takt/logs/agents/{agentName}.log
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getAgentLogsDir, getAgentLogFile } from '../utils/debug.js';
import { error, info, success, warn } from '../utils/ui.js';
import { createLogger } from '../utils/debug.js';

const log = createLogger('open');

/** Agent pane configuration */
interface AgentPane {
  name: string;
  displayName: string;
}

/**
 * Default agents to monitor in tmux panes.
 * These names must match the agentDisplayName from workflow steps.
 * Based on default.yaml workflow:
 * - planner: plan step
 * - coder: implement, improve, fix, ai_fix, security_fix steps
 * - architect: review step
 * - ai-reviewer: ai_review step
 * - security: security_review step
 * - supervisor: supervise step
 *
 * We show 4 panes for the most frequently used agents.
 * Less common agents (security, supervisor) share with related agents.
 */
const DEFAULT_AGENTS: AgentPane[] = [
  { name: 'planner', displayName: 'Planner' },
  { name: 'coder', displayName: 'Coder' },
  { name: 'architect', displayName: 'Architect' },
  { name: 'ai-reviewer', displayName: 'AI Reviewer' },
];

/** tmux session name */
const TMUX_SESSION_NAME = 'takt-monitor';

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

/** Open tmux session with split panes for agent monitoring */
export async function openTmuxMonitor(_cwd: string): Promise<void> {
  log.info('Starting tmux monitor');

  // Check tmux installation
  if (!isTmuxInstalled()) {
    error('tmux is not installed. Please install tmux first.');
    info('  Ubuntu/Debian: sudo apt install tmux');
    info('  macOS: brew install tmux');
    return;
  }

  // Ensure agent logs directory exists
  const agentLogsDir = getAgentLogsDir();
  if (!existsSync(agentLogsDir)) {
    mkdirSync(agentLogsDir, { recursive: true });
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

  // Build tmux commands
  const commands: string[] = [];

  // Create new session with first pane (Planner)
  const plannerCmd = buildTailCommand(DEFAULT_AGENTS[0]!);
  commands.push(`tmux new-session -d -s ${TMUX_SESSION_NAME} -x 200 -y 50 '${plannerCmd.replace(/'/g, "'\\''")}'`);

  // Split horizontally for Coder (right side)
  const coderCmd = buildTailCommand(DEFAULT_AGENTS[1]!);
  commands.push(`tmux split-window -h -t ${TMUX_SESSION_NAME} '${coderCmd.replace(/'/g, "'\\''")}'`);

  // Split first pane vertically for Architect (bottom left)
  const architectCmd = buildTailCommand(DEFAULT_AGENTS[2]!);
  commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.0 '${architectCmd.replace(/'/g, "'\\''")}'`);

  // Split second pane vertically for Reviewer (bottom right)
  const reviewerCmd = buildTailCommand(DEFAULT_AGENTS[3]!);
  commands.push(`tmux split-window -v -t ${TMUX_SESSION_NAME}:0.1 '${reviewerCmd.replace(/'/g, "'\\''")}'`);

  // Set pane titles (requires tmux >= 2.3)
  commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.0 -T '${DEFAULT_AGENTS[0]!.displayName}'`);
  commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.1 -T '${DEFAULT_AGENTS[1]!.displayName}'`);
  commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.2 -T '${DEFAULT_AGENTS[2]!.displayName}'`);
  commands.push(`tmux select-pane -t ${TMUX_SESSION_NAME}:0.3 -T '${DEFAULT_AGENTS[3]!.displayName}'`);

  // Enable pane border status
  commands.push(`tmux set-option -t ${TMUX_SESSION_NAME} pane-border-status top`);
  commands.push(`tmux set-option -t ${TMUX_SESSION_NAME} pane-border-format ' #{pane_title} '`);

  // Execute all tmux setup commands
  try {
    for (const cmd of commands) {
      log.debug('Executing tmux command', { cmd });
      execSync(cmd, { stdio: 'pipe' });
    }

    success(`tmux session '${TMUX_SESSION_NAME}' created.`);
    info('');
    info('Layout:');
    info('  +--------------+--------------+');
    info('  |   Planner    |    Coder     |');
    info('  +--------------+--------------+');
    info('  |  Architect   | AI Reviewer  |');
    info('  +--------------+--------------+');
    info('');
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
