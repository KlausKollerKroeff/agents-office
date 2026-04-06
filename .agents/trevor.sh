#!/bin/bash
set -e
echo "=== Agent: Trevor ==="
cd "/Users/klauskollerkroeff/Documents/agent-office" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 /Users/klauskollerkroeff/.local/bin/claude -r agent-trevor-1775407825500 --agent=trevor --permission-mode acceptEdits
