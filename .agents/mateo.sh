#!/bin/bash
set -e
echo "=== Agent: Mateo ==="
cd "/Users/klauskollerkroeff/Documents/agent-office" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 /Users/klauskollerkroeff/.local/bin/claude -r agent-mateo-1775401381872 --permission-mode acceptEdits
