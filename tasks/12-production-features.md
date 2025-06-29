# Task 12: Production Features

## Overview
Implement production-ready features including health checks, monitoring, rate limiting, error tracking, caching, and deployment configurations. This ensures the application is robust, observable, and scalable in production.

## Health Checks

### File: `apps/backend/src/services/health.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { Database } from "./database"
import { Cache } from "./cache"

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy"
  version: string
  uptime: number
  timestamp: string
  checks: {
    database: ComponentHealth
    cache: ComponentHealth
    storage: ComponentHealth
    external: Record<string, ComponentHealth>
  }
}

export interface ComponentHealth {
  status: "up" | "down"
  latency?: number
  error?: string
  metadata?: Record<string, unknown>
}

export class HealthService extends Context.Tag("HealthService")<
  HealthService,
  {
    readonly check: () => Effect.Effect<HealthStatus>
    readonly checkComponent: (name: string) => Effect.Effect<ComponentHealth>
  }
>() {}

export const HealthServiceLive = Layer.effect(
  HealthService,
  Effect.gen(function* () {
    const startTime = Date.now()
    
    const checkDatabase = () =>
      Effect.gen(function* () {
        const db = yield* Database
        const start = Date.now()
        
        const result = yield* Effect.either(
          db.get("SELECT 1 as health")
        )
        
        return result._tag === "Right"
          ? {
              status: "up" as const,
              latency: Date.now() - start
            }
          : {
              status: "down" as const,
              error: String(result.left)
            }
      })
    
    const checkCache = () =>
      Effect.gen(function* () {
        const cache = yield* Cache
        const start = Date.now()
        const testKey = "health:check"
        
        const result = yield* Effect.either(
          Effect.all([
            cache.set(testKey, "ok", 60),
            cache.get(testKey),
            cache.delete(testKey)
          ])
        )
        
        return result._tag === "Right"
          ? {
              status: "up" as const,
              latency: Date.now() - start
            }
          : {
              status: "down" as const,
              error: String(result.left)
            }
      })
    
    const checkStorage = () =>
      Effect.gen(function* () {
        const start = Date.now()
        const testFile = "/tmp/health-check.txt"
        
        const result = yield* Effect.either(
          Effect.all([
            Effect.promise(() => 
              import("fs/promises").then(fs => 
                fs.writeFile(testFile, "health check")
              )
            ),
            Effect.promise(() =>
              import("fs/promises").then(fs =>
                fs.unlink(testFile)
              )
            )
          ])
        )
        
        return result._tag === "Right"
          ? {
              status: "up" as const,
              latency: Date.now() - start
            }
          : {
              status: "down" as const,
              error: String(result.left)
            }
      })
    
    const check = () =>
      Effect.gen(function* () {
        const checks = yield* Effect.all({
          database: checkDatabase(),
          cache: checkCache(),
          storage: checkStorage()
        })
        
        const allHealthy = Object.values(checks).every(
          check => check.status === "up"
        )
        
        const anyDown = Object.values(checks).some(
          check => check.status === "down"
        )
        
        return {
          status: anyDown 
            ? "unhealthy" as const 
            : allHealthy 
              ? "healthy" as const 
              : "degraded" as const,
          version: process.env.APP_VERSION || "unknown",
          uptime: Math.floor((Date.now() - startTime) / 1000),
          timestamp: new Date().toISOString(),
          checks: {
            ...checks,
            external: {}
          }
        }
      })
    
    return {
      check,
      checkComponent: (name) => {
        switch (name) {
          case "database": return checkDatabase()
          case "cache": return checkCache()
          case "storage": return checkStorage()
          default: return Effect.fail(new Error(`Unknown component: ${name}`))
        }
      }
    }
  })
)
```

## Monitoring & Observability

### File: `apps/backend/src/services/monitoring.ts`
```typescript
import { Context, Effect, Layer, Metric, MetricBoundaries } from "effect"
import { NodeSdk } from "@opentelemetry/sdk-node"
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus"
import { Resource } from "@opentelemetry/resources"
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions"

// Metrics
export const httpRequestDuration = Metric.histogram(
  "http_request_duration_ms",
  MetricBoundaries.linear({ start: 0, width: 10, count: 20 })
)

export const httpRequestTotal = Metric.counter("http_request_total")

export const dbQueryDuration = Metric.histogram(
  "db_query_duration_ms",
  MetricBoundaries.exponential({ start: 1, factor: 2, count: 10 })
)

export const cacheHitRate = Metric.counter("cache_hit_total")
export const cacheMissRate = Metric.counter("cache_miss_total")

export const orderTotal = Metric.counter("order_total")
export const orderValue = Metric.histogram(
  "order_value",
  MetricBoundaries.linear({ start: 0, width: 50, count: 20 })
)

export const inventoryLevel = Metric.gauge("inventory_level")

// Custom metrics service
export class MetricsService extends Context.Tag("MetricsService")<
  MetricsService,
  {
    readonly recordHttpRequest: (method: string, path: string, status: number, duration: number) => Effect.Effect<void>
    readonly recordDbQuery: (operation: string, table: string, duration: number) => Effect.Effect<void>
    readonly recordCacheOperation: (operation: "hit" | "miss", key: string) => Effect.Effect<void>
    readonly recordOrder: (amount: number, items: number) => Effect.Effect<void>
    readonly setInventoryLevel: (productId: string, level: number) => Effect.Effect<void>
    readonly getMetrics: () => Effect.Effect<string>
  }
>() {}

export const MetricsServiceLive = Layer.effect(
  MetricsService,
  Effect.gen(function* () {
    // Initialize OpenTelemetry
    const sdk = new NodeSdk({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: "ecommerce-backend",
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || "1.0.0"
      }),
      instrumentations: [
        // Auto-instrumentation for HTTP, DB, etc.
      ],
      traceExporter: new JaegerExporter({
        endpoint: process.env.JAEGER_ENDPOINT || "http://localhost:14268/api/traces"
      }),
      metricReader: new PrometheusExporter({
        port: 9090
      })
    })
    
    sdk.start()
    
    return {
      recordHttpRequest: (method, path, status, duration) =>
        Effect.all([
          Metric.increment(httpRequestTotal).pipe(
            Metric.taggedWith({
              method,
              path: normalizePath(path),
              status: String(status)
            })
          ),
          Metric.update(httpRequestDuration, duration).pipe(
            Metric.taggedWith({
              method,
              path: normalizePath(path)
            })
          )
        ]).pipe(Effect.asUnit),
      
      recordDbQuery: (operation, table, duration) =>
        Metric.update(dbQueryDuration, duration).pipe(
          Metric.taggedWith({ operation, table })
        ),
      
      recordCacheOperation: (operation, key) =>
        operation === "hit"
          ? Metric.increment(cacheHitRate).pipe(
              Metric.taggedWith({ key: normalizeKey(key) })
            )
          : Metric.increment(cacheMissRate).pipe(
              Metric.taggedWith({ key: normalizeKey(key) })
            ),
      
      recordOrder: (amount, items) =>
        Effect.all([
          Metric.increment(orderTotal),
          Metric.update(orderValue, amount).pipe(
            Metric.taggedWith({ items: String(items) })
          )
        ]).pipe(Effect.asUnit),
      
      setInventoryLevel: (productId, level) =>
        Metric.set(inventoryLevel, level).pipe(
          Metric.taggedWith({ product_id: productId })
        ),
      
      getMetrics: () =>
        Effect.sync(() => {
          // Return Prometheus formatted metrics
          return register.metrics()
        })
    }
  })
)

// Monitoring middleware
export const monitoringMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const start = Date.now()
    const request = yield* HttpServerRequest.HttpServerRequest
    const metrics = yield* MetricsService
    
    const response = yield* app
    
    // Record metrics
    yield* metrics.recordHttpRequest(
      request.method,
      request.url.pathname,
      response.status,
      Date.now() - start
    )
    
    return response
  })
)
```

## Rate Limiting

### File: `apps/backend/src/services/rate-limit.ts`
```typescript
import { Context, Effect, Layer, Duration } from "effect"
import { Cache } from "./cache"

export class RateLimitExceededError extends Schema.TaggedError<RateLimitExceededError>()(
  "RateLimitExceededError",
  {
    limit: Schema.Number,
    window: Schema.String,
    retryAfter: Schema.Number
  }
) {}

export interface RateLimitConfig {
  points: number          // Number of requests
  duration: Duration.Duration  // Time window
  blockDuration?: Duration.Duration  // How long to block after limit exceeded
  keyPrefix?: string
}

export class RateLimiter extends Context.Tag("RateLimiter")<
  RateLimiter,
  {
    readonly consume: (key: string, points?: number) => Effect.Effect<void, RateLimitExceededError>
    readonly reset: (key: string) => Effect.Effect<void>
    readonly getStatus: (key: string) => Effect.Effect<{ remaining: number; reset: Date }>
  }
>() {}

export const RateLimiterLive = (config: RateLimitConfig) =>
  Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const cache = yield* Cache
      const prefix = config.keyPrefix || "rate_limit"
      
      const getKey = (key: string) => `${prefix}:${key}`
      const getBlockKey = (key: string) => `${prefix}:block:${key}`
      
      const consume = (key: string, points: number = 1) =>
        Effect.gen(function* () {
          const cacheKey = getKey(key)
          const blockKey = getBlockKey(key)
          
          // Check if blocked
          const blocked = yield* cache.get(blockKey)
          if (blocked) {
            yield* Effect.fail(new RateLimitExceededError({
              limit: config.points,
              window: Duration.toHuman(config.duration),
              retryAfter: parseInt(blocked)
            }))
          }
          
          // Get current count
          const current = yield* cache.get(cacheKey).pipe(
            Effect.map(v => v ? parseInt(v) : 0)
          )
          
          if (current + points > config.points) {
            // Set block if configured
            if (config.blockDuration) {
              const blockSeconds = Duration.toSeconds(config.blockDuration)
              yield* cache.set(
                blockKey,
                String(Date.now() + blockSeconds * 1000),
                blockSeconds
              )
            }
            
            yield* Effect.fail(new RateLimitExceededError({
              limit: config.points,
              window: Duration.toHuman(config.duration),
              retryAfter: Duration.toSeconds(config.blockDuration || config.duration)
            }))
          }
          
          // Increment counter
          const ttl = Duration.toSeconds(config.duration)
          if (current === 0) {
            yield* cache.set(cacheKey, String(points), ttl)
          } else {
            yield* cache.increment(cacheKey, points)
          }
        })
      
      const reset = (key: string) =>
        Effect.all([
          cache.delete(getKey(key)),
          cache.delete(getBlockKey(key))
        ]).pipe(Effect.asUnit)
      
      const getStatus = (key: string) =>
        Effect.gen(function* () {
          const current = yield* cache.get(getKey(key)).pipe(
            Effect.map(v => v ? parseInt(v) : 0)
          )
          
          const ttl = yield* cache.ttl(getKey(key))
          
          return {
            remaining: Math.max(0, config.points - current),
            reset: new Date(Date.now() + ttl * 1000)
          }
        })
      
      return { consume, reset, getStatus }
    })
  )

// Rate limit configurations
export const rateLimitConfigs = {
  api: {
    points: 100,
    duration: Duration.minutes(1),
    blockDuration: Duration.minutes(5)
  },
  auth: {
    points: 5,
    duration: Duration.minutes(15),
    blockDuration: Duration.hours(1)
  },
  checkout: {
    points: 10,
    duration: Duration.minutes(10),
    blockDuration: Duration.minutes(30)
  },
  admin: {
    points: 1000,
    duration: Duration.minutes(1)
  }
}

// Rate limiting middleware
export const rateLimitMiddleware = (config: RateLimitConfig) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const limiter = yield* RateLimiter
      
      // Get rate limit key (IP address or user ID)
      const key = yield* getRateLimitKey(request)
      
      // Check rate limit
      yield* limiter.consume(key).pipe(
        Effect.catchTag("RateLimitExceededError", error =>
          HttpServerResponse.text("Rate limit exceeded", {
            status: 429,
            headers: {
              "Retry-After": String(error.retryAfter),
              "X-RateLimit-Limit": String(config.points),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": new Date(
                Date.now() + error.retryAfter * 1000
              ).toISOString()
            }
          })
        )
      )
      
      // Add rate limit headers to response
      const status = yield* limiter.getStatus(key)
      
      return yield* app.pipe(
        HttpServerResponse.setHeaders({
          "X-RateLimit-Limit": String(config.points),
          "X-RateLimit-Remaining": String(status.remaining),
          "X-RateLimit-Reset": status.reset.toISOString()
        })
      )
    })
  )
```

## Error Tracking

### File: `apps/backend/src/services/error-tracking.ts`
```typescript
import { Context, Effect, Layer, Cause } from "effect"
import * as Sentry from "@sentry/node"

export interface ErrorContext {
  userId?: string
  orderId?: string
  productId?: string
  requestId?: string
  extra?: Record<string, unknown>
}

export class ErrorTracker extends Context.Tag("ErrorTracker")<
  ErrorTracker,
  {
    readonly captureError: (error: unknown, context?: ErrorContext) => Effect.Effect<void>
    readonly captureMessage: (message: string, level: "info" | "warning" | "error") => Effect.Effect<void>
    readonly setUser: (user: { id: string; email?: string }) => Effect.Effect<void>
    readonly addBreadcrumb: (breadcrumb: Sentry.Breadcrumb) => Effect.Effect<void>
  }
>() {}

export const ErrorTrackerLive = Layer.effect(
  ErrorTracker,
  Effect.gen(function* () {
    // Initialize Sentry
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      release: process.env.APP_VERSION,
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Postgres(),
        new ProfilingIntegration()
      ],
      beforeSend: (event, hint) => {
        // Filter out expected errors
        if (hint.originalException?.name === "ValidationError") {
          return null
        }
        
        // Sanitize sensitive data
        if (event.request?.data) {
          delete event.request.data.password
          delete event.request.data.creditCard
        }
        
        return event
      }
    })
    
    const captureError = (error: unknown, context?: ErrorContext) =>
      Effect.sync(() => {
        Sentry.withScope(scope => {
          if (context) {
            scope.setContext("error", context)
            if (context.userId) scope.setUser({ id: context.userId })
            if (context.extra) {
              Object.entries(context.extra).forEach(([key, value]) => {
                scope.setExtra(key, value)
              })
            }
          }
          
          // Handle Effect errors
          if (Cause.isFailure(error)) {
            const defects = Cause.defects(error)
            const failures = Cause.failures(error)
            
            failures.forEach(f => Sentry.captureException(f))
            defects.forEach(d => Sentry.captureException(d))
          } else {
            Sentry.captureException(error)
          }
        })
      })
    
    return {
      captureError,
      captureMessage: (message, level) =>
        Effect.sync(() => {
          Sentry.captureMessage(message, level)
        }),
      setUser: (user) =>
        Effect.sync(() => {
          Sentry.setUser(user)
        }),
      addBreadcrumb: (breadcrumb) =>
        Effect.sync(() => {
          Sentry.addBreadcrumb(breadcrumb)
        })
    }
  })
)

// Error tracking middleware
export const errorTrackingMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const tracker = yield* ErrorTracker
    const request = yield* HttpServerRequest.HttpServerRequest
    const requestId = yield* generateRequestId()
    
    // Add breadcrumb
    yield* tracker.addBreadcrumb({
      category: "http",
      message: `${request.method} ${request.url.pathname}`,
      level: "info",
      data: {
        requestId,
        userAgent: request.headers["user-agent"]
      }
    })
    
    // Run app and capture errors
    const result = yield* Effect.either(app)
    
    if (result._tag === "Left") {
      yield* tracker.captureError(result.left, {
        requestId,
        extra: {
          method: request.method,
          path: request.url.pathname,
          query: Object.fromEntries(request.url.searchParams)
        }
      })
      
      yield* Effect.fail(result.left)
    }
    
    return result.right
  })
)
```

## Caching Strategy

### File: `apps/backend/src/services/cache.ts`
```typescript
import { Context, Effect, Layer, Duration } from "effect"
import Redis from "ioredis"

export class CacheService extends Context.Tag("CacheService")<
  CacheService,
  {
    readonly get: <T>(key: string) => Effect.Effect<T | null>
    readonly set: <T>(key: string, value: T, ttl?: number) => Effect.Effect<void>
    readonly delete: (key: string) => Effect.Effect<void>
    readonly deletePattern: (pattern: string) => Effect.Effect<number>
    readonly increment: (key: string, by?: number) => Effect.Effect<number>
    readonly ttl: (key: string) => Effect.Effect<number>
    readonly remember: <T>(key: string, ttl: number, fn: () => Effect.Effect<T>) => Effect.Effect<T>
    readonly invalidate: (tags: string[]) => Effect.Effect<void>
  }
>() {}

export const CacheServiceLive = Layer.effect(
  CacheService,
  Effect.gen(function* () {
    const redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      enableOfflineQueue: false
    })
    
    const get = <T>(key: string) =>
      Effect.tryPromise({
        try: async () => {
          const value = await redis.get(key)
          return value ? JSON.parse(value) as T : null
        },
        catch: () => new Error("Cache get failed")
      })
    
    const set = <T>(key: string, value: T, ttl?: number) =>
      Effect.tryPromise({
        try: () => 
          ttl
            ? redis.setex(key, ttl, JSON.stringify(value))
            : redis.set(key, JSON.stringify(value)),
        catch: () => new Error("Cache set failed")
      }).pipe(Effect.asUnit)
    
    const remember = <T>(key: string, ttl: number, fn: () => Effect.Effect<T>) =>
      Effect.gen(function* () {
        const cached = yield* get<T>(key)
        if (cached !== null) return cached
        
        const value = yield* fn()
        yield* set(key, value, ttl)
        return value
      })
    
    const invalidate = (tags: string[]) =>
      Effect.gen(function* () {
        const pipeline = redis.pipeline()
        
        for (const tag of tags) {
          const keys = yield* Effect.tryPromise(() => 
            redis.keys(`*:${tag}:*`)
          )
          
          keys.forEach(key => pipeline.del(key))
        }
        
        yield* Effect.tryPromise(() => pipeline.exec())
      })
    
    return {
      get,
      set,
      delete: (key) =>
        Effect.tryPromise(() => redis.del(key)).pipe(Effect.asUnit),
      deletePattern: (pattern) =>
        Effect.gen(function* () {
          const keys = yield* Effect.tryPromise(() => redis.keys(pattern))
          if (keys.length === 0) return 0
          
          return yield* Effect.tryPromise(() => redis.del(...keys))
        }),
      increment: (key, by = 1) =>
        Effect.tryPromise(() => redis.incrby(key, by)),
      ttl: (key) =>
        Effect.tryPromise(() => redis.ttl(key)),
      remember,
      invalidate
    }
  })
)

// Cache decorators
export const cached = (
  keyFn: (...args: any[]) => string,
  ttl: Duration.Duration,
  tags?: string[]
) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const cache = yield* CacheService
    const key = keyFn(...arguments)
    const taggedKey = tags ? `${key}:${tags.join(":")}` : key
    
    return yield* cache.remember(
      taggedKey,
      Duration.toSeconds(ttl),
      () => self
    )
  })

export const invalidateCache = (tags: string[]) =>
  Effect.gen(function* () {
    const cache = yield* CacheService
    yield* cache.invalidate(tags)
  })

// Common cache keys
export const CacheKeys = {
  product: (id: string) => `product:${id}`,
  productList: (filters: string) => `products:list:${filters}`,
  category: (id: string) => `category:${id}`,
  cart: (id: string) => `cart:${id}`,
  customer: (id: string) => `customer:${id}`,
  order: (id: string) => `order:${id}`,
  session: (id: string) => `session:${id}`,
  inventory: (productId: string, variantId: string) => 
    `inventory:${productId}:${variantId}`
}
```

## Security Headers

### File: `apps/backend/src/middleware/security.ts`
```typescript
export const securityMiddleware = HttpMiddleware.make((app) =>
  app.pipe(
    HttpServerResponse.setHeaders({
      // Security headers
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      
      // HSTS
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      
      // CSP
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'"
      ].join("; ")
    })
  )
)

// CORS middleware
export const corsMiddleware = (options: {
  origin: string | string[] | ((origin: string) => boolean)
  credentials?: boolean
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  maxAge?: number
}) => HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const origin = request.headers.origin || ""
    
    const isAllowed = Array.isArray(options.origin)
      ? options.origin.includes(origin)
      : typeof options.origin === "function"
        ? options.origin(origin)
        : options.origin === origin || options.origin === "*"
    
    if (!isAllowed) return yield* app
    
    return yield* app.pipe(
      HttpServerResponse.setHeaders({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": String(options.credentials || false),
        "Access-Control-Allow-Methods": (options.methods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(", "),
        "Access-Control-Allow-Headers": (options.allowedHeaders || ["Content-Type", "Authorization"]).join(", "),
        "Access-Control-Expose-Headers": (options.exposedHeaders || []).join(", "),
        "Access-Control-Max-Age": String(options.maxAge || 86400)
      })
    )
  })
)
```

## Deployment Configuration

### File: `Dockerfile`
```dockerfile
# Build stage
FROM oven/bun:1 as builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/*/package.json ./packages/*/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun run build

# Production stage
FROM oven/bun:1-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json bun.lockb ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/*/package.json ./packages/*/

RUN bun install --frozen-lockfile --production

# Copy built application
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/*/dist ./packages/*/dist

# Copy migrations
COPY apps/backend/src/db/migrations ./apps/backend/src/db/migrations

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["bun", "run", "apps/backend/dist/index.js"]
```

### File: `docker-compose.yml`
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://user:pass@postgres:5432/ecommerce
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      SENTRY_DSN: ${SENTRY_DSN}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: ecommerce
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    volumes:
      - grafana_data:/var/lib/grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:
```

### File: `.github/workflows/deploy.yml`
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Login to Amazon ECR
        uses: aws-actions/amazon-ecr-login@v2
      
      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: ecommerce-backend
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
      
      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster production \
            --service ecommerce-backend \
            --force-new-deployment
```

## Environment Configuration

### File: `apps/backend/src/config/index.ts`
```typescript
import { Config, ConfigError, ConfigProvider, Layer } from "effect"
import { Schema } from "@effect/schema"

const EnvironmentSchema = Schema.Struct({
  NODE_ENV: Schema.Literal("development", "test", "production"),
  PORT: Schema.NumberFromString.pipe(Schema.positive()),
  DATABASE_URL: Schema.String,
  REDIS_URL: Schema.String,
  JWT_SECRET: Schema.String.pipe(Schema.minLength(32)),
  SENTRY_DSN: Schema.optional(Schema.String),
  LOG_LEVEL: Schema.optional(Schema.Literal("debug", "info", "warn", "error")),
  CORS_ORIGIN: Schema.optional(Schema.String),
  RATE_LIMIT_ENABLED: Schema.optional(Schema.BooleanFromString),
  CACHE_TTL: Schema.optional(Schema.NumberFromString)
})

export type Environment = Schema.Schema.Type<typeof EnvironmentSchema>

export const AppConfig = Layer.effect(
  Context.Tag<Environment>(),
  Effect.gen(function* () {
    const config = yield* Config.all({
      NODE_ENV: Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      ),
      PORT: Config.number("PORT").pipe(
        Config.withDefault(3000)
      ),
      DATABASE_URL: Config.string("DATABASE_URL"),
      REDIS_URL: Config.string("REDIS_URL").pipe(
        Config.withDefault("redis://localhost:6379")
      ),
      JWT_SECRET: Config.secret("JWT_SECRET"),
      SENTRY_DSN: Config.string("SENTRY_DSN").pipe(
        Config.optional
      ),
      LOG_LEVEL: Config.string("LOG_LEVEL").pipe(
        Config.withDefault("info"),
        Config.optional
      ),
      CORS_ORIGIN: Config.string("CORS_ORIGIN").pipe(
        Config.optional
      ),
      RATE_LIMIT_ENABLED: Config.boolean("RATE_LIMIT_ENABLED").pipe(
        Config.withDefault(true),
        Config.optional
      ),
      CACHE_TTL: Config.number("CACHE_TTL").pipe(
        Config.withDefault(300),
        Config.optional
      )
    })
    
    return yield* Schema.decodeUnknown(EnvironmentSchema)(config)
  })
)
```

## Graceful Shutdown

### File: `apps/backend/src/index.ts`
```typescript
import { Effect, Layer, Runtime, Fiber, FiberRef } from "effect"
import { NodeRuntime } from "@effect/platform-node"

const program = Effect.gen(function* () {
  const server = yield* HttpServer
  const health = yield* HealthService
  
  // Start server
  const fiber = yield* Effect.forkDaemon(
    server.listen({ port: 3000 })
  )
  
  // Setup graceful shutdown
  const shutdown = Effect.gen(function* () {
    console.log("Shutting down gracefully...")
    
    // Stop accepting new requests
    yield* server.shutdown()
    
    // Wait for ongoing requests to complete (max 30s)
    yield* Effect.sleep(Duration.seconds(30))
    
    // Close database connections
    yield* Database.close()
    
    // Close cache connections
    yield* Cache.close()
    
    // Flush monitoring data
    yield* MetricsService.flush()
    
    console.log("Shutdown complete")
  })
  
  // Handle signals
  process.on("SIGTERM", () => {
    Runtime.runPromise(Runtime.defaultRuntime)(shutdown)
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
  
  process.on("SIGINT", () => {
    Runtime.runPromise(Runtime.defaultRuntime)(shutdown)
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
  
  // Keep alive
  yield* Fiber.join(fiber)
})

// Run application
NodeRuntime.runMain(
  program.pipe(
    Effect.provide(AppLayer)
  )
)
```

## Next Steps

1. Implement distributed tracing
2. Add request/response logging
3. Create backup and restore procedures
4. Implement feature flags
5. Add A/B testing framework
6. Create performance profiling
7. Implement circuit breakers
8. Add webhook retry mechanism

This production features implementation provides:
- Comprehensive health checks
- Metrics and monitoring
- Rate limiting
- Error tracking
- Caching strategy
- Security headers
- Deployment configuration
- Graceful shutdown
- Environment management