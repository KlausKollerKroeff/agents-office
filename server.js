const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync, spawn } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const DESCRIPTIONS_FILE = path.join(__dirname, 'agents.json');
const PID_DIR = path.join(__dirname, '.pids');
const UNIFIED_TEAM = 'agent-office';

// Known built-in agent types that have their own definitions
const KNOWN_AGENT_TYPES = ['trevor', 'luca', 'ellie', 'mateo', 'general-purpose', 'Explore', 'Plan', 'code-reviewer', 'silent-failure-hunter', 'manager'];

if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true });

// Load custom agent descriptions
function loadDescriptions() {
  try {
    return JSON.parse(fs.readFileSync(DESCRIPTIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveDescriptions(descs) {
  fs.writeFileSync(DESCRIPTIONS_FILE, JSON.stringify(descs, null, 2));
}

// Lookup the canonical key in a case-insensitive way
function lookupDescriptionKey(descriptions, target) {
  if (descriptions[target]) return target;
  const lower = target.toLowerCase();
  for (const key of Object.keys(descriptions)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

function checkPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function savePid(filename, pid) {
  fs.writeFileSync(path.join(PID_DIR, filename), String(pid));
}

function loadPid(filename) {
  try {
    return parseInt(fs.readFileSync(path.join(PID_DIR, filename), 'utf8'), 10);
  } catch {
    return 0;
  }
}

// Check if Terminal has an open tab running "claude -r <teamName>"
function checkClaudeTerminalProcess(teamName) {
  try {
    // Escape dangerous shell characters from teamName
    const escapedName = teamName.replace(/['"\\$`;]/g, '');
    const output = execSync(
      `ps aux 2>/dev/null | grep -F "claude -r ${escapedName}" | grep -v grep`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 3000 }
    );
    return output && output.trim().length > 0;
  } catch (e) {
    return false;
  }
}

// Get all running agents from teams config files
function getRunningAgents() {
  const agents = [];
  const descriptions = loadDescriptions();

  if (!fs.existsSync(TEAMS_DIR)) return agents;

  const teamDirs = fs.readdirSync(TEAMS_DIR);

  for (const teamName of teamDirs) {
    const teamConfigPath = path.join(TEAMS_DIR, teamName, 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));

      if (config.members && config.members.length > 0) {
        // Detect if claude is running in Terminal for this team
        const terminalOpen = checkClaudeTerminalProcess(teamName);

        for (const member of config.members) {
          const agentId = member.agentId;

          // Lookup description case-insensitively
          let description = '';
          const descKey = lookupDescriptionKey(descriptions, member.name);
          if (descKey) {
            description = descriptions[descKey];
          } else if (KNOWN_AGENT_TYPES.includes(member.agentType)) {
            const typeDescKey = lookupDescriptionKey(descriptions, member.agentType);
            if (typeDescKey) description = descriptions[typeDescKey];
          }
          // Fall back to the team description
          if (!description && config.description) {
            description = config.description;
          }

          // Check PID from wake-spawned background process
          const pid = loadPid(`${teamName}.pid`);
          const processAlive = pid && checkPidAlive(pid);

          // Per-member terminal check: "claude -r <teamName> --agent=<agentType>"
          let memberTerminalOpen = false;
          try {
            const escapedTeam = teamName.replace(/['"\\$`;]/g, '');
            const escapedAgent = member.agentType.replace(/['"\\$`;]/g, '');
            const output = execSync(
              `ps aux 2>/dev/null | grep -F "claude -r ${escapedTeam}" | grep -F -- "--agent=${escapedAgent}" | grep -v grep`,
              { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 3000 }
            );
            memberTerminalOpen = output && output.trim().length > 0;
          } catch { /* no match */ }

          // Determine status: terminal open vs background process vs disconnected
          let sessionActive = processAlive || terminalOpen || memberTerminalOpen;
          let statusDetail = 'Not connected';
          let isLaunched = terminalOpen || memberTerminalOpen;
          if (isLaunched && processAlive) {
            statusDetail = 'Answering — active session';
          } else if (isLaunched) {
            statusDetail = 'Idle — Terminal open, awaiting input';
          } else if (processAlive) {
            statusDetail = 'Answering — background process';
          } else if (config.leaderAgentType) {
            statusDetail = 'Idle — Awaiting launch';
          }

          const mainAgentNames = ['trevor', 'luca', 'ellie', 'mateo'];
          agents.push({
            id: agentId,
            name: member.name,
            teamName,
            type: member.agentType || 'general-purpose',
            category: mainAgentNames.includes(member.name.toLowerCase()) ? 'main-agent' : 'sub-agent',
            description: description || '',
            sessionActive,
            statusDetail,
            processAlive,
            isLaunched
          });
        }
      }
    } catch {
      // Skip invalid config files
    }
  }

  return agents;
}

// Get all team info
function getTeams() {
  const teams = [];
  if (!fs.existsSync(TEAMS_DIR)) return teams;

  const teamDirs = fs.readdirSync(TEAMS_DIR);

  for (const teamName of teamDirs) {
    const teamConfigPath = path.join(TEAMS_DIR, teamName, 'config.json');
    try {
      const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
      const taskListPath = path.join(CLAUDE_DIR, 'tasks', teamName);

      let taskStatus = { total: 0, completed: 0, inProgress: 0, pending: 0 };
      if (fs.existsSync(taskListPath)) {
        const taskFiles = fs.readdirSync(taskListPath).filter(f => f.endsWith('.json'));
        for (const taskFile of taskFiles) {
          try {
            const task = JSON.parse(fs.readFileSync(path.join(taskListPath, taskFile), 'utf8'));
            taskStatus.total++;
            if (task.status === 'completed') taskStatus.completed++;
            else if (task.status === 'in_progress') taskStatus.inProgress++;
            else if (task.status === 'pending') taskStatus.pending++;
          } catch {}
        }
      }

      teams.push({
        name: teamName,
        description: config.description || '',
        memberCount: config.members?.length || 0,
        taskStatus
      });
    } catch {}
  }

  return teams;
}

// Build environment from user settings
function buildEnvScript() {
  let settingsEnv = {};
  try {
    const settingsPath = path.join(process.env.HOME, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settingsEnv = settings.env || {};
  } catch (e) {
    console.error('Could not read settings.json:', e.message);
  }

  return {
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: settingsEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS || '1',
    ANTHROPIC_BASE_URL: settingsEnv.ANTHROPIC_BASE_URL || '',
    ANTHROPIC_AUTH_TOKEN: settingsEnv.ANTHROPIC_AUTH_TOKEN || '',
    ANTHROPIC_API_KEY: settingsEnv.ANTHROPIC_API_KEY || '',
    ANTHROPIC_MODEL: settingsEnv.ANTHROPIC_MODEL || '',
    CLAUDE_BIN: settingsEnv.CLAUDE_BIN || path.join(process.env.HOME, '.local', 'bin', 'claude')
  };
}

function checkClaudeCompatibility(callback) {
  if (claudeCompatible !== null) {
    if (callback) callback(claudeCompatible);
    return claudeCompatible;
  }

  const env = buildEnvScript();

  // Start async check — don't block the event loop
  setTimeout(() => {
    try {
      execSync(`"${env.CLAUDE_BIN}" --version`, { stdio: 'pipe', timeout: 5000 });
      execSync(
        `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS='${env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS}' ` +
        `ANTHROPIC_BASE_URL='${env.ANTHROPIC_BASE_URL}' ` +
        `ANTHROPIC_AUTH_TOKEN='${env.ANTHROPIC_AUTH_TOKEN}' ` +
        `ANTHROPIC_API_KEY='${env.ANTHROPIC_API_KEY}' ` +
        `ANTHROPIC_MODEL='${env.ANTHROPIC_MODEL}' ` +
        `CLAUDECODE='' "${env.CLAUDE_BIN}" --print -p "hi" 2>&1`,
        { stdio: 'pipe', timeout: 10000 }
      );
      claudeCompatible = true;
      console.log(`Claude CLI compatible with API: true`);
    } catch (e) {
      claudeCompatible = false;
      console.log(`Claude CLI compatible with API: false`);
      console.log('  → Agents register as dashboard entries. Resume manually with: claude -r agent-<name>');
    }
    if (callback) callback(claudeCompatible);
  }, 0);

  // Return optimistic default so callers can proceed
  return true;
}

// Start server immediately, run compatibility check asynchronously
const PORT = 3100;
app.listen(PORT, () => {
  console.log(`Agent Office Dashboard running on http://localhost:${PORT}`);
  console.log(`Teams directory: ${TEAMS_DIR}`);
  // Deferred: checkClaudeCompatibility runs async, does not block startup
  checkClaudeCompatibility((result) => {
    if (!result) {
      console.log('Note: Using OpenRouter mode — agents register as dashboard entries.');
    }
  });
});

// Parse CLI args string into array (handles --flag and "quoted strings")
function parseCliArgs(input) {
  const args = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && !inQuote) {
      inQuote = true;
    } else if (c === '"' && inQuote) {
      inQuote = false;
      args.push(current);
      current = '';
    } else if (c === ' ' && !inQuote) {
      if (current) args.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current) args.push(current);
  return args;
}

// Spawn a detached background claude process
function spawnBackgroundProcess(name, cmd) {
  const env = buildEnvScript();
  const logFile = path.join(__dirname, `logs/${name}-${Date.now()}.log`);
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const parts = parseCliArgs(cmd);

  // Build a clean environment — omit CLAUDECODE to prevent nested-session rejection
  const cleanEnv = {
    ...process.env,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL
  };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_SSE_PORT;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

  try {
    const child = spawn(env.CLAUDE_BIN, parts, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv
    });

    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.unref();
    return { pid: child.pid, logFile };
  } catch (e) {
    console.error('Spawn failed:', e.message);
    return { pid: null, logFile, error: e.message };
  }
}

// API: Get all running agents
app.get('/api/agents', (req, res) => {
  try {
    const agents = getRunningAgents();
    res.json({ success: true, agents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Wake up a team by re-spawning the agent in background
app.post('/api/wake/:name', (req, res) => {
  try {
    const teamName = req.params.name;
    const teamConfigPath = path.join(TEAMS_DIR, teamName, 'config.json');

    if (!fs.existsSync(teamConfigPath)) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
    if (!config.members || config.members.length === 0) {
      return res.status(400).json({ success: false, error: 'Team has no members' });
    }

    // Check if Claude CLI is compatible with the current API provider
    const canSpawn = checkClaudeCompatibility();

    let results = [];

    for (const member of config.members) {
      const { name, agentType } = member;

      if (!canSpawn) {
        // Mark as active without spawning — user needs to resume manually
        member.backgroundId = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-manual`;
        results.push({
          name: member.name,
          logFile: null,
          status: 'registered',
          note: 'OpenRouter requires manual resume. Run: claude -r ' + teamName
        });
        continue;
      }

      let cmd;
      if (name.toLowerCase() === 'trevor' || agentType === 'manager' || agentType === 'trevor') {
        cmd = '--agent=trevor -p "Resume your previous work as manager agent."';
      } else {
        cmd = `-p "Wake up agent ${name}, continue previous work."`;
      }

      const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const backgroundId = `${safeName}-${Date.now()}`;
      const { pid, logFile } = spawnBackgroundProcess(backgroundId, cmd);

      if (pid) savePid(`${teamName}.pid`, pid);
      console.log(`Woke up ${name} (PID: ${pid})`);

      member.backgroundId = backgroundId;
      results.push({ name: member.name, logFile, status: 'waking_up' });
    }

    fs.writeFileSync(teamConfigPath, JSON.stringify(config, null, 2));

    res.json({ success: true, message: `Woke up team "${teamName}"`, agents: results, canSpawn });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get all teams with session info
app.get('/api/teams', (req, res) => {
  try {
    const teams = getTeams();
    res.json({ success: true, teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Save/update agent description
app.put('/api/agents/:id/description', (req, res) => {
  try {
    const descriptions = loadDescriptions();
    const id = req.params.id;
    descriptions[id] = req.body.description || '';
    saveDescriptions(descriptions);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Spawn agent
// Since OpenRouter doesn't support Claude CLI context management,
// this creates a registered agent entry that users can manage from the dashboard.
// Status shows as "registered" — users can resume the session manually.
app.post('/api/spawn', (req, res) => {
  try {
    const { name, role, prompt, description } = req.body;
    const fullPrompt = prompt || `${name} is a ${role} agent.`;

    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const teamName = `agent-${safeName}-${Date.now()}`;
    const backgroundId = `spawn-${safeName}-${Date.now()}`;

    const canSpawn = checkClaudeCompatibility();
    let logFile = null;
    let pid = null;

    if (canSpawn) {
      // Build the claude command
      let cmd;
      if (name.toLowerCase() === 'trevor' || role === 'manager' || role === 'trevor') {
        cmd = `--agent=trevor "${fullPrompt.replace(/"/g, '\\"')}"`;
      } else {
        cmd = `"${fullPrompt.replace(/"/g, '\\"')}"`;
      }

      const result = spawnBackgroundProcess(backgroundId, cmd);
      pid = result.pid;
      logFile = result.logFile;
    }

    if (pid) savePid(`${teamName}.pid`, pid);

    // Save description
    if (description) {
      const descriptions = loadDescriptions();
      descriptions[name] = description;
      saveDescriptions(descriptions);
    }

    // Create team entry so the dashboard can discover this agent
    const teamDir = path.join(TEAMS_DIR, teamName);
    const taskListDir = path.join(CLAUDE_DIR, 'tasks', teamName);

    fs.mkdirSync(teamDir, { recursive: true });
    fs.mkdirSync(taskListDir, { recursive: true });

    const teamConfig = {
      description: description || `${name} — ${role} agent`,
      leaderSessionId: null,
      createdAt: Date.now(),
      backgroundId,
      members: [{
        agentId: `agent-${safeName}`,
        name,
        agentType: role || 'general-purpose',
        backgroundId
      }]
    };
    fs.writeFileSync(
      path.join(teamDir, 'config.json'),
      JSON.stringify(teamConfig, null, 2)
    );

    res.json({
      success: true,
      message: canSpawn
        ? `Agent "${name}" spawned in background`
        : `Agent "${name}" registered (OpenRouter — resume manually)`,
      name,
      teamName,
      logFile,
      canSpawn,
      resumeCommand: canSpawn ? null : `claude -r ${teamName}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Shutdown and clean up a team
app.delete('/api/teams/:name', (req, res) => {
  try {
    const teamName = req.params.name;
    const teamPath = path.join(TEAMS_DIR, teamName);
    const taskPath = path.join(CLAUDE_DIR, 'tasks', teamName);
    const pidFile = path.join(PID_DIR, `${teamName}.pid`);

    if (fs.existsSync(pidFile)) {
      const pid = loadPid(`${teamName}.pid`);
      if (pid && checkPidAlive(pid)) {
        process.kill(pid, 'SIGTERM');
        console.log(`Killed PID ${pid}`);
      }
      fs.unlinkSync(pidFile);
    }

    if (fs.existsSync(teamPath)) {
      try {
        fs.rmSync(teamPath, { recursive: true, force: true });
      } catch (e) {
        const configFile = path.join(teamPath, 'config.json');
        if (fs.existsSync(configFile)) fs.unlinkSync(configFile);
      }
    }
    if (fs.existsSync(taskPath)) {
      fs.rmSync(taskPath, { recursive: true, force: true });
    }

    res.json({ success: true, message: `Team "${teamName}" removed` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open a new Terminal.app tab and run a command via osascript
// Writes a temp AppleScript file to avoid ALL shell quoting/injection issues
function openTerminalTab(title, command) {
  const projectDir = __dirname;
  const cmdWithCd = `cd '${projectDir.replace(/'/g, "'\\''")}' && ${command}`;

  // Escape for AppleScript string literals (only backslash and double-quote matter inside "...")
  const appleScriptEscape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appleScript = [
    `tell application "Terminal"`,
    `    activate`,
    `    set newWin to do script "${appleScriptEscape(cmdWithCd)}"`,
    `    delay 0.3`,
    `    set win to first window whose tab 1 contains newWin`,
    `    set custom title of win to "${appleScriptEscape(title)}"`,
    `    set title displays custom title of win to true`,
    `end tell`
  ].join('\n');

  // Write to a temp .scpt file — avoids ALL shell quoting problems
  const tmpScpt = path.join(os.tmpdir(), `agent-office-${Date.now()}.scpt`);
  try {
    fs.writeFileSync(tmpScpt, appleScript, 'utf8');
    execSync(`osascript '${tmpScpt}'`, { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch (e) {
    console.error(`Failed to open Terminal for ${title}: ${e.message}`);
    return false;
  } finally {
    try { fs.unlinkSync(tmpScpt); } catch {}
  }
}

// API: Open a single agent's Terminal tab directly (no download)
app.post('/api/launch/:name', (req, res) => {
  try {
    const teamName = req.params.name;
    const agentIdentifier = req.query.agent; // optional: specific member name

    const teamConfigPath = path.join(TEAMS_DIR, teamName, 'config.json');

    if (!fs.existsSync(teamConfigPath)) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
    const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');
    const customAgents = ['trevor', 'luca', 'ellie', 'mateo'];

    // If agent identifier provided, launch only that member
    let membersToLaunch;
    if (agentIdentifier) {
      const member = config.members.find(
        m => m.name.toLowerCase() === agentIdentifier.toLowerCase() || m.agentType.toLowerCase() === agentIdentifier.toLowerCase()
      );
      if (!member) {
        return res.status(404).json({ success: false, error: `Agent "${agentIdentifier}" not found in team "${teamName}"` });
      }
      membersToLaunch = [member];
    } else {
      // Legacy: single-member team, launch the only member
      membersToLaunch = config.members.length === 1 ? [config.members[0]] : [];
    }

    if (membersToLaunch.length === 0) {
      return res.status(400).json({ success: false, error: 'No specific agent to launch. Use /api/launch-all instead.' });
    }

    const member = membersToLaunch[0];
    const agentName = member.name.toLowerCase();
    let cmd = `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ${claudePath} -r ${teamName}`;
    if (customAgents.includes(member.agentType)) cmd += ` --agent=${member.agentType}`;
    cmd += ' --permission-mode acceptEdits';

    // Mark as launched so status check can see this terminal tab was opened
    member.backgroundId = `${member.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-launched-${Date.now()}`;
    fs.writeFileSync(teamConfigPath, JSON.stringify(config, null, 2));

    const opened = openTerminalTab(member.name, cmd);

    if (opened) {
      res.json({ success: true, message: `${member.name} opened in Terminal` });
    } else {
      res.json({ success: true, message: `${member.name} — Terminal open failed, run manually:`, command: cmd });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// API: Launch ALL agents — each gets its own Terminal tab (no downloads)
app.post('/api/launch-all', (req, res) => {
  try {
    const agents = getRunningAgents();
    if (agents.length === 0) {
      return res.json({ success: false, message: 'No agents to launch' });
    }

    const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');
    const customAgents = ['trevor', 'luca', 'ellie', 'mateo'];

    // Mark all agents as being launched on their team configs
    const teamNames = new Set(agents.map(a => a.teamName));
    for (const t of teamNames) {
      const teamConfigPath = path.join(TEAMS_DIR, t, 'config.json');
      try {
        const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
        for (const member of config.members) {
          member.backgroundId = `${member.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-launched-${Date.now()}`;
        }
        fs.writeFileSync(teamConfigPath, JSON.stringify(config, null, 2));
      } catch {}
    }

    // Open each agent in Terminal.app sequentially with a delay between each
    const results = [];

    function openNext(i) {
      if (i >= agents.length) return;
      const agent = agents[i];
      let cmd = `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ${claudePath} -r ${agent.teamName}`;
      if (customAgents.includes(agent.type)) cmd += ` --agent=${agent.type}`;
      cmd += ' --permission-mode acceptEdits';

      openTerminalTab(agent.name, cmd);
      results.push(agent.name);
      setTimeout(() => openNext(i + 1), 1000);
    }
    openNext(0);

    res.json({
      success: true,
      message: `Opened ${results.length} agent(s) in Terminal`,
      count: results.length,
      opened: results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get current settings
app.get('/api/settings', (req, res) => {
  try {
    const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');
    res.json({ success: true, claudeBin: claudePath, teamsDir: TEAMS_DIR, canSpawn: checkClaudeCompatibility() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = 3100;
app.listen(PORT, () => {
  console.log(`Agent Office Dashboard running on http://localhost:${PORT}`);
  console.log(`Teams directory: ${TEAMS_DIR}`);
  const canSpawn = checkClaudeCompatibility();
  console.log(`Claude CLI compatible with API: ${canSpawn}`);
  if (!canSpawn) {
    console.log('  → Agents register as dashboard entries. Resume manually with: claude -r agent-<name>');
  }
});

module.exports = app;