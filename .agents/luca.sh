#!/bin/bash
set -e
echo "=== Agent: Luca ==="
cd "/Users/klauskollerkroeff/Documents/agent-office" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 /Users/klauskollerkroeff/.local/bin/claude -r agent-luca-1775418897000 --permission-mode acceptEdits
