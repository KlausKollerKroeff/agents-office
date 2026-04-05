const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const DESCRIPTIONS_FILE = path.join(__dirname, 'agents.json');
const PID_DIR = path.join(__dirname, '.pids');

// Known built-in agent types that have their own definitions
const KNOWN_AGENT_TYPES = ['trevor', 'luca', 'ellie', 'general-purpose', 'Explore', 'Plan', 'code-reviewer', 'silent-failure-hunter', 'manager'];

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

          const backgroundId = member.backgroundId || teamName;

          // Check if process is alive
          let sessionActive = false;
          const pid = loadPid(`${teamName}.pid`);
          if (pid && checkPidAlive(pid)) {
            sessionActive = true;
          }

          agents.push({
            id: agentId,
            name: member.name,
            teamName,
            type: member.agentType || 'general-purpose',
            description: description || '',
            sessionActive
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

// Check if Claude CLI works (detects context management incompatibility)
let claudeCompatible = null; // null = not yet checked, boolean = cached

function checkClaudeCompatibility() {
  if (claudeCompatible !== null) return claudeCompatible;
  const env = buildEnvScript();
  try {
    execSync(`"${env.CLAUDE_BIN}" --version`, { stdio: 'pipe' });
    // Try a quick API call to see if context management works
    execSync(
      `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS='${env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS}' ` +
      `ANTHROPIC_BASE_URL='${env.ANTHROPIC_BASE_URL}' ` +
      `ANTHROPIC_AUTH_TOKEN='${env.ANTHROPIC_AUTH_TOKEN}' ` +
      `ANTHROPIC_API_KEY='${env.ANTHROPIC_API_KEY}' ` +
      `ANTHROPIC_MODEL='${env.ANTHROPIC_MODEL}' ` +
      `CLAUDECODE='' "${env.CLAUDE_BIN}" --print -p "hi" 2>&1`,
      { stdio: 'pipe', timeout: 15000 }
    );
    claudeCompatible = true;
    return true;
  } catch (e) {
    claudeCompatible = false;
    return false;
  }
}

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
// Writes command to .sh + AppleScript to temp files to avoid all quoting issues
function openTerminalTab(title, command) {
  const tmpDir = path.join(__dirname, '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Write the actual command to a shell script
  const shellFile = path.join(tmpDir, `launch-${Date.now()}.sh`);
  fs.writeFileSync(shellFile, `#!/bin/bash\necho "=== Agent: ${title} ==="\n${command}\n`, 'utf8');
  fs.chmodSync(shellFile, '755');

  // Escape the path for AppleScript (no quotes needed if no spaces in tmp path)
  const safeShellPath = shellFile.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  const safeTitle = title.replace(/"/g, '\\"');

  const appleScript = `tell application "Terminal"
    set winId to do script "${safeShellPath}"
    set custom title of winId to "${safeTitle}"
    set title displays custom title of winId to true
    set miniaturized of winId to true
end tell
`;
  const scriptFile = path.join(tmpDir, `launch-${Date.now()}.scpt`);
  fs.writeFileSync(scriptFile, appleScript, 'utf8');

  try {
    execSync(`osascript "${scriptFile}"`, { stdio: 'pipe', timeout: 10000 });
    // Clean up after a delay (Terminal has already sourced the files)
    setTimeout(() => {
      try { fs.unlinkSync(shellFile); } catch {}
      try { fs.unlinkSync(scriptFile); } catch {}
    }, 10000);
    return true;
  } catch (e) {
    console.error(`Failed to open Terminal for ${title}: ${e.message}`);
    try { fs.unlinkSync(shellFile); } catch {}
    try { fs.unlinkSync(scriptFile); } catch {}
    return false;
  }
}

// API: Open a single agent's Terminal tab directly (no download)
app.post('/api/launch/:name', (req, res) => {
  try {
    const teamName = req.params.name;
    const teamConfigPath = path.join(TEAMS_DIR, teamName, 'config.json');

    if (!fs.existsSync(teamConfigPath)) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
    const member = config.members[0];
    const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');
    const isTrevor = member.name.toLowerCase() === 'trevor';
    let cmd = `cd "${__dirname}" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ${claudePath} -r ${teamName}`;
    if (isTrevor) cmd += ' --agent=trevor';
    cmd += ' --permission-mode acceptEdits';

    // Mark as launched
    member.backgroundId = `${member.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-launched-${Date.now()}`;
    fs.writeFileSync(teamConfigPath, JSON.stringify(config, null, 2));

    const opened = openTerminalTab(member.name, cmd);

    if (opened) {
      res.json({ success: true, message: `${member.name} opened in Terminal` });
    } else {
      // Fallback: return the command so the user can run it manually
      res.json({ success: true, message: `${member.name} — Terminal open failed, run manually:`, command: cmd });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Generate launch script that opens all agents in Terminal.app
app.get('/api/launch-script', (req, res) => {
  const agents = getRunningAgents();
  if (agents.length === 0) {
    return res.status(204).send('No agents to launch');
  }

  const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');

  let script = `#!/bin/bash\n# Agent Office — Launch All Agents\n`;
  script += `cd "${__dirname}"\n`;
  script += `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\n\n`;

  agents.forEach((agent) => {
    const isTrevor = agent.name.toLowerCase() === 'trevor';
    let cmd = `claude -r ${agent.teamName}`;
    if (isTrevor) cmd += ' --agent=trevor';
    cmd += ' --permission-mode acceptEdits';
    script += `echo "Launching ${agent.name}..." && ${cmd} &\nsleep 0.5\n`;
  });

  script += `\necho "All agents launched! Press any key to close this window..."\nread -n 1\n`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="launch-agents.command"');
  res.send(script);
});

// API: Launch ALL agents — each gets its own Terminal tab (no downloads)
app.post('/api/launch-all', (req, res) => {
  try {
    const agents = getRunningAgents();
    if (agents.length === 0) {
      return res.json({ success: false, message: 'No agents to launch' });
    }

    const claudePath = path.join(process.env.HOME, '.local', 'bin', 'claude');
    const projectDir = __dirname;

    // Mark all agents as being launched
    for (const agent of agents) {
      const teamConfigPath = path.join(TEAMS_DIR, agent.teamName, 'config.json');
      try {
        const config = JSON.parse(fs.readFileSync(teamConfigPath, 'utf8'));
        const member = config.members[0];
        member.backgroundId = `${agent.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-launched-${Date.now()}`;
        fs.writeFileSync(teamConfigPath, JSON.stringify(config, null, 2));
      } catch {}
    }

    // Open each agent in Terminal.app sequentially with a delay between each
    const results = [];

    function openNext(i) {
      if (i >= agents.length) return;
      const agent = agents[i];
      const isTrevor = agent.name.toLowerCase() === 'trevor';
      let cmd = `cd "${projectDir}" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ${claudePath} -r ${agent.teamName}`;
      if (isTrevor) cmd += ' --agent=trevor';
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
