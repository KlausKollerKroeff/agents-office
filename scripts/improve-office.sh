#!/bin/bash
# Office Improver - Autonomous review and improvement cycle
# Runs via launchd every 30 minutes

PROJECT_DIR="/Users/klauskollerkroeff/Documents/agent-office"
LOG_DIR="$PROJECT_DIR/.pids"
LOG_FILE="$LOG_DIR/improve-office.log"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# Ensure log dir exists
mkdir -p "$LOG_DIR"

echo "========== [$TIMESTAMP] Office improvement cycle ==========" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "[$TIMESTAMP] Failed to cd to project dir" >> "$LOG_FILE"; exit 1; }

# Step 1: Check for syntax errors — don't break a working dashboard
node -c public/app.js 2>> "$LOG_FILE"
if [ $? -ne 0 ]; then
  echo "[$TIMESTAMP] SYNTAX ERROR in app.js - aborting improvement cycle" >> "$LOG_FILE"
  exit 1
fi

node -c server.js 2>> "$LOG_FILE"
if [ $? -ne 0 ]; then
  echo "[$TIMESTAMP] SYNTAX ERROR in server.js - aborting improvement cycle" >> "$LOG_FILE"
  exit 1
fi

# Step 2: Check dashboard is alive
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100 --connect-timeout 5 2>/dev/null)
if [ "$HTTP_CODE" != "200" ]; then
  echo "[$TIMESTAMP] Dashboard not responding (got $HTTP_CODE) - aborting" >> "$LOG_FILE"
  exit 1
fi

echo "[$TIMESTAMP] Dashboard healthy, starting improvement cycle..." >> "$LOG_FILE"

# Step 3: Run Claude Code with the review prompt (headless)
claude --dangerously-skip-permissions --dangerously-skip-apply-edits-prompts \
  -w "$PROJECT_DIR" \
  --print \
  -p "
You are the Office Improver agent. Your job is to review the Agent Office dashboard and make ONE meaningful improvement per cycle.

REVIEW PROCESS:
1. Read public/app.js, public/office.css, public/index.html, and server.js
2. Look for: visual inconsistencies, missing features, performance issues, bugs, UX problems
3. Pick the SINGLE most impactful fix
4. Apply it to the codebase
5. Validate with: node -c public/app.js
6. Log what you changed at the bottom of $LOG_FILE with the timestamp

PRIORITY ORDER (try these in order, stop at first improvement found):
1. Fix broken/invisible elements (sprites not rendering, broken layouts)
2. Fix console errors or JS crashes
3. Improve render loop performance
4. Visual polish (better colors, labels, animations, tooltips)
5. UX improvements (hover states, transitions, responsive layout)

IMPORTANT:
- Only make ONE change per cycle
- NEVER break existing functionality
- If nothing needs fixing, write 'No improvements needed this cycle' to the log
- Keep changes small and testable
" >> "$LOG_FILE" 2>&1

echo "[$TIMESTAMP] Improvement cycle complete." >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
