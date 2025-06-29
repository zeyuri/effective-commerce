# Task 02: Session Management

## Overview
Implement session management for anonymous users. This enables cart persistence and user tracking without requiring authentication.

## Database Schema

```sql
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  fingerprint TEXT,
  user_agent TEXT,
  ip_address TEXT,
  customer_id TEXT,
  metadata TEXT, -- JSON data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- Session events for analytics
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- page_view, add_to_cart, checkout_started, etc.
  event_data TEXT, -- JSON data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);
CREATE INDEX idx_session_events_session_id ON session_events(session_id);
```

## Effect Schemas

### File: `packages/api/src/session/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { SessionId, SessionIdSchema, CustomerId, CustomerIdSchema } from "../common/id"

export class Session extends Schema.Class<Session>("Session")({
  id: SessionIdSchema,
  fingerprint: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
  ipAddress: Schema.optional(Schema.String),
  customerId: Schema.optional(CustomerIdSchema),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  lastActivityAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf
}) {}

export class CreateSessionRequest extends Schema.Class<CreateSessionRequest>("CreateSessionRequest")({
  fingerprint: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
  ipAddress: Schema.optional(Schema.String)
}) {}

export class SessionResponse extends Schema.Class<SessionResponse>("SessionResponse")({
  sessionId: SessionIdSchema,
  expiresAt: Schema.DateFromSelf,
  isNew: Schema.Boolean
}) {}

export enum SessionEventType {
  Created = "created",
  PageView = "page_view",
  ProductView = "product_view",
  AddToCart = "add_to_cart",
  RemoveFromCart = "remove_from_cart",
  CheckoutStarted = "checkout_started",
  CheckoutCompleted = "checkout_completed",
  CustomerLinked = "customer_linked"
}

export class SessionEvent extends Schema.Class<SessionEvent>("SessionEvent")({
  id: Schema.Number,
  sessionId: SessionIdSchema,
  eventType: Schema.Enums(SessionEventType),
  eventData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf
}) {}
```

## Session Service

### File: `apps/backend/src/services/SessionService.ts`
```typescript
import { Context, Effect, Layer, Schedule, Stream } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import { Session, CreateSessionRequest, SessionEvent, SessionEventType } from "@turbobun/api/session/schemas"
import { SessionId, CustomerId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { ConfigService } from "./ConfigService"
import { NotFoundError } from "@turbobun/api/common/errors"

export class SessionService extends Context.Tag("SessionService")<
  SessionService,
  {
    readonly create: (request: CreateSessionRequest) => Effect.Effect<Session>
    readonly get: (id: SessionId) => Effect.Effect<Session, NotFoundError>
    readonly getOrCreate: (
      id: SessionId | undefined,
      request: CreateSessionRequest
    ) => Effect.Effect<Session>
    readonly touch: (id: SessionId) => Effect.Effect<void>
    readonly linkCustomer: (id: SessionId, customerId: CustomerId) => Effect.Effect<void>
    readonly trackEvent: (
      id: SessionId,
      eventType: SessionEventType,
      data?: Record<string, unknown>
    ) => Effect.Effect<void>
    readonly cleanup: Effect.Effect<number>
  }
>() {}

export const SessionServiceLive = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    const configService = yield* ConfigService
    
    const sessionTtlDays = yield* configService.get("sessionTtlDays")
    
    const create = (request: CreateSessionRequest) =>
      Effect.gen(function* () {
        const id = yield* idService.generateSessionId
        const now = new Date()
        const expiresAt = new Date(now.getTime() + sessionTtlDays * 24 * 60 * 60 * 1000)
        
        yield* sql`
          INSERT INTO sessions (
            id, fingerprint, user_agent, ip_address, 
            metadata, created_at, last_activity_at, expires_at
          ) VALUES (
            ${id}, ${request.fingerprint || null}, ${request.userAgent || null},
            ${request.ipAddress || null}, ${JSON.stringify(request.metadata || {})},
            ${now}, ${now}, ${expiresAt}
          )
        `
        
        // Track session created event
        yield* trackEvent(id, SessionEventType.Created, {
          fingerprint: request.fingerprint,
          userAgent: request.userAgent
        })
        
        return new Session({
          id,
          fingerprint: request.fingerprint,
          userAgent: request.userAgent,
          ipAddress: request.ipAddress,
          metadata: request.metadata,
          createdAt: now,
          lastActivityAt: now,
          expiresAt
        })
      })
    
    const get = (id: SessionId) =>
      sql`
        SELECT * FROM sessions 
        WHERE id = ${id} AND expires_at > datetime('now')
      `.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Session({
                ...rows[0],
                metadata: JSON.parse(rows[0].metadata || "{}"),
                createdAt: new Date(rows[0].created_at),
                lastActivityAt: new Date(rows[0].last_activity_at),
                expiresAt: new Date(rows[0].expires_at)
              }))
            : Effect.fail(new NotFoundError({ resource: "Session", id }))
        )
      )
    
    const getOrCreate = (id: SessionId | undefined, request: CreateSessionRequest) =>
      Effect.gen(function* () {
        if (id) {
          const existing = yield* get(id).pipe(
            Effect.catchTag("NotFoundError", () => create(request))
          )
          
          // Touch the session to update last activity
          yield* touch(existing.id)
          
          return existing
        }
        
        return yield* create(request)
      })
    
    const touch = (id: SessionId) =>
      Effect.gen(function* () {
        const now = new Date()
        const expiresAt = new Date(now.getTime() + sessionTtlDays * 24 * 60 * 60 * 1000)
        
        yield* sql`
          UPDATE sessions 
          SET 
            last_activity_at = ${now},
            expires_at = ${expiresAt}
          WHERE id = ${id}
        `
      })
    
    const linkCustomer = (id: SessionId, customerId: CustomerId) =>
      Effect.gen(function* () {
        yield* sql`
          UPDATE sessions 
          SET customer_id = ${customerId}
          WHERE id = ${id}
        `
        
        yield* trackEvent(id, SessionEventType.CustomerLinked, { customerId })
      })
    
    const trackEvent = (
      id: SessionId,
      eventType: SessionEventType,
      data?: Record<string, unknown>
    ) =>
      sql`
        INSERT INTO session_events (session_id, event_type, event_data)
        VALUES (${id}, ${eventType}, ${JSON.stringify(data || {})})
      `.pipe(Effect.asUnit)
    
    const cleanup = sql`
      DELETE FROM sessions 
      WHERE expires_at < datetime('now')
    `.pipe(
      Effect.map(result => result.rowsAffected)
    )
    
    return SessionService.of({
      create,
      get,
      getOrCreate,
      touch,
      linkCustomer,
      trackEvent,
      cleanup
    })
  })
)

// Background cleanup task
export const SessionCleanupLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessionService = yield* SessionService
    
    // Run cleanup every hour
    yield* sessionService.cleanup.pipe(
      Effect.tap(count =>
        Effect.log(`Cleaned up ${count} expired sessions`)
      ),
      Effect.repeat(Schedule.fixed("1 hour")),
      Effect.forkDaemon
    )
  })
)
```

## Session Middleware

### File: `apps/backend/src/http/middleware/session.ts`
```typescript
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Layer, Context } from "effect"
import * as Cookie from "@effect/platform/Cookies"
import { SessionService } from "../../services/SessionService"
import { Session } from "@turbobun/api/session/schemas"
import { SessionId } from "@turbobun/api/common/id"

export class SessionContext extends Context.Tag("SessionContext")<
  SessionContext,
  Session
>() {}

const SESSION_COOKIE_NAME = "session_id"

export const sessionMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const sessionService = yield* SessionService
    
    // Extract session ID from cookie
    const cookies = yield* HttpServerRequest.cookiesUnsigned
    const sessionId = cookies[SESSION_COOKIE_NAME]?.value as SessionId | undefined
    
    // Get request details for fingerprinting
    const headers = request.headers
    const userAgent = headers["user-agent"]?.[0]
    const ipAddress = headers["x-forwarded-for"]?.[0]?.split(",")[0] || 
                     headers["x-real-ip"]?.[0] ||
                     "unknown"
    
    // Simple fingerprinting (can be enhanced)
    const fingerprint = yield* Effect.sync(() => {
      const data = [
        userAgent,
        headers["accept-language"]?.[0],
        headers["accept-encoding"]?.[0]
      ].filter(Boolean).join("|")
      
      return Buffer.from(data).toString("base64").substring(0, 16)
    })
    
    // Get or create session
    const session = yield* sessionService.getOrCreate(sessionId, {
      fingerprint,
      userAgent,
      ipAddress
    })
    
    // Set session in context
    const appWithSession = yield* app.pipe(
      Effect.provideService(SessionContext, session)
    )
    
    // Set cookie if new session or refresh existing
    return yield* HttpServerResponse.setCookie(
      SESSION_COOKIE_NAME,
      session.id,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 // 30 days
      }
    ).pipe(Effect.map(() => appWithSession))
  })
)

export const SessionMiddlewareLive = Layer.effect(
  HttpMiddleware.HttpMiddleware,
  Effect.succeed(sessionMiddleware)
)
```

## Device Fingerprinting Service

### File: `apps/backend/src/services/FingerprintService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import * as Crypto from "node:crypto"

export interface FingerprintData {
  userAgent?: string
  acceptLanguage?: string
  acceptEncoding?: string
  screenResolution?: string
  timezone?: string
  platform?: string
}

export class FingerprintService extends Context.Tag("FingerprintService")<
  FingerprintService,
  {
    readonly generate: (data: FingerprintData) => Effect.Effect<string>
    readonly compare: (fp1: string, fp2: string) => Effect.Effect<number> // similarity score 0-1
  }
>() {}

export const FingerprintServiceLive = Layer.succeed(
  FingerprintService,
  FingerprintService.of({
    generate: (data) =>
      Effect.sync(() => {
        const normalized = [
          data.userAgent?.toLowerCase(),
          data.acceptLanguage,
          data.acceptEncoding,
          data.screenResolution,
          data.timezone,
          data.platform
        ].filter(Boolean).join("|")
        
        return Crypto
          .createHash("sha256")
          .update(normalized)
          .digest("base64")
          .substring(0, 22) // URL-safe base64
      }),
    
    compare: (fp1, fp2) =>
      Effect.sync(() => {
        if (fp1 === fp2) return 1
        
        // Simple similarity based on common prefix length
        let commonLength = 0
        for (let i = 0; i < Math.min(fp1.length, fp2.length); i++) {
          if (fp1[i] === fp2[i]) commonLength++
          else break
        }
        
        return commonLength / Math.max(fp1.length, fp2.length)
      })
  })
)
```

## Session API Endpoints

### File: `packages/api/src/session/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { SessionResponse } from "./schemas"

class SessionGroup extends HttpApiGroup.make("session")
  .add(
    HttpApiEndpoint.post("createSession")`/sessions/start`
      .addSuccess(SessionResponse)
  )
  .add(
    HttpApiEndpoint.get("getCurrentSession")`/sessions/current`
      .addSuccess(SessionResponse)
  ) {}

export class SessionApi extends HttpApi.make("session-api").add(SessionGroup) {}
```

### File: `apps/backend/src/http/api/session.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { SessionApi } from "@turbobun/api/session/api"
import { SessionContext } from "../middleware/session"
import { successResponse } from "../response"
import { SessionResponse } from "@turbobun/api/session/schemas"

export const SessionApiLive = HttpApiBuilder.group(
  SessionApi,
  "session",
  (handlers) =>
    handlers
      .handle("createSession", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          
          return yield* successResponse(
            new SessionResponse({
              sessionId: session.id,
              expiresAt: session.expiresAt,
              isNew: true
            })
          )
        })
      )
      .handle("getCurrentSession", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          
          return yield* successResponse(
            new SessionResponse({
              sessionId: session.id,
              expiresAt: session.expiresAt,
              isNew: false
            })
          )
        })
      )
)
```

## Session Recovery Flow

### File: `apps/backend/src/services/SessionRecoveryService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { SessionService } from "./SessionService"
import { FingerprintService } from "./FingerprintService"
import { Session } from "@turbobun/api/session/schemas"

export class SessionRecoveryService extends Context.Tag("SessionRecoveryService")<
  SessionRecoveryService,
  {
    readonly findSimilarSessions: (
      fingerprint: string,
      threshold?: number
    ) => Effect.Effect<Session[]>
    readonly recoverSession: (
      fingerprint: string,
      userAgent?: string
    ) => Effect.Effect<Session | null>
  }
>() {}

export const SessionRecoveryServiceLive = Layer.effect(
  SessionRecoveryService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const sessionService = yield* SessionService
    const fingerprintService = yield* FingerprintService
    
    const findSimilarSessions = (fingerprint: string, threshold = 0.8) =>
      Effect.gen(function* () {
        // Get recent sessions
        const recentSessions = yield* sql`
          SELECT * FROM sessions
          WHERE 
            expires_at > datetime('now')
            AND fingerprint IS NOT NULL
            AND created_at > datetime('now', '-7 days')
          ORDER BY last_activity_at DESC
          LIMIT 100
        `
        
        // Calculate similarity scores
        const withScores = yield* Effect.forEach(
          recentSessions,
          (row) =>
            fingerprintService.compare(fingerprint, row.fingerprint).pipe(
              Effect.map(score => ({ session: row, score }))
            )
        )
        
        // Filter by threshold and map to Session objects
        return withScores
          .filter(({ score }) => score >= threshold)
          .map(({ session }) => new Session({
            ...session,
            metadata: JSON.parse(session.metadata || "{}"),
            createdAt: new Date(session.created_at),
            lastActivityAt: new Date(session.last_activity_at),
            expiresAt: new Date(session.expires_at)
          }))
      })
    
    const recoverSession = (fingerprint: string, userAgent?: string) =>
      Effect.gen(function* () {
        const similar = yield* findSimilarSessions(fingerprint, 0.9)
        
        if (similar.length === 0) return null
        
        // If user agent matches, higher confidence
        const withSameUA = similar.find(s => s.userAgent === userAgent)
        if (withSameUA) return withSameUA
        
        // Otherwise return most recent
        return similar[0]
      })
    
    return SessionRecoveryService.of({
      findSimilarSessions,
      recoverSession
    })
  })
)
```

## Tests

### File: `apps/backend/src/services/__tests__/SessionService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { SessionService, SessionServiceLive } from "../SessionService"
import { IdServiceLive } from "../IdService"
import { ConfigServiceLive } from "../ConfigService"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { SessionEventType } from "@turbobun/api/session/schemas"

const TestDatabaseLive = SqliteClient.layer({
  filename: ":memory:"
})

const testLayer = Layer.mergeAll(
  TestDatabaseLive,
  IdServiceLive,
  ConfigServiceLive,
  SessionServiceLive
)

describe("SessionService", () => {
  beforeEach(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Run migrations
      yield* sql`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          fingerprint TEXT,
          user_agent TEXT,
          ip_address TEXT,
          customer_id TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL
        )
      `
      yield* sql`
        CREATE TABLE IF NOT EXISTS session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `
    }).pipe(
      Effect.provide(TestDatabaseLive),
      Effect.runPromise
    )
  )
  
  it("should create a new session", () =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService
      
      const session = yield* sessionService.create({
        fingerprint: "test-fp",
        userAgent: "Test Browser",
        ipAddress: "127.0.0.1"
      })
      
      expect(session.id).toMatch(/^ses_/)
      expect(session.fingerprint).toBe("test-fp")
      expect(session.userAgent).toBe("Test Browser")
      expect(session.ipAddress).toBe("127.0.0.1")
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should track session events", () =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService
      const sql = yield* SqlClient.SqlClient
      
      const session = yield* sessionService.create({})
      
      yield* sessionService.trackEvent(
        session.id,
        SessionEventType.AddToCart,
        { productId: "prd_123", quantity: 2 }
      )
      
      const events = yield* sql`
        SELECT * FROM session_events WHERE session_id = ${session.id}
      `
      
      expect(events).toHaveLength(2) // Created + AddToCart
      expect(events[1].event_type).toBe(SessionEventType.AddToCart)
      expect(JSON.parse(events[1].event_data)).toEqual({
        productId: "prd_123",
        quantity: 2
      })
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should clean up expired sessions", () =>
    Effect.gen(function* () {
      const sessionService = yield* SessionService
      const sql = yield* SqlClient.SqlClient
      
      // Create an expired session
      yield* sql`
        INSERT INTO sessions (id, expires_at)
        VALUES ('ses_expired', datetime('now', '-1 day'))
      `
      
      const cleaned = yield* sessionService.cleanup
      expect(cleaned).toBe(1)
      
      const remaining = yield* sql`SELECT COUNT(*) as count FROM sessions`
      expect(remaining[0].count).toBe(0)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/migrations/0002_session_management.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      fingerprint TEXT,
      user_agent TEXT,
      ip_address TEXT,
      customer_id TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `
  
  yield* sql`CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)`
  yield* sql`CREATE INDEX idx_sessions_customer_id ON sessions(customer_id)`
  yield* sql`CREATE INDEX idx_session_events_session_id ON session_events(session_id)`
})
```

## Usage Example

```typescript
// In your main server setup
const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  // Session middleware runs first
  Layer.provide(SessionMiddlewareLive),
  // Then your API handlers
  Layer.provide(SessionApiLive),
  // ... other layers
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

// In any API handler, access session via context
const handler = Effect.gen(function* () {
  const session = yield* SessionContext
  
  // Track an event
  const sessionService = yield* SessionService
  yield* sessionService.trackEvent(
    session.id,
    SessionEventType.ProductView,
    { productId: "prd_123" }
  )
  
  // ... rest of handler
})
```

## Next Steps

After completing this task:
1. Verify session cookies are set correctly
2. Test session recovery with fingerprinting
3. Ensure cleanup task runs properly
4. Move to Task 03: Product Catalog