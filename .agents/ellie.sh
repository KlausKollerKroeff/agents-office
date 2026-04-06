#!/bin/bash
set -e
echo "=== Agent: Ellie ==="
cd "/Users/klauskollerkroeff/Documents/agent-office" && CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 /Users/klauskollerkroeff/.local/bin/claude -r agent-ellie-1775417299275 --permission-mode acceptEdits
