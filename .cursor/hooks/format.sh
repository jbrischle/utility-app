#!/bin/bash
# afterFileEdit hook: run Prettier on the file the agent just edited.
# Fails open (always exit 0) so formatting problems never block the agent.

input=$(cat)

file_path=$(printf '%s' "$input" | jq -r '.file_path // empty')

if [[ -z "$file_path" || ! -f "$file_path" ]]; then
  exit 0
fi

# Use the Prettier installed in the repo (project root is the hook's cwd).
prettier_bin="app/node_modules/.bin/prettier"

if [[ ! -x "$prettier_bin" ]]; then
  exit 0
fi

# --ignore-unknown: silently skip files Prettier can't format.
# Output is discarded so the hook stays quiet on success and failure.
"$prettier_bin" --write --ignore-unknown "$file_path" >/dev/null 2>&1

exit 0
