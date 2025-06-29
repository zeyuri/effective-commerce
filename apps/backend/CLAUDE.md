# CLAUDE.md - Backend Package

This file provides guidance for implementing the Effect backend server using the API definitions from `@turbobun/api`.

## Overview

This package implements the HTTP server and business logic for the API contracts defined in the `@turbobun/api` package.

## Server Implementation Pattern

### 1. Service Layer

Define services using Effect's Context pattern:

```typescript
import { Context, Effect, Layer } from "effect"

export class ProductService extends Context.Tag("ProductService")<
  ProductService,
  {
    readonly getAll: Effect.Effect<Product[]>
    readonly getById: (id: string) => Effect.Effect<Product, ProductNotFoundError>
    readonly create: (data: CreateProductRequest) => Effect.Effect<Product>
  }
>() {}

// Implementation
export const ProductServiceLive = Layer.effect(
  ProductService,
  Effect.gen(function* () {
    const sql = yield* SqliteClient.SqliteClient
    
    return ProductService.of({
      getAll: Effect.gen(function* () {
        // Implementation
      }),
      // ... other methods
    })
  })
)
```

### 2. HTTP Handler Implementation

Implement API handlers using `HttpApiBuilder`:

```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Api } from "@turbobun/api"

export const ProductsGroupLive = HttpApiBuilder.group(
  Api,
  "products",
  (handlers) =>
    handlers
      .handle("getAll", () =>
        Effect.gen(function* () {
          const service = yield* ProductService
          return yield* service.getAll
        })
      )
      .handle("getById", ({ path: { id } }) =>
        Effect.gen(function* () {
          const service = yield* ProductService
          return yield* service.getById(id)
        })
      )
)
```

### 3. Server Setup

Create the complete server with proper layering:

```typescript
import { BunRuntime, BunHttpServer } from "@effect/platform-bun"
import { HttpApiBuilder, HttpServer, HttpMiddleware } from "@effect/platform"

// Build the complete API
const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(ProductsGroupLive),
  Layer.provide(AuthGroupLive)
)

// Create the HTTP server
const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  // Add middleware
  Layer.provide(HttpApiBuilder.middlewareCors()),
  // Provide the API implementation
  Layer.provide(ApiLive),
  // Add server configuration
  HttpServer.withLogAddress,
  // Provide the server runtime
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

// Launch the application
const program = Effect.gen(function* () {
  // Setup database
  yield* setupDatabase
  
  // Launch server
  yield* Layer.launch(HttpLive)
})

program.pipe(BunRuntime.runMain)
```

## File Structure

Keep it simple - minimal folders:
```
src/
├── index.ts              # Main server entry point
└── product.ts            # Product API implementation
```

## Database Setup

Use Effect SQL for database operations:

```typescript
import { SqliteClient } from "@effect/sql-sqlite-bun"

export const SqliteLive = SqliteClient.layer({
  filename: "./database.db"
})
```

## Error Handling

Define custom errors that match API error schemas:

```typescript
export class ProductNotFoundError extends Schema.TaggedError<ProductNotFoundError>()("ProductNotFoundError", {
  productId: Schema.String
}) {}
```

## Testing Pattern

```typescript
// Run typecheck before dev
bun typecheck

// Run the development server
bun dev
```

## Best Practices

1. Always run `bun typecheck` before starting the dev server
2. Use Effect.gen for readable async code
3. Handle all errors explicitly with proper error types
4. Use layers for dependency injection and testability
5. Keep business logic in services, HTTP concerns in handlers
6. Use transactions for database operations that modify data