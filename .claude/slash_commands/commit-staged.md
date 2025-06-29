# commit-staged

Create a git commit for already staged changes following the project's commitizen conventions.

## Usage

`/commit-staged` - Create a commit using commitizen for already staged changes only

## Implementation

```bash
#!/bin/bash
set -e

# Check if there are staged changes
if ! git diff --cached --quiet; then
  # Run commitizen
  bun commit
else
  echo "No staged changes to commit. Use 'git add' to stage changes first."
  exit 1
fi
```

## Description

This command runs the project's commitizen setup for creating conventional commits, but only for changes that are already staged. This gives you more control over what gets committed.