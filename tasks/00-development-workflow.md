# Task 00: Development Workflow Setup

## Overview
Establish a robust development workflow with GitHub branch protection, automated testing, and PR policies to ensure code quality and prevent regressions.

## GitHub Repository Setup

### 1. Branch Protection Rules

Apply these rules to the `main` branch:

```yaml
# Settings → Branches → Add rule
Pattern: main
Protection rules:
  ✓ Require a pull request before merging
    ✓ Require approvals: 1
    ✓ Dismiss stale pull request approvals when new commits are pushed
    ✓ Require review from CODEOWNERS
  ✓ Require status checks to pass before merging
    ✓ Require branches to be up to date before merging
    Required status checks:
      - build
      - test
      - typecheck
      - lint
  ✓ Require conversation resolution before merging
  ✓ Require linear history
  ✓ Include administrators
  ✓ Restrict who can push to matching branches
    - Only allow specific users/teams
```

### 2. GitHub Actions Workflows

#### File: `.github/workflows/ci.yml`
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}

  typecheck:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun typecheck
      
  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun format-and-lint
      
  test:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: coverage/
          
  build:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun build
      
  security:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun audit
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
```

#### File: `.github/workflows/pr-checks.yml`
```yaml
name: PR Checks

on:
  pull_request:
    types: [opened, edited, synchronize]

jobs:
  pr-title:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        with:
          types: |
            feat
            fix
            docs
            style
            refactor
            perf
            test
            build
            ci
            chore
            revert
          requireScope: true
          subjectPattern: ^(?![A-Z]).+$
          subjectPatternError: |
            The subject "{subject}" found in the pull request title "{title}"
            didn't match the configured pattern. Please ensure that the subject
            doesn't start with an uppercase character.
            
  pr-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        with:
          script: |
            const pr = context.payload.pull_request;
            const additions = pr.additions;
            const deletions = pr.deletions;
            const total = additions + deletions;
            
            let label = 'size/XS';
            if (total > 1000) label = 'size/XXL';
            else if (total > 500) label = 'size/XL';
            else if (total > 250) label = 'size/L';
            else if (total > 100) label = 'size/M';
            else if (total > 50) label = 'size/S';
            
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: pr.number,
              labels: [label]
            });
            
            if (total > 500) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: pr.number,
                body: `⚠️ This PR has ${total} lines of changes. Consider breaking it into smaller PRs for easier review.`
              });
            }
```

### 3. Pull Request Template

#### File: `.github/pull_request_template.md`
```markdown
## Description
Brief description of what this PR does.

## Related Task
- Task: #XX-task-name
- Closes #issue-number (if applicable)

## Type of Change
- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🎨 Style update (formatting, renaming)
- [ ] ♻️ Code refactor (no functional changes)
- [ ] ⚡ Performance improvements
- [ ] ✅ Test updates
- [ ] 🤖 Build/CI changes

## Implementation Details
Describe your implementation approach and any important decisions.

## Testing
- [ ] Unit tests pass locally
- [ ] Integration tests pass locally
- [ ] Manual testing completed
- [ ] Test coverage maintained or improved

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Screenshots (if applicable)
Add screenshots to help explain your changes.

## Performance Impact
Describe any performance implications and how you've addressed them.

## Security Considerations
- [ ] No secrets or credentials are exposed
- [ ] Input validation is implemented
- [ ] SQL injection prevention is in place
- [ ] XSS prevention is implemented
```

### 4. Development Workflow

#### File: `DEVELOPMENT_WORKFLOW.md`
```markdown
# Development Workflow

## Branch Strategy

We follow a feature branch workflow:

1. **main**: Production-ready code
2. **feat/task-XX-description**: Feature branches
3. **fix/issue-description**: Bug fix branches
4. **chore/description**: Maintenance branches

## Development Process

### 1. Start New Task

```bash
# Create feature branch from main
git checkout main
git pull origin main
git checkout -b feat/task-01-core-infrastructure

# Create draft PR immediately
gh pr create --draft --title "feat(core): implement core infrastructure" --body "Task #01"
```

### 2. Development Cycle

```bash
# Make changes following TDD
bun test --watch

# Commit frequently with conventional commits
git add -A
git commit -m "feat(core): add ID generation service"

# Run checks before pushing
bun typecheck
bun format-and-lint:fix
bun test

# Push changes
git push origin feat/task-01-core-infrastructure
```

### 3. PR Ready for Review

```bash
# Update PR description with implementation details
gh pr ready

# Request review
gh pr review --request @reviewer
```

### 4. Address Review Comments

```bash
# Make requested changes
git add -A
git commit -m "fix(core): address PR review comments"

# Push and re-request review
git push
```

### 5. Merge Process

```bash
# After approval, ensure branch is up to date
git checkout main
git pull origin main
git checkout feat/task-01-core-infrastructure
git rebase main

# Push rebased branch
git push --force-with-lease

# Merge via GitHub UI or CLI
gh pr merge --squash --delete-branch
```

## Code Review Guidelines

### For Authors

1. **Keep PRs Small**: Aim for <300 lines of change
2. **Write Clear Descriptions**: Explain the "why" not just the "what"
3. **Add Tests**: Every feature needs tests
4. **Self-Review First**: Check your own PR before requesting review
5. **Respond Promptly**: Address feedback within 24 hours

### For Reviewers

1. **Review Promptly**: Within 4 hours during work hours
2. **Be Constructive**: Suggest improvements, don't just criticize
3. **Check for**:
   - Correctness of implementation
   - Test coverage
   - Performance implications
   - Security concerns
   - Code style and patterns
   - Documentation updates

## Commit Message Format

Follow conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes
- refactor: Code refactoring
- perf: Performance improvements
- test: Test updates
- build: Build system changes
- ci: CI configuration changes
- chore: Other changes

Example:
```
feat(cart): add session-based cart persistence

Implemented cart service with session tracking to enable
guest checkout. Carts persist for 30 days and can be
transferred when users log in.

Closes #123
```

## Testing Requirements

### Unit Tests
- Minimum 80% coverage for business logic
- All Edge cases covered
- Mock external dependencies

### Integration Tests
- Test service interactions
- Database operations
- API endpoints

### E2E Tests
- Critical user flows
- Checkout process
- Cart operations

## Documentation Requirements

1. **API Documentation**: Update when adding/changing endpoints
2. **Code Comments**: Explain complex logic
3. **README Updates**: Keep setup instructions current
4. **CHANGELOG**: Update for user-facing changes

## Security Checklist

Before merging, ensure:
- [ ] No hardcoded secrets
- [ ] Input validation implemented
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Rate limiting considered
- [ ] Authentication/authorization correct
- [ ] Error messages don't leak sensitive info

## Performance Considerations

- [ ] Database queries optimized
- [ ] N+1 queries avoided
- [ ] Caching implemented where appropriate
- [ ] Pagination for large datasets
- [ ] Response compression enabled
- [ ] Unnecessary computations avoided

## Rollback Plan

Every feature should be:
1. **Feature Flagged**: Can be disabled without deployment
2. **Backward Compatible**: Doesn't break existing functionality
3. **Monitored**: Metrics and alerts in place
4. **Documented**: Rollback steps clear
```

### 5. CODEOWNERS File

#### File: `.github/CODEOWNERS`
```
# Global owners
* @yourusername

# Backend
/apps/backend/ @backend-team
/packages/api/ @backend-team

# Frontend
/apps/website/ @frontend-team

# Infrastructure
/.github/ @devops-team
/tasks/ @lead-dev

# Documentation
*.md @documentation-team
```

### 6. Git Hooks with Lefthook

#### File: `lefthook.yml`
```yaml
pre-commit:
  parallel: true
  commands:
    typecheck:
      run: bun typecheck
    lint:
      run: bun format-and-lint
      
pre-push:
  parallel: true
  commands:
    test:
      run: bun test
    audit:
      run: bun audit
      
commit-msg:
  commands:
    commitlint:
      run: bunx commitlint --edit
```

### 7. Task Tracking Script

#### File: `scripts/new-task.sh`
```bash
#!/bin/bash

# Usage: ./scripts/new-task.sh 01 "Core Infrastructure"

TASK_NUMBER=$1
TASK_NAME=$2
BRANCH_NAME="feat/task-$(printf "%02d" $TASK_NUMBER)-$(echo $TASK_NAME | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

# Create branch
git checkout main
git pull origin main
git checkout -b $BRANCH_NAME

# Create draft PR
gh pr create \
  --draft \
  --title "feat: implement task $TASK_NUMBER - $TASK_NAME" \
  --body "## Task $TASK_NUMBER: $TASK_NAME

Related to: /tasks/$(printf "%02d" $TASK_NUMBER)-*.md

## Implementation Progress
- [ ] Implementation complete
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Self-review completed

## Checklist
- [ ] Follows coding standards
- [ ] No security vulnerabilities
- [ ] Performance considered
- [ ] Error handling implemented"

echo "Created branch: $BRANCH_NAME"
echo "Draft PR created. Start implementing!"
```

### 8. Automated Task Completion Check

#### File: `.github/workflows/task-check.yml`
```yaml
name: Task Completion Check

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  check-task:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        with:
          script: |
            const pr = context.payload.pull_request;
            const taskMatch = pr.title.match(/task (\d+)/i);
            
            if (!taskMatch) return;
            
            const taskNumber = taskMatch[1].padStart(2, '0');
            const taskFile = `tasks/${taskNumber}-*.md`;
            
            // Check if task file exists
            const { data: files } = await github.rest.repos.getContent({
              owner: context.repo.owner,
              repo: context.repo.repo,
              path: 'tasks'
            });
            
            const taskFiles = files.filter(f => 
              f.name.startsWith(`${taskNumber}-`)
            );
            
            if (taskFiles.length === 0) {
              core.setFailed(`Task file ${taskFile} not found`);
              return;
            }
            
            // Add task label
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: pr.number,
              labels: [`task-${taskNumber}`]
            });
```

## Implementation Steps

1. **Set up GitHub repository settings**
   - Enable branch protection on main
   - Configure required status checks
   - Set up CODEOWNERS

2. **Add workflow files**
   - Copy all GitHub Actions workflows
   - Add PR template
   - Add development workflow documentation

3. **Configure local development**
   - Install lefthook: `bunx lefthook install`
   - Set up git aliases for common commands
   - Configure IDE for project standards

4. **Create first PR using new workflow**
   - Use the new-task.sh script
   - Follow the PR template
   - Ensure all checks pass

## Verification

After setup, verify:
- [ ] Cannot push directly to main
- [ ] PRs require approval
- [ ] All CI checks run on PR
- [ ] Conventional commit validation works
- [ ] PR template appears for new PRs
- [ ] Lefthook runs pre-commit checks

## Next Steps

With the development workflow in place:
1. Each task implementation creates a new PR
2. All code is reviewed before merging
3. Automated checks prevent regressions
4. Clear history with conventional commits
5. Easy rollback if issues arise

Now we can proceed with Task 01: Core Infrastructure using this workflow!