# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TurboBun monorepo - a modern full-stack e-commerce template using Bun as runtime, Turborepo for monorepo orchestration, Elysia.js for backend API, and Next.js for frontend.

## Commands

### Development
- `bun dev` - Run all apps concurrently (backend on port 3000, frontend on port 3002)
- `bun --filter './apps/backend' dev` - Run backend only with hot reload
- `bun --filter './apps/website' dev` - Run frontend only with Next.js fast refresh

### Build & Production
- `bun build` - Build all apps
- `bun --filter './apps/backend' start` - Start backend in production
- `bun --filter './apps/website' start` - Start frontend in production

### Code Quality
- `bun format-and-lint:fix` - Auto-fix code formatting with Biome
- `bun typecheck` - Run TypeScript type checking across all packages
- `bun check` - Run all checks (format, lint, case-police, knip)

### Testing
- No test framework is currently configured - ask user before adding tests

### Git Workflow
- `bun commit` - Use interactive commit with commitizen (conventional commits)
- `lefthook install` - Optional: Install git hooks for automated checks

## Architecture

### Monorepo Structure
```
apps/
├── backend/     # Elysia.js API server (TypeScript)
└── website/     # Next.js 14 App Router frontend

packages/
├── api/         # Shared API client using Eden (type-safe Elysia client)
└── typescript-config/ # Shared TypeScript configurations
```

### Key Technical Decisions

1. **API Communication**: The frontend communicates with backend via Eden (packages/api), which provides end-to-end type safety between Elysia backend and frontend.

2. **Styling**: Tailwind CSS with PostCSS for styling. Use utility-first approach.

3. **State Management**: No global state management is configured - implement based on requirements.

4. **Database**: No database is currently configured - backend only has basic endpoints.

5. **Authentication**: No auth system is implemented yet.

### Code Style (Enforced by Biome)
- 2 spaces for indentation
- Single quotes for strings
- Semicolons as needed
- Trailing commas
- 100 character line width

### Development Patterns

1. **Backend Routes**: Add new Elysia routes in apps/backend/src/index.ts
2. **API Types**: Export backend app type for Eden client type safety
3. **Frontend Pages**: Use Next.js 14 App Router conventions in apps/website/app/
4. **Shared Code**: Place in packages/ directory with proper workspace references

### Environment Variables
- Backend runs on default port (3000)
- Frontend configured to run on port 3002
- No .env files are currently configured

## Important Notes

- Always use `bun` instead of `npm` or `yarn`
- Workspace packages use `workspace:*` syntax in package.json
- Turbo caches builds - use `bun clean` if you encounter cache issues
- Eden client auto-generates types from Elysia backend - ensure backend is running for type updates