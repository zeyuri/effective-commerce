# Task 08: Authentication System

## Overview
Implement JWT-based authentication system with multi-scope support for customers, admins, and API keys. Includes refresh tokens, session management, and auth middleware.

## Database Schema

```sql
-- Auth tokens table
CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  token_type TEXT NOT NULL, -- access, refresh, api_key
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL, -- customer, admin, api
  scope TEXT NOT NULL, -- JSON array of permissions
  
  -- Token metadata
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME,
  revoked_at DATETIME,
  revoked_reason TEXT,
  
  -- Request metadata
  ip_address TEXT,
  user_agent TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL, -- super_admin, admin, support
  permissions TEXT NOT NULL, -- JSON array
  
  is_active BOOLEAN DEFAULT true,
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret TEXT,
  
  last_login_at DATETIME,
  password_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL, -- JSON array
  
  -- Rate limiting
  rate_limit_per_minute INTEGER DEFAULT 60,
  rate_limit_per_hour INTEGER DEFAULT 1000,
  
  -- Usage tracking
  last_used_at DATETIME,
  usage_count INTEGER DEFAULT 0,
  
  is_active BOOLEAN DEFAULT true,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_auth_tokens_token_hash ON auth_tokens(token_hash);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id, user_type);
CREATE INDEX idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
```

## Effect Schemas

### File: `packages/api/src/auth/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { Brand } from "effect"

// Token types
export type AccessToken = string & Brand.Brand<"AccessToken">
export const AccessToken = Brand.nominal<AccessToken>()

export type RefreshToken = string & Brand.Brand<"RefreshToken">
export const RefreshToken = Brand.nominal<RefreshToken>()

export type ApiKey = string & Brand.Brand<"ApiKey">
export const ApiKey = Brand.nominal<ApiKey>()

// User types
export const UserType = Schema.Literal("customer", "admin", "api")
export type UserType = Schema.Schema.Type<typeof UserType>

// Permissions
export const Permission = Schema.Literal(
  // Customer permissions
  "customer:read",
  "customer:write",
  "orders:read",
  "orders:write",
  
  // Admin permissions
  "admin:read",
  "admin:write",
  "products:read",
  "products:write",
  "customers:read",
  "customers:write",
  "orders:manage",
  "settings:read",
  "settings:write",
  
  // API permissions
  "api:products:read",
  "api:products:write",
  "api:orders:read",
  "api:orders:write"
)
export type Permission = Schema.Schema.Type<typeof Permission>

// Auth context
export class AuthContext extends Schema.Class<AuthContext>("AuthContext")({
  userId: Schema.String,
  userType: UserType,
  permissions: Schema.Array(Permission),
  tokenId: Schema.String,
  expiresAt: Schema.DateFromString
}) {}

// Login request
export class LoginRequest extends Schema.Class<LoginRequest>("LoginRequest")({
  email: Schema.String.pipe(Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  password: Schema.String.pipe(Schema.minLength(1)),
  twoFactorCode: Schema.optional(Schema.String.pipe(Schema.length(6)))
}) {}

// Token response
export class TokenResponse extends Schema.Class<TokenResponse>("TokenResponse")({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  tokenType: Schema.Literal("Bearer"),
  expiresIn: Schema.Number,
  scope: Schema.Array(Permission)
}) {}

// Admin user
export class AdminUser extends Schema.Class<AdminUser>("AdminUser")({
  id: Schema.String,
  email: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  role: Schema.Literal("super_admin", "admin", "support"),
  permissions: Schema.Array(Permission),
  isActive: Schema.Boolean,
  twoFactorEnabled: Schema.Boolean,
  lastLoginAt: Schema.optional(Schema.DateFromString),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString
}) {}

// API key
export class ApiKeyInfo extends Schema.Class<ApiKeyInfo>("ApiKeyInfo")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  permissions: Schema.Array(Permission),
  rateLimitPerMinute: Schema.Number,
  rateLimitPerHour: Schema.Number,
  lastUsedAt: Schema.optional(Schema.DateFromString),
  usageCount: Schema.Number,
  isActive: Schema.Boolean,
  expiresAt: Schema.optional(Schema.DateFromString),
  createdAt: Schema.DateFromString
}) {}
```

## Service Implementation

### File: `apps/backend/src/services/auth.ts`
```typescript
import { Context, Effect, Layer, Option, pipe } from "effect"
import * as jwt from "jsonwebtoken"
import * as bcrypt from "bcrypt"
import { Database } from "./database"
import { IdService } from "./id"
import { 
  AccessToken, 
  RefreshToken, 
  AuthContext, 
  LoginRequest,
  TokenResponse,
  UserType,
  Permission
} from "@/packages/api/src/auth/schemas"

// Errors
export class InvalidCredentialsError extends Schema.TaggedError<InvalidCredentialsError>()(
  "InvalidCredentialsError",
  {
    message: Schema.String
  }
) {}

export class TokenExpiredError extends Schema.TaggedError<TokenExpiredError>()(
  "TokenExpiredError",
  {
    token: Schema.String
  }
) {}

export class InsufficientPermissionsError extends Schema.TaggedError<InsufficientPermissionsError>()(
  "InsufficientPermissionsError",
  {
    required: Schema.Array(Permission),
    actual: Schema.Array(Permission)
  }
) {}

// Config
export class AuthConfig extends Context.Tag("AuthConfig")<
  AuthConfig,
  {
    readonly jwtSecret: string
    readonly accessTokenTTL: number // seconds
    readonly refreshTokenTTL: number // seconds
    readonly bcryptRounds: number
  }
>() {}

// Service
export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  {
    readonly login: (request: LoginRequest, userType: UserType) => Effect.Effect<TokenResponse, InvalidCredentialsError>
    readonly refresh: (token: RefreshToken) => Effect.Effect<TokenResponse, TokenExpiredError | InvalidCredentialsError>
    readonly verify: (token: AccessToken) => Effect.Effect<AuthContext, TokenExpiredError>
    readonly revoke: (token: AccessToken | RefreshToken) => Effect.Effect<void>
    readonly createApiKey: (name: string, permissions: Permission[]) => Effect.Effect<{ key: ApiKey; info: ApiKeyInfo }>
    readonly verifyApiKey: (key: ApiKey) => Effect.Effect<AuthContext, InvalidCredentialsError>
  }
>() {}

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const db = yield* Database
    const ids = yield* IdService
    const config = yield* AuthConfig
    
    const hashPassword = (password: string) =>
      Effect.promise(() => bcrypt.hash(password, config.bcryptRounds))
    
    const verifyPassword = (password: string, hash: string) =>
      Effect.promise(() => bcrypt.compare(password, hash))
    
    const generateToken = (payload: any, expiresIn: number) =>
      Effect.sync(() => jwt.sign(payload, config.jwtSecret, { expiresIn }))
    
    const verifyToken = (token: string) =>
      Effect.try({
        try: () => jwt.verify(token, config.jwtSecret) as any,
        catch: () => new TokenExpiredError({ token })
      })
    
    const login = (request: LoginRequest, userType: UserType) =>
      Effect.gen(function* () {
        // Find user based on type
        const table = userType === "customer" ? "customers" : "admin_users"
        const user = yield* db.get(
          `SELECT * FROM ${table} WHERE email = ? AND is_active = 1`,
          [request.email]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new InvalidCredentialsError({ message: "Invalid email or password" })),
            onSome: Effect.succeed
          }))
        )
        
        // Verify password
        const valid = yield* verifyPassword(request.password, user.password_hash)
        if (!valid) {
          yield* Effect.fail(new InvalidCredentialsError({ message: "Invalid email or password" }))
        }
        
        // Check 2FA if enabled
        if (user.two_factor_enabled && userType === "admin") {
          if (!request.twoFactorCode) {
            yield* Effect.fail(new InvalidCredentialsError({ message: "2FA code required" }))
          }
          // Verify 2FA code here
        }
        
        // Generate tokens
        const tokenId = yield* ids.generate("token")
        const accessToken = yield* generateToken({
          sub: user.id,
          type: userType,
          scope: user.permissions || [],
          tid: tokenId
        }, config.accessTokenTTL)
        
        const refreshToken = yield* generateToken({
          sub: user.id,
          type: userType,
          tid: tokenId
        }, config.refreshTokenTTL)
        
        // Store tokens
        yield* db.run(
          `INSERT INTO auth_tokens (id, token_type, token_hash, user_id, user_type, scope, expires_at)
           VALUES (?, 'access', ?, ?, ?, ?, datetime('now', '+${config.accessTokenTTL} seconds'))`,
          [tokenId, await hashPassword(accessToken), user.id, userType, JSON.stringify(user.permissions || [])]
        )
        
        yield* db.run(
          `INSERT INTO auth_tokens (id, token_type, token_hash, user_id, user_type, scope, expires_at)
           VALUES (?, 'refresh', ?, ?, ?, ?, datetime('now', '+${config.refreshTokenTTL} seconds'))`,
          [yield* ids.generate("token"), await hashPassword(refreshToken), user.id, userType, JSON.stringify([])]
        )
        
        // Update last login
        yield* db.run(
          `UPDATE ${table} SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [user.id]
        )
        
        return new TokenResponse({
          accessToken,
          refreshToken,
          tokenType: "Bearer" as const,
          expiresIn: config.accessTokenTTL,
          scope: user.permissions || []
        })
      })
    
    const refresh = (token: RefreshToken) =>
      Effect.gen(function* () {
        const decoded = yield* verifyToken(RefreshToken.value(token))
        
        // Find refresh token
        const tokenHash = yield* Effect.promise(() => hashPassword(RefreshToken.value(token)))
        const tokenRecord = yield* db.get(
          `SELECT * FROM auth_tokens 
           WHERE token_hash = ? AND token_type = 'refresh' 
           AND expires_at > datetime('now') AND revoked_at IS NULL`,
          [tokenHash]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new TokenExpiredError({ token: RefreshToken.value(token) })),
            onSome: Effect.succeed
          }))
        )
        
        // Generate new tokens
        const userTable = decoded.type === "customer" ? "customers" : "admin_users"
        const user = yield* db.get(
          `SELECT * FROM ${userTable} WHERE id = ?`,
          [decoded.sub]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new InvalidCredentialsError({ message: "User not found" })),
            onSome: Effect.succeed
          }))
        )
        
        // Revoke old refresh token
        yield* db.run(
          `UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [tokenRecord.id]
        )
        
        // Create new tokens
        return yield* login(
          new LoginRequest({ email: user.email, password: "" }),
          decoded.type
        )
      })
    
    const verify = (token: AccessToken) =>
      Effect.gen(function* () {
        const decoded = yield* verifyToken(AccessToken.value(token))
        
        // Verify token exists and not revoked
        const tokenHash = yield* Effect.promise(() => hashPassword(AccessToken.value(token)))
        yield* db.get(
          `SELECT * FROM auth_tokens 
           WHERE token_hash = ? AND token_type = 'access' 
           AND expires_at > datetime('now') AND revoked_at IS NULL`,
          [tokenHash]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new TokenExpiredError({ token: AccessToken.value(token) })),
            onSome: Effect.succeed
          }))
        )
        
        return new AuthContext({
          userId: decoded.sub,
          userType: decoded.type,
          permissions: decoded.scope || [],
          tokenId: decoded.tid,
          expiresAt: new Date(Date.now() + decoded.exp * 1000)
        })
      })
    
    const revoke = (token: AccessToken | RefreshToken) =>
      Effect.gen(function* () {
        const tokenStr = Brand.isNominal(token, AccessToken) 
          ? AccessToken.value(token) 
          : RefreshToken.value(token)
        
        const tokenHash = yield* Effect.promise(() => hashPassword(tokenStr))
        yield* db.run(
          `UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?`,
          [tokenHash]
        )
      })
    
    const createApiKey = (name: string, permissions: Permission[]) =>
      Effect.gen(function* () {
        const id = yield* ids.generate("key")
        const key = `sk_${yield* ids.generate("token")}`
        const keyHash = yield* Effect.promise(() => hashPassword(key))
        
        yield* db.run(
          `INSERT INTO api_keys (id, name, key_hash, permissions)
           VALUES (?, ?, ?, ?)`,
          [id, name, keyHash, JSON.stringify(permissions)]
        )
        
        const info = yield* db.get(
          `SELECT * FROM api_keys WHERE id = ?`,
          [id]
        ).pipe(
          Effect.map(Option.getOrThrow)
        )
        
        return {
          key: ApiKey(key),
          info: new ApiKeyInfo({
            id: info.id,
            name: info.name,
            description: info.description,
            permissions,
            rateLimitPerMinute: info.rate_limit_per_minute,
            rateLimitPerHour: info.rate_limit_per_hour,
            lastUsedAt: info.last_used_at ? new Date(info.last_used_at) : undefined,
            usageCount: info.usage_count,
            isActive: info.is_active,
            expiresAt: info.expires_at ? new Date(info.expires_at) : undefined,
            createdAt: new Date(info.created_at)
          })
        }
      })
    
    const verifyApiKey = (key: ApiKey) =>
      Effect.gen(function* () {
        const keyHash = yield* Effect.promise(() => hashPassword(ApiKey.value(key)))
        
        const apiKey = yield* db.get(
          `SELECT * FROM api_keys 
           WHERE key_hash = ? AND is_active = 1 
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
          [keyHash]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new InvalidCredentialsError({ message: "Invalid API key" })),
            onSome: Effect.succeed
          }))
        )
        
        // Update usage
        yield* db.run(
          `UPDATE api_keys 
           SET last_used_at = CURRENT_TIMESTAMP, usage_count = usage_count + 1 
           WHERE id = ?`,
          [apiKey.id]
        )
        
        return new AuthContext({
          userId: apiKey.id,
          userType: "api" as const,
          permissions: JSON.parse(apiKey.permissions),
          tokenId: apiKey.id,
          expiresAt: apiKey.expires_at ? new Date(apiKey.expires_at) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        })
      })
    
    return {
      login,
      refresh,
      verify,
      revoke,
      createApiKey,
      verifyApiKey
    }
  })
)

// Middleware
export const requireAuth = (requiredPermissions: Permission[] = []) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const auth = yield* AuthContext
      
      // Check permissions
      const hasPermissions = requiredPermissions.every(p => 
        auth.permissions.includes(p)
      )
      
      if (!hasPermissions) {
        yield* Effect.fail(new InsufficientPermissionsError({
          required: requiredPermissions,
          actual: auth.permissions
        }))
      }
      
      return yield* self
    })

export const optionalAuth = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.matchEffect(AuthContext, {
    onFailure: () => self,
    onSuccess: () => self
  })
```

## API Definition

### File: `apps/backend/src/api/auth.ts`
```typescript
import { Schema } from "@effect/schema"
import { Effect, pipe } from "effect"
import { Api, ApiGroup, Handler } from "effect-http"
import { AuthService, requireAuth } from "../services/auth"
import { 
  LoginRequest, 
  TokenResponse, 
  AdminUser,
  ApiKeyInfo
} from "@/packages/api/src/auth/schemas"

export const authApi = pipe(
  ApiGroup.make("auth"),
  ApiGroup.addEndpoint(
    Api.post("login", "/auth/login").pipe(
      Api.setRequestBody(LoginRequest),
      Api.setResponseBody(TokenResponse)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("adminLogin", "/auth/admin/login").pipe(
      Api.setRequestBody(LoginRequest),
      Api.setResponseBody(TokenResponse)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("refresh", "/auth/refresh").pipe(
      Api.setRequestBody(Schema.Struct({
        refreshToken: Schema.String
      })),
      Api.setResponseBody(TokenResponse)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("logout", "/auth/logout").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("me", "/auth/me").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setResponseBody(Schema.Union(
        Schema.Struct({
          type: Schema.Literal("customer"),
          customer: CustomerSchema
        }),
        Schema.Struct({
          type: Schema.Literal("admin"),
          admin: AdminUser
        })
      ))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("createApiKey", "/auth/api-keys").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        name: Schema.String,
        permissions: Schema.Array(Permission)
      })),
      Api.setResponseBody(Schema.Struct({
        key: Schema.String,
        info: ApiKeyInfo
      }))
    )
  )
)
```

## API Implementation

### File: `apps/backend/src/api/auth/handlers.ts`
```typescript
import { Effect } from "effect"
import { Handler } from "effect-http"
import { AuthService, AuthContext } from "../../services/auth"
import { AccessToken, RefreshToken } from "@/packages/api/src/auth/schemas"

export const loginHandler = Handler.make(
  authApi.endpoints.login,
  ({ body }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      return yield* auth.login(body, "customer")
    })
)

export const adminLoginHandler = Handler.make(
  authApi.endpoints.adminLogin,
  ({ body }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      return yield* auth.login(body, "admin")
    })
)

export const refreshHandler = Handler.make(
  authApi.endpoints.refresh,
  ({ body }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      return yield* auth.refresh(RefreshToken(body.refreshToken))
    })
)

export const logoutHandler = Handler.make(
  authApi.endpoints.logout,
  ({ headers }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = headers.authorization.replace("Bearer ", "")
      yield* auth.revoke(AccessToken(token))
      return { success: true }
    })
)

export const meHandler = Handler.make(
  authApi.endpoints.me,
  ({ headers }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = AccessToken(headers.authorization.replace("Bearer ", ""))
      const context = yield* auth.verify(token)
      
      // Load user data based on type
      if (context.userType === "customer") {
        // Load customer data
        const customer = yield* CustomerService.get(CustomerId(context.userId))
        return { type: "customer" as const, customer }
      } else {
        // Load admin data
        const admin = yield* AdminService.get(context.userId)
        return { type: "admin" as const, admin }
      }
    })
)

export const createApiKeyHandler = Handler.make(
  authApi.endpoints.createApiKey,
  ({ headers, body }) =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = AccessToken(headers.authorization.replace("Bearer ", ""))
      const context = yield* auth.verify(token)
      
      // Only admins can create API keys
      if (context.userType !== "admin") {
        yield* Effect.fail(new InsufficientPermissionsError({
          required: ["admin:write"],
          actual: context.permissions
        }))
      }
      
      return yield* auth.createApiKey(body.name, body.permissions)
    })
)

export const authHandlers = Handler.group(
  loginHandler,
  adminLoginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  createApiKeyHandler
)
```

## Auth Middleware

### File: `apps/backend/src/middleware/auth.ts`
```typescript
import { HttpMiddleware, HttpServerRequest } from "@effect/platform"
import { Effect, Layer, Option } from "effect"
import { AuthService, AuthContext } from "../services/auth"
import { AccessToken, ApiKey } from "@/packages/api/src/auth/schemas"

export const authMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const authHeader = yield* request.headers.get("authorization")
    
    if (Option.isNone(authHeader)) {
      // Check for API key
      const apiKeyHeader = yield* request.headers.get("x-api-key")
      if (Option.isSome(apiKeyHeader)) {
        const auth = yield* AuthService
        const context = yield* auth.verifyApiKey(ApiKey(apiKeyHeader.value))
        return yield* app.pipe(
          Effect.provideService(AuthContext, context)
        )
      }
      
      // No auth provided
      return yield* app
    }
    
    // Bearer token auth
    const token = authHeader.value.replace("Bearer ", "")
    const auth = yield* AuthService
    const context = yield* auth.verify(AccessToken(token))
    
    return yield* app.pipe(
      Effect.provideService(AuthContext, context)
    )
  }).pipe(
    Effect.catchAll(() => app) // Continue without auth on error
  )
)
```

## Tests

### File: `apps/backend/src/services/auth.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { AuthService, AuthServiceLive, AuthConfig } from "./auth"
import { TestDatabase } from "../../test/helpers"

const TestAuthConfig = Layer.succeed(AuthConfig, {
  jwtSecret: "test-secret",
  accessTokenTTL: 3600,
  refreshTokenTTL: 86400,
  bcryptRounds: 10
})

const testLayer = Layer.mergeAll(
  TestDatabase,
  TestAuthConfig,
  AuthServiceLive
)

describe("AuthService", () => {
  it("should login customer with valid credentials", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      
      // Create test customer
      yield* TestDatabase.run(
        `INSERT INTO customers (id, email, password_hash) 
         VALUES ('c1', 'test@example.com', '$2b$10$...')` // bcrypt hash
      )
      
      const result = yield* auth.login(
        new LoginRequest({
          email: "test@example.com",
          password: "password123"
        }),
        "customer"
      )
      
      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.tokenType).toBe("Bearer")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should verify valid access token", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      
      const tokens = yield* auth.login(
        new LoginRequest({
          email: "test@example.com",
          password: "password123"
        }),
        "customer"
      )
      
      const context = yield* auth.verify(AccessToken(tokens.accessToken))
      
      expect(context.userId).toBe("c1")
      expect(context.userType).toBe("customer")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should refresh tokens", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      
      const tokens = yield* auth.login(
        new LoginRequest({
          email: "test@example.com",
          password: "password123"
        }),
        "customer"
      )
      
      const newTokens = yield* auth.refresh(RefreshToken(tokens.refreshToken))
      
      expect(newTokens.accessToken).not.toBe(tokens.accessToken)
      expect(newTokens.refreshToken).not.toBe(tokens.refreshToken)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/db/migrations/008_authentication.sql`
```sql
-- Auth tokens table
CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  token_type TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME,
  revoked_at DATETIME,
  revoked_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret TEXT,
  last_login_at DATETIME,
  password_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL,
  rate_limit_per_minute INTEGER DEFAULT 60,
  rate_limit_per_hour INTEGER DEFAULT 1000,
  last_used_at DATETIME,
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_auth_tokens_token_hash ON auth_tokens(token_hash);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id, user_type);
CREATE INDEX idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- Seed super admin
INSERT INTO admin_users (
  id, 
  email, 
  password_hash, 
  first_name, 
  last_name, 
  role, 
  permissions
) VALUES (
  'admin_1',
  'admin@example.com',
  '$2b$10$YourHashHere', -- password: admin123
  'Super',
  'Admin',
  'super_admin',
  '["admin:read","admin:write","products:read","products:write","customers:read","customers:write","orders:manage","settings:read","settings:write"]'
);
```

## Next Steps

1. Implement OAuth providers (Google, GitHub, etc.)
2. Add two-factor authentication
3. Implement password reset flow
4. Add rate limiting per token
5. Add JWT blacklist for immediate revocation
6. Implement permission inheritance
7. Add audit logging for auth events
8. Implement session management UI

This authentication system provides:
- JWT-based authentication with refresh tokens
- Multi-user type support (customers, admins, API)
- Fine-grained permissions
- API key management
- Token revocation
- Middleware for protecting routes
- Extensible for OAuth and 2FA