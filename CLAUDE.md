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

## E-Commerce Implementation Plan

This project is being developed as a comprehensive e-commerce platform with guest checkout, customer accounts, and admin functionality. The implementation follows Effect TS patterns throughout.

### Implementation Status

The complete implementation plan has been created with 12 detailed task files in the `/tasks` directory. Each task contains database schemas, Effect services, API definitions, and implementation details.

### Task Overview

1. **Task 00: Development Workflow** (`tasks/00-development-workflow.md`)
   - GitHub branch protection and PR workflows
   - CI/CD pipelines with GitHub Actions
   - Development workflow documentation
   - Git hooks and automated checks

2. **Task 01: Core Infrastructure** (`tasks/01-core-infrastructure.md`)
   - Database setup with SQLite
   - ID generation service with branded types
   - Error type hierarchy
   - Response wrapper utilities

3. **Task 02: Session Management** (`tasks/02-session-management.md`)
   - Session-based tracking for anonymous users
   - Cookie management
   - Device fingerprinting
   - Session recovery mechanisms

4. **Task 03: Product Catalog** (`tasks/03-product-catalog.md`)
   - Product and variant schemas
   - Category management
   - Inventory tracking
   - Product search and filtering

5. **Task 04: Cart System** (`tasks/04-cart-system.md`)
   - Session-based cart (works without login)
   - Cart persistence and recovery
   - Cart validation and pricing
   - Guest to customer cart merging

6. **Task 05: Checkout Workflow** (`tasks/05-checkout-workflow.md`)
   - Multi-step checkout process
   - Address collection and validation
   - Shipping method selection
   - Payment provider abstraction
   - Tax calculation

7. **Task 06: Order Management** (`tasks/06-order-management.md`)
   - Order creation from checkout
   - Guest order tracking by email
   - Order fulfillment workflow
   - Order event tracking

8. **Task 07: Customer Accounts** (`tasks/07-customer-accounts.md`)
   - Optional registration
   - Post-checkout account creation
   - Profile and address management
   - Guest data merging on login

9. **Task 08: Authentication System** (`tasks/08-authentication-system.md`)
   - JWT with refresh tokens
   - Multi-scope permissions
   - Admin authentication
   - API key management

10. **Task 09: Admin Foundation** (`tasks/09-admin-foundation.md`)
    - Role-based access control
    - Audit logging
    - Admin notifications
    - Dashboard services

11. **Task 10: Admin APIs** (`tasks/10-admin-apis.md`)
    - Product management
    - Order management
    - Customer management
    - Reports and analytics

12. **Task 11: Testing Strategy** (`tasks/11-testing-strategy.md`)
    - Unit, integration, E2E tests
    - Test factories and utilities
    - Performance testing
    - CI integration

13. **Task 12: Production Features** (`tasks/12-production-features.md`)
    - Health checks
    - Monitoring and metrics
    - Rate limiting
    - Error tracking
    - Caching strategy

### Key Design Principles

1. **Effect-First Architecture**: Every service uses Effect for type safety and error handling
2. **Layer-Based DI**: Clean dependency injection using Effect layers
3. **Session-Based Cart**: Shopping cart works without authentication
4. **Branded Types**: Type-safe IDs (SessionId, CartId, OrderId, etc.)
5. **Workflow Pattern**: Complex operations implemented as Effect workflows

### Implementation Workflow

When implementing each task:

1. Start with the task file in `/tasks` directory
2. Create a feature branch: `feat/task-XX-description`
3. Open a draft PR immediately
4. Follow the schemas and implementations in the task file
5. Write tests alongside implementation
6. Run quality checks before pushing
7. Convert to ready PR when complete

### Current Architecture Decisions

- **Runtime**: Bun for speed and built-in TypeScript
- **Backend**: Elysia.js with Effect TS
- **Database**: SQLite for simplicity (can migrate to PostgreSQL)
- **Sessions**: Cookie-based with secure httpOnly cookies
- **IDs**: Prefixed string IDs (e.g., `prod_abc123`, `cart_xyz789`)
- **Validation**: Effect Schema for runtime validation
- **Errors**: Tagged error types for exhaustive handling

### Development Guidelines

1. **Always use Effect**: No raw promises, use Effect for all async operations
2. **Layer composition**: Services depend on layers, not concrete implementations
3. **Error handling**: Use tagged errors, handle all error cases
4. **Type safety**: Leverage branded types and Effect Schema
5. **Testing**: Write tests for all services and endpoints

### Next Steps for Implementation

1. Start with Task 00 to set up development workflow
2. Implement Task 01 for core infrastructure
3. Progress through tasks sequentially (each builds on previous)
4. Use task files as reference during implementation
5. Maintain PR-based workflow for all changes

### Common Patterns

```typescript
// Service definition
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly operation: (input: Input) => Effect.Effect<Output, MyError>
  }
>() {}

// Layer implementation
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* Dependency
    
    return {
      operation: (input) => Effect.gen(function* () {
        // Implementation
      })
    }
  })
)

// API endpoint
const endpoint = Api.post("name", "/path").pipe(
  Api.setRequestBody(RequestSchema),
  Api.setResponseBody(ResponseSchema)
)

// Handler
const handler = Handler.make(
  endpoint,
  ({ body }) => Effect.gen(function* () {
    const service = yield* MyService
    return yield* service.operation(body)
  })
)
```