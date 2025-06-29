# Task 01: Core Infrastructure

## Overview
Set up the foundational services and utilities that all other components will use. This includes database setup, ID generation, response formatting, and error handling.

## Database Schema

```sql
-- Core configuration table
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ID sequences for different entities
CREATE TABLE IF NOT EXISTS id_sequences (
  entity_type TEXT PRIMARY KEY,
  current_value INTEGER DEFAULT 0,
  prefix TEXT NOT NULL
);

-- Insert default sequences
INSERT INTO id_sequences (entity_type, prefix) VALUES
  ('session', 'ses'),
  ('cart', 'crt'),
  ('product', 'prd'),
  ('variant', 'var'),
  ('category', 'cat'),
  ('customer', 'cus'),
  ('order', 'ord'),
  ('admin', 'adm'),
  ('address', 'adr'),
  ('payment', 'pay');
```

## Effect Schemas

### File: `packages/api/src/common/id.ts`
```typescript
import { Schema } from "@effect/schema"
import { Brand } from "effect"

// Branded ID types for type safety
export type SessionId = string & Brand.Brand<"SessionId">
export const SessionId = Brand.nominal<SessionId>()

export type CartId = string & Brand.Brand<"CartId">
export const CartId = Brand.nominal<CartId>()

export type ProductId = string & Brand.Brand<"ProductId">
export const ProductId = Brand.nominal<ProductId>()

export type CustomerId = string & Brand.Brand<"CustomerId">
export const CustomerId = Brand.nominal<CustomerId>()

export type OrderId = string & Brand.Brand<"OrderId">
export const OrderId = Brand.nominal<OrderId>()

export type AdminId = string & Brand.Brand<"AdminId">
export const AdminId = Brand.nominal<AdminId>()

// Schema validators
export const SessionIdSchema = Schema.String.pipe(
  Schema.pattern(/^ses_[a-zA-Z0-9]{16}$/),
  Schema.fromBrand(SessionId)
)

export const CartIdSchema = Schema.String.pipe(
  Schema.pattern(/^crt_[a-zA-Z0-9]{16}$/),
  Schema.fromBrand(CartId)
)

export const ProductIdSchema = Schema.String.pipe(
  Schema.pattern(/^prd_[a-zA-Z0-9]{16}$/),
  Schema.fromBrand(ProductId)
)

// Add other ID schemas...
```

### File: `packages/api/src/common/errors.ts`
```typescript
import { Schema } from "@effect/schema"

// Base error class
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
  statusCode: Schema.Number
}) {}

// Specific errors
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  resource: Schema.String,
  id: Schema.String
}) {
  static readonly statusCode = 404
}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String,
  message: Schema.String,
  value: Schema.optional(Schema.Unknown)
}) {
  static readonly statusCode = 422
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()("UnauthorizedError", {
  message: Schema.String
}) {
  static readonly statusCode = 401
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  resource: Schema.String,
  field: Schema.String,
  value: Schema.String
}) {
  static readonly statusCode = 409
}

export class BusinessError extends Schema.TaggedError<BusinessError>()("BusinessError", {
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown)
}) {
  static readonly statusCode = 400
}
```

### File: `packages/api/src/common/response.ts`
```typescript
import { Schema } from "@effect/schema"

// Standard API response wrapper
export class ApiResponse<T> extends Schema.Class<ApiResponse<T>>("ApiResponse")<{
  data: T
  meta: {
    timestamp: typeof Schema.DateFromSelf
    requestId: typeof Schema.String
  }
}> {}

// Paginated response
export class PaginatedResponse<T> extends Schema.Class<PaginatedResponse<T>>("PaginatedResponse")<{
  data: Schema.Array<T>
  pagination: {
    page: typeof Schema.Number
    pageSize: typeof Schema.Number
    total: typeof Schema.Number
    totalPages: typeof Schema.Number
  }
  meta: {
    timestamp: typeof Schema.DateFromSelf
    requestId: typeof Schema.String
  }
}> {}

// Error response
export class ErrorResponse extends Schema.Class<ErrorResponse>("ErrorResponse")({
  error: ApiError,
  meta: {
    timestamp: Schema.DateFromSelf,
    requestId: Schema.String
  }
}) {}
```

## Core Services

### File: `apps/backend/src/services/IdService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import * as Id from "@turbobun/api/common/id"

export class IdService extends Context.Tag("IdService")<
  IdService,
  {
    readonly generateSessionId: Effect.Effect<Id.SessionId>
    readonly generateCartId: Effect.Effect<Id.CartId>
    readonly generateProductId: Effect.Effect<Id.ProductId>
    readonly generateCustomerId: Effect.Effect<Id.CustomerId>
    readonly generateOrderId: Effect.Effect<Id.OrderId>
    readonly generateAdminId: Effect.Effect<Id.AdminId>
  }
>() {}

const generateId = (entityType: string) => 
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    
    const result = yield* sql`
      UPDATE id_sequences 
      SET current_value = current_value + 1 
      WHERE entity_type = ${entityType}
      RETURNING prefix, current_value
    `.pipe(
      Effect.flatMap(rows => 
        rows.length > 0 
          ? Effect.succeed(rows[0])
          : Effect.fail(new Error(`Unknown entity type: ${entityType}`))
      )
    )
    
    // Generate random suffix
    const randomSuffix = Math.random().toString(36).substring(2, 18)
    return `${result.prefix}_${randomSuffix}`
  })

export const IdServiceLive = Layer.effect(
  IdService,
  Effect.gen(function* () {
    return IdService.of({
      generateSessionId: generateId("session").pipe(Effect.map(Id.SessionId)),
      generateCartId: generateId("cart").pipe(Effect.map(Id.CartId)),
      generateProductId: generateId("product").pipe(Effect.map(Id.ProductId)),
      generateCustomerId: generateId("customer").pipe(Effect.map(Id.CustomerId)),
      generateOrderId: generateId("order").pipe(Effect.map(Id.OrderId)),
      generateAdminId: generateId("admin").pipe(Effect.map(Id.AdminId))
    })
  })
)
```

### File: `apps/backend/src/services/ConfigService.ts`
```typescript
import { Context, Effect, Layer, Config } from "effect"
import { SqlClient } from "@effect/sql"

export interface AppConfig {
  readonly sessionTtlDays: number
  readonly cartTtlDays: number
  readonly jwtSecret: string
  readonly jwtExpiresIn: number
  readonly refreshTokenExpiresIn: number
  readonly bcryptRounds: number
  readonly maxCartItems: number
  readonly maxAddresses: number
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  {
    readonly get: <K extends keyof AppConfig>(key: K) => Effect.Effect<AppConfig[K]>
    readonly set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Effect.Effect<void>
    readonly getAll: Effect.Effect<AppConfig>
  }
>() {}

const defaultConfig: AppConfig = {
  sessionTtlDays: 30,
  cartTtlDays: 30,
  jwtSecret: "your-secret-key-change-in-production",
  jwtExpiresIn: 900, // 15 minutes
  refreshTokenExpiresIn: 604800, // 7 days
  bcryptRounds: 10,
  maxCartItems: 100,
  maxAddresses: 10
}

export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    
    // Initialize default config in database
    yield* Effect.forEach(
      Object.entries(defaultConfig),
      ([key, value]) => sql`
        INSERT INTO system_config (key, value) 
        VALUES (${key}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO NOTHING
      `,
      { concurrency: "unbounded" }
    )
    
    return ConfigService.of({
      get: (key) => 
        sql`SELECT value FROM system_config WHERE key = ${key}`.pipe(
          Effect.flatMap(rows =>
            rows.length > 0
              ? Effect.try(() => JSON.parse(rows[0].value) as AppConfig[typeof key])
              : Effect.succeed(defaultConfig[key])
          )
        ),
      
      set: (key, value) =>
        sql`
          INSERT INTO system_config (key, value) 
          VALUES (${key}, ${JSON.stringify(value)})
          ON CONFLICT (key) DO UPDATE SET 
            value = ${JSON.stringify(value)},
            updated_at = CURRENT_TIMESTAMP
        `.pipe(Effect.asUnit),
      
      getAll: Effect.all(
        Object.keys(defaultConfig).reduce(
          (acc, key) => ({
            ...acc,
            [key]: sql`SELECT value FROM system_config WHERE key = ${key}`.pipe(
              Effect.flatMap(rows =>
                rows.length > 0
                  ? Effect.try(() => JSON.parse(rows[0].value))
                  : Effect.succeed(defaultConfig[key as keyof AppConfig])
              )
            )
          }),
          {} as { [K in keyof AppConfig]: Effect.Effect<AppConfig[K]> }
        )
      )
    })
  })
)
```

## API Response Helpers

### File: `apps/backend/src/http/response.ts`
```typescript
import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { ApiResponse, PaginatedResponse, ErrorResponse } from "@turbobun/api/common/response"
import * as Errors from "@turbobun/api/common/errors"

// Generate request ID
const generateRequestId = () => 
  `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

// Success response helper
export const successResponse = <T>(data: T) =>
  Effect.gen(function* () {
    const response = new ApiResponse({
      data,
      meta: {
        timestamp: new Date(),
        requestId: generateRequestId()
      }
    })
    
    return yield* HttpServerResponse.json(response)
  })

// Paginated response helper
export const paginatedResponse = <T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number }
) =>
  Effect.gen(function* () {
    const response = new PaginatedResponse({
      data,
      pagination: {
        ...pagination,
        totalPages: Math.ceil(pagination.total / pagination.pageSize)
      },
      meta: {
        timestamp: new Date(),
        requestId: generateRequestId()
      }
    })
    
    return yield* HttpServerResponse.json(response)
  })

// Error response helper
export const errorResponse = (error: unknown) =>
  Effect.gen(function* () {
    let apiError: Errors.ApiError
    let statusCode = 500
    
    if (error instanceof Errors.NotFoundError) {
      apiError = new Errors.ApiError({
        code: "NOT_FOUND",
        message: `${error.resource} with id '${error.id}' not found`,
        statusCode: 404
      })
      statusCode = 404
    } else if (error instanceof Errors.ValidationError) {
      apiError = new Errors.ApiError({
        code: "VALIDATION_ERROR",
        message: error.message,
        details: { field: error.field, value: error.value },
        statusCode: 422
      })
      statusCode = 422
    } else if (error instanceof Errors.UnauthorizedError) {
      apiError = new Errors.ApiError({
        code: "UNAUTHORIZED",
        message: error.message,
        statusCode: 401
      })
      statusCode = 401
    } else if (error instanceof Errors.BusinessError) {
      apiError = new Errors.ApiError({
        code: error.code,
        message: error.message,
        details: error.details,
        statusCode: 400
      })
      statusCode = 400
    } else {
      apiError = new Errors.ApiError({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        statusCode: 500
      })
    }
    
    const response = new ErrorResponse({
      error: apiError,
      meta: {
        timestamp: new Date(),
        requestId: generateRequestId()
      }
    })
    
    return yield* HttpServerResponse.json(response, { status: statusCode })
  })
```

## Database Migrations

### File: `apps/backend/src/migrations/0001_core_infrastructure.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  // System config table
  yield* sql`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  
  // ID sequences table
  yield* sql`
    CREATE TABLE IF NOT EXISTS id_sequences (
      entity_type TEXT PRIMARY KEY,
      current_value INTEGER DEFAULT 0,
      prefix TEXT NOT NULL
    )
  `
  
  // Insert default sequences
  const sequences = [
    { entity_type: 'session', prefix: 'ses' },
    { entity_type: 'cart', prefix: 'crt' },
    { entity_type: 'product', prefix: 'prd' },
    { entity_type: 'variant', prefix: 'var' },
    { entity_type: 'category', prefix: 'cat' },
    { entity_type: 'customer', prefix: 'cus' },
    { entity_type: 'order', prefix: 'ord' },
    { entity_type: 'admin', prefix: 'adm' },
    { entity_type: 'address', prefix: 'adr' },
    { entity_type: 'payment', prefix: 'pay' }
  ]
  
  yield* Effect.forEach(
    sequences,
    (seq) => sql`
      INSERT INTO id_sequences (entity_type, prefix) 
      VALUES (${seq.entity_type}, ${seq.prefix})
      ON CONFLICT (entity_type) DO NOTHING
    `,
    { concurrency: "unbounded" }
  )
})
```

## Tests

### File: `apps/backend/src/services/__tests__/IdService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { IdService, IdServiceLive } from "../IdService"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { SqlClient } from "@effect/sql"

const TestDatabaseLive = SqliteClient.layer({
  filename: ":memory:"
})

const testLayer = Layer.mergeAll(
  TestDatabaseLive,
  IdServiceLive
)

describe("IdService", () => {
  it("should generate unique session IDs", () =>
    Effect.gen(function* () {
      const idService = yield* IdService
      
      const id1 = yield* idService.generateSessionId
      const id2 = yield* idService.generateSessionId
      
      expect(id1).toMatch(/^ses_[a-zA-Z0-9]{16}$/)
      expect(id2).toMatch(/^ses_[a-zA-Z0-9]{16}$/)
      expect(id1).not.toBe(id2)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should generate IDs with correct prefixes", () =>
    Effect.gen(function* () {
      const idService = yield* IdService
      
      const sessionId = yield* idService.generateSessionId
      const cartId = yield* idService.generateCartId
      const productId = yield* idService.generateProductId
      
      expect(sessionId).toStartWith("ses_")
      expect(cartId).toStartWith("crt_")
      expect(productId).toStartWith("prd_")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Integration Points

1. **Database Layer**: All services depend on SqlClient
2. **Error Handling**: Use error types consistently across all services
3. **Response Format**: All HTTP responses use the standard wrappers
4. **ID Generation**: All entities use the IdService for consistent IDs

## Next Steps

After completing this task:
1. Run migrations to set up database
2. Verify all tests pass
3. Move to Task 02: Session Management