# commit

Create a git commit following the project's commitizen conventions.

## Usage

`/commit` - Stage all changes and create a commit using commitizen

## Implementation

```bash
#!/bin/bash
set -e

# Stage all changes
git add -A

# Run commitizen
bun commit
```

## Description

This command stages all changes and runs the project's commitizen setup for creating conventional commits. It uses the `bun commit` script defined in package.json which runs `git cz` with the configured commitizen settings.