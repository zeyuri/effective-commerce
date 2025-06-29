# commit-status

Show the current git status and what would be committed.

## Usage

`/commit-status` - Display git status and diff of staged changes

## Implementation

```bash
#!/bin/bash

echo "=== Git Status ==="
git status --short

echo -e "\n=== Staged Changes ==="
if git diff --cached --quiet; then
  echo "No staged changes"
else
  git diff --cached --stat
  echo -e "\n--- Detailed diff ---"
  git diff --cached
fi

echo -e "\n=== Unstaged Changes ==="
if git diff --quiet; then
  echo "No unstaged changes"
else
  git diff --stat
fi
```

## Description

This command shows:
1. Current git status in short format
2. Summary and detailed diff of staged changes
3. Summary of unstaged changes

Use this before running `/commit` to review what will be committed.