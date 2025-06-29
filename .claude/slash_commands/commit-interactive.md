# commit-interactive

Create a git commit using the interactive commitizen prompt.

## Usage

`/commit-interactive` - Stage all changes and run interactive commitizen

## Implementation

```bash
#!/bin/bash
set -e

# Stage all changes
git add -A

# Run commitizen interactively
echo "Starting interactive commit process..."
echo "Please follow the prompts in your terminal."
bun commit
```

## Description

This command stages all changes and runs the interactive commitizen prompt. Use this when you want to use the full interactive commit experience with type selection and prompts.