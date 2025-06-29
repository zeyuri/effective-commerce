# Task 11: Testing Strategy

## Overview
Establish comprehensive testing strategy covering unit tests, integration tests, E2E tests, and performance tests. This ensures code quality, prevents regressions, and validates the entire e-commerce flow.

## Testing Architecture

### Test Structure
```
tests/
├── unit/              # Isolated unit tests
├── integration/       # Service integration tests
├── e2e/              # End-to-end flow tests
├── performance/      # Load and stress tests
├── fixtures/         # Test data factories
├── helpers/          # Test utilities
└── mocks/           # External service mocks
```

## Test Setup

### File: `apps/backend/test/setup.ts`
```typescript
import { Layer, Effect, Runtime, TestClock } from "effect"
import { NodeContext } from "@effect/platform-node"
import { Database } from "../src/services/database"
import { IdService } from "../src/services/id"
import { AuthConfig } from "../src/services/auth"

// Test database setup
export const TestDatabase = Layer.effect(
  Database,
  Effect.gen(function* () {
    const db = yield* Effect.promise(() => 
      import("better-sqlite3").then(m => new m.default(":memory:"))
    )
    
    // Run migrations
    const migrations = yield* Effect.promise(() =>
      import("fs").then(fs => 
        fs.readdirSync("./src/db/migrations")
          .filter(f => f.endsWith(".sql"))
          .sort()
      )
    )
    
    for (const migration of migrations) {
      const sql = yield* Effect.promise(() =>
        import("fs").then(fs => 
          fs.readFileSync(`./src/db/migrations/${migration}`, "utf-8")
        )
      )
      
      db.exec(sql)
    }
    
    return {
      get: (query: string, params?: any[]) =>
        Effect.sync(() => {
          const stmt = db.prepare(query)
          const result = params ? stmt.get(...params) : stmt.get()
          return result ? Option.some(result) : Option.none()
        }),
      
      all: (query: string, params?: any[]) =>
        Effect.sync(() => {
          const stmt = db.prepare(query)
          return params ? stmt.all(...params) : stmt.all()
        }),
      
      run: (query: string, params?: any[]) =>
        Effect.sync(() => {
          const stmt = db.prepare(query)
          const result = params ? stmt.run(...params) : stmt.run()
          return {
            lastInsertRowid: result.lastInsertRowid,
            changes: result.changes
          }
        }),
      
      transaction: <A>(effect: Effect.Effect<A>) =>
        Effect.sync(() => {
          const trx = db.transaction(() => 
            Runtime.runSync(Runtime.defaultRuntime)(effect)
          )
          return trx()
        })
    }
  })
)

// Test ID service
export const TestIdService = Layer.succeed(IdService, {
  generate: (prefix: string) => 
    Effect.sync(() => `${prefix}_test_${Math.random().toString(36).slice(2)}`)
})

// Test auth config
export const TestAuthConfig = Layer.succeed(AuthConfig, {
  jwtSecret: "test-secret",
  accessTokenTTL: 3600,
  refreshTokenTTL: 86400,
  bcryptRounds: 4 // Lower for faster tests
})

// Base test layer
export const TestContext = Layer.mergeAll(
  NodeContext.layer,
  TestDatabase,
  TestIdService,
  TestAuthConfig
)

// Test clock for time-based tests
export const withTestTime = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) => Effect.provide(effect, TestClock.layer)
```

## Test Factories

### File: `apps/backend/test/factories/index.ts`
```typescript
import { Effect } from "effect"
import { faker } from "@faker-js/faker"
import { 
  Product, 
  Customer, 
  Order,
  Cart,
  AdminUser 
} from "@/packages/api/src/schemas"

export class Factory {
  static product = (overrides?: Partial<Product>) =>
    Effect.sync(() => ({
      id: `prod_${faker.string.alphanumeric(10)}`,
      slug: faker.helpers.slugify(faker.commerce.productName()),
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      basePrice: parseFloat(faker.commerce.price()),
      images: [faker.image.url()],
      categoryId: `cat_${faker.string.alphanumeric(10)}`,
      tags: faker.helpers.arrayElements(["new", "sale", "featured"], 2),
      isActive: true,
      metadata: {},
      createdAt: faker.date.past(),
      updatedAt: faker.date.recent(),
      ...overrides
    }))
  
  static customer = (overrides?: Partial<Customer>) =>
    Effect.sync(() => ({
      id: `cust_${faker.string.alphanumeric(10)}`,
      email: faker.internet.email(),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      phone: faker.phone.number(),
      emailVerified: true,
      isActive: true,
      preferences: {},
      metadata: {},
      createdAt: faker.date.past(),
      updatedAt: faker.date.recent(),
      ...overrides
    }))
  
  static order = (overrides?: Partial<Order>) =>
    Effect.sync(() => ({
      id: `ord_${faker.string.alphanumeric(10)}`,
      orderNumber: `#${faker.number.int({ min: 1000, max: 9999 })}`,
      customerId: `cust_${faker.string.alphanumeric(10)}`,
      status: "pending",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      subtotal: parseFloat(faker.commerce.price()),
      shippingCost: parseFloat(faker.commerce.price({ min: 5, max: 20 })),
      taxAmount: parseFloat(faker.commerce.price({ min: 1, max: 50 })),
      totalAmount: parseFloat(faker.commerce.price({ min: 50, max: 500 })),
      currency: "USD",
      shippingAddress: {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        line1: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        postalCode: faker.location.zipCode(),
        country: "US"
      },
      billingAddress: {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        line1: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        postalCode: faker.location.zipCode(),
        country: "US"
      },
      createdAt: faker.date.past(),
      updatedAt: faker.date.recent(),
      ...overrides
    }))
  
  static adminUser = (overrides?: Partial<AdminUser>) =>
    Effect.sync(() => ({
      id: `admin_${faker.string.alphanumeric(10)}`,
      email: faker.internet.email(),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      role: faker.helpers.arrayElement(["admin", "support"]),
      permissions: ["products:read", "orders:read"],
      isActive: true,
      twoFactorEnabled: false,
      createdAt: faker.date.past(),
      updatedAt: faker.date.recent(),
      ...overrides
    }))
  
  // Batch creation helpers
  static products = (count: number, overrides?: Partial<Product>) =>
    Effect.all(
      Array.from({ length: count }, () => Factory.product(overrides))
    )
  
  static customers = (count: number, overrides?: Partial<Customer>) =>
    Effect.all(
      Array.from({ length: count }, () => Factory.customer(overrides))
    )
}

// Scenario builders
export class Scenario {
  static customerWithOrders = (orderCount: number = 3) =>
    Effect.gen(function* () {
      const customer = yield* Factory.customer()
      const orders = yield* Factory.orders(orderCount, {
        customerId: customer.id,
        guestEmail: customer.email
      })
      
      return { customer, orders }
    })
  
  static completeCheckoutFlow = () =>
    Effect.gen(function* () {
      const session = yield* SessionService.create({
        ipAddress: faker.internet.ip(),
        userAgent: faker.internet.userAgent()
      })
      
      const products = yield* Factory.products(3)
      const cart = yield* CartService.create(session.id)
      
      // Add items to cart
      for (const product of products) {
        yield* CartService.addItem(cart.id, {
          productId: product.id,
          variantId: product.variants[0].id,
          quantity: faker.number.int({ min: 1, max: 3 })
        })
      }
      
      // Create checkout
      const checkout = yield* CheckoutService.create({
        cartId: cart.id,
        email: faker.internet.email()
      })
      
      // Set addresses
      yield* CheckoutService.setAddresses(checkout.id, {
        shipping: Factory.address(),
        billing: Factory.address()
      })
      
      // Complete checkout
      const order = yield* CheckoutService.complete(checkout.id)
      
      return { session, cart, checkout, order }
    })
}
```

## Unit Tests

### File: `apps/backend/src/services/product.test.ts`
```typescript
import { Effect, Layer, Exit } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { ProductService, ProductServiceLive } from "./product"
import { Factory, TestContext } from "../../test"

const testLayer = Layer.provide(ProductServiceLive, TestContext)

describe("ProductService", () => {
  describe("create", () => {
    it("should create a product with valid data", () =>
      Effect.gen(function* () {
        const service = yield* ProductService
        const productData = yield* Factory.product()
        
        const product = yield* service.create({
          name: productData.name,
          slug: productData.slug,
          description: productData.description,
          basePrice: productData.basePrice,
          categoryId: productData.categoryId
        })
        
        expect(product.id).toBeDefined()
        expect(product.name).toBe(productData.name)
        expect(product.slug).toBe(productData.slug)
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
    
    it("should fail with duplicate slug", () =>
      Effect.gen(function* () {
        const service = yield* ProductService
        const productData = yield* Factory.product()
        
        // Create first product
        yield* service.create(productData)
        
        // Try to create with same slug
        const exit = yield* Effect.exit(
          service.create({
            ...productData,
            name: "Different Name"
          })
        )
        
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(exit.cause._tag).toBe("Fail")
          expect(exit.cause.error._tag).toBe("DuplicateSlugError")
        }
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
  })
  
  describe("update", () => {
    it("should update product fields", () =>
      Effect.gen(function* () {
        const service = yield* ProductService
        const product = yield* service.create(yield* Factory.product())
        
        const updated = yield* service.update(product.id, {
          name: "Updated Name",
          basePrice: 99.99
        })
        
        expect(updated.name).toBe("Updated Name")
        expect(updated.basePrice).toBe(99.99)
        expect(updated.updatedAt).not.toBe(product.updatedAt)
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
  })
  
  describe("list", () => {
    it("should filter by category", () =>
      Effect.gen(function* () {
        const service = yield* ProductService
        const categoryId = "cat_electronics"
        
        // Create products in different categories
        yield* Effect.all([
          service.create(yield* Factory.product({ categoryId })),
          service.create(yield* Factory.product({ categoryId })),
          service.create(yield* Factory.product({ categoryId: "cat_books" }))
        ])
        
        const result = yield* service.list({ categoryId })
        
        expect(result.products).toHaveLength(2)
        expect(result.products.every(p => p.categoryId === categoryId)).toBe(true)
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
    
    it("should paginate results", () =>
      Effect.gen(function* () {
        const service = yield* ProductService
        
        // Create 15 products
        yield* Factory.products(15)
        
        // Get first page
        const page1 = yield* service.list({ limit: 10, offset: 0 })
        expect(page1.products).toHaveLength(10)
        expect(page1.hasMore).toBe(true)
        
        // Get second page
        const page2 = yield* service.list({ limit: 10, offset: 10 })
        expect(page2.products).toHaveLength(5)
        expect(page2.hasMore).toBe(false)
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
  })
})
```

## Integration Tests

### File: `apps/backend/test/integration/checkout-flow.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { 
  SessionService,
  CartService,
  CheckoutService,
  OrderService 
} from "../../src/services"
import { Factory, Scenario, TestContext } from "../"

const servicesLayer = Layer.mergeAll(
  SessionServiceLive,
  CartServiceLive,
  CheckoutServiceLive,
  OrderServiceLive,
  InventoryServiceLive,
  PaymentServiceMock // Mock external payment service
)

const testLayer = Layer.provide(servicesLayer, TestContext)

describe("Checkout Flow Integration", () => {
  it("should complete full checkout flow", () =>
    Effect.gen(function* () {
      // Create session
      const session = yield* SessionService.create({
        ipAddress: "127.0.0.1",
        userAgent: "Test Browser"
      })
      
      // Create cart
      const cart = yield* CartService.create(session.id)
      
      // Create test products with inventory
      const products = yield* Factory.products(2)
      for (const product of products) {
        yield* InventoryService.set(
          product.id,
          product.variants[0].id,
          100
        )
      }
      
      // Add items to cart
      yield* CartService.addItem(cart.id, {
        productId: products[0].id,
        variantId: products[0].variants[0].id,
        quantity: 2
      })
      
      yield* CartService.addItem(cart.id, {
        productId: products[1].id,
        variantId: products[1].variants[0].id,
        quantity: 1
      })
      
      // Create checkout
      const checkout = yield* CheckoutService.create({
        cartId: cart.id,
        email: "test@example.com"
      })
      
      // Set shipping address
      const address = {
        firstName: "John",
        lastName: "Doe",
        line1: "123 Main St",
        city: "New York",
        state: "NY",
        postalCode: "10001",
        country: "US"
      }
      
      yield* CheckoutService.setAddresses(checkout.id, {
        shipping: address,
        billing: address
      })
      
      // Select shipping method
      const methods = yield* CheckoutService.getShippingMethods(checkout.id)
      yield* CheckoutService.setShippingMethod(
        checkout.id,
        methods[0].id
      )
      
      // Process payment
      yield* CheckoutService.processPayment(checkout.id, {
        provider: "stripe",
        method: {
          type: "card",
          token: "tok_test_visa"
        }
      })
      
      // Complete checkout
      const order = yield* CheckoutService.complete(checkout.id)
      
      // Verify order
      expect(order.status).toBe("pending")
      expect(order.paymentStatus).toBe("paid")
      expect(order.items).toHaveLength(2)
      
      // Verify inventory was deducted
      const inv1 = yield* InventoryService.getQuantity(
        products[0].id,
        products[0].variants[0].id
      )
      expect(inv1).toBe(98) // 100 - 2
      
      // Verify cart was cleared
      const updatedCart = yield* CartService.get(cart.id)
      expect(updatedCart.items).toHaveLength(0)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should handle inventory shortage", () =>
    Effect.gen(function* () {
      const { cart, products } = yield* setupCartWithProducts()
      
      // Set low inventory
      yield* InventoryService.set(
        products[0].id,
        products[0].variants[0].id,
        1 // Only 1 available
      )
      
      // Try to add 2 items
      const exit = yield* Effect.exit(
        CartService.addItem(cart.id, {
          productId: products[0].id,
          variantId: products[0].variants[0].id,
          quantity: 2
        })
      )
      
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.error._tag).toBe("InsufficientInventoryError")
      }
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## E2E Tests

### File: `apps/backend/test/e2e/api.test.ts`
```typescript
import { Effect } from "effect"
import { describe, expect, it } from "bun:test"
import { TestClient } from "../helpers/client"
import { Factory } from "../factories"

describe("E2E API Tests", () => {
  describe("Guest Checkout", () => {
    it("should allow guest to complete purchase", () =>
      Effect.gen(function* () {
        const client = yield* TestClient
        
        // 1. Get products
        const { products } = yield* client.get("/products")
        expect(products.length).toBeGreaterThan(0)
        
        // 2. Create cart (session created automatically)
        const cart = yield* client.post("/cart", {})
        expect(cart.id).toBeDefined()
        
        // 3. Add items to cart
        yield* client.post(`/cart/${cart.id}/items`, {
          productId: products[0].id,
          variantId: products[0].variants[0].id,
          quantity: 2
        })
        
        // 4. Create checkout
        const checkout = yield* client.post("/checkout", {
          cartId: cart.id,
          email: "guest@example.com"
        })
        
        // 5. Set addresses
        yield* client.patch(`/checkout/${checkout.id}/addresses`, {
          shipping: Factory.address(),
          billing: Factory.address()
        })
        
        // 6. Get shipping methods
        const { methods } = yield* client.get(
          `/checkout/${checkout.id}/shipping-methods`
        )
        
        // 7. Select shipping
        yield* client.patch(`/checkout/${checkout.id}/shipping`, {
          methodId: methods[0].id
        })
        
        // 8. Process payment
        yield* client.post(`/checkout/${checkout.id}/payment`, {
          provider: "stripe",
          method: {
            type: "card",
            token: "tok_test_visa"
          }
        })
        
        // 9. Complete checkout
        const order = yield* client.post(`/checkout/${checkout.id}/complete`)
        
        expect(order.orderNumber).toBeDefined()
        expect(order.status).toBe("pending")
        expect(order.paymentStatus).toBe("paid")
        
        // 10. Track order as guest
        const tracking = yield* client.get(
          `/orders/track?email=guest@example.com&orderNumber=${order.orderNumber}`
        )
        
        expect(tracking.id).toBe(order.id)
      }).pipe(
        Effect.runPromise
      )
    )
  })
  
  describe("Customer Account", () => {
    it("should merge guest cart on login", () =>
      Effect.gen(function* () {
        const client = yield* TestClient
        
        // 1. Create guest cart with items
        const guestCart = yield* client.post("/cart", {})
        yield* client.post(`/cart/${guestCart.id}/items`, {
          productId: "prod_1",
          variantId: "var_1",
          quantity: 2
        })
        
        // 2. Register customer
        const { customer, tokens } = yield* client.post("/auth/register", {
          email: "new@example.com",
          password: "password123",
          firstName: "New",
          lastName: "Customer"
        })
        
        // 3. Login (should merge cart)
        const loginResponse = yield* client.post("/auth/login", {
          email: "new@example.com",
          password: "password123"
        }, {
          headers: {
            "x-session-id": guestCart.sessionId
          }
        })
        
        // 4. Get customer cart
        const customerCart = yield* client.get("/cart", {
          headers: {
            authorization: `Bearer ${loginResponse.accessToken}`
          }
        })
        
        // Should have merged items
        expect(customerCart.items).toHaveLength(1)
        expect(customerCart.items[0].quantity).toBe(2)
      }).pipe(
        Effect.runPromise
      )
    )
  })
})
```

## Performance Tests

### File: `apps/backend/test/performance/load.test.ts`
```typescript
import { Effect } from "effect"
import autocannon from "autocannon"
import { describe, it } from "bun:test"

describe("Performance Tests", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3000"
  
  it("should handle concurrent product listing requests", async () => {
    const result = await autocannon({
      url: `${baseUrl}/products`,
      connections: 100,
      duration: 30,
      pipelining: 10,
      headers: {
        "accept": "application/json"
      }
    })
    
    expect(result.errors).toBe(0)
    expect(result.timeouts).toBe(0)
    expect(result.latency.p99).toBeLessThan(200) // 99th percentile < 200ms
    expect(result.requests.average).toBeGreaterThan(1000) // > 1000 req/s
  })
  
  it("should handle checkout flow under load", async () => {
    // Setup test data
    const testCarts = await Effect.all(
      Array.from({ length: 100 }, () => createTestCart())
    ).pipe(Effect.runPromise)
    
    const result = await autocannon({
      url: `${baseUrl}/checkout`,
      method: "POST",
      connections: 50,
      duration: 30,
      requests: testCarts.map(cart => ({
        body: JSON.stringify({
          cartId: cart.id,
          email: "test@example.com"
        }),
        headers: {
          "content-type": "application/json"
        }
      }))
    })
    
    expect(result.errors).toBeLessThan(result.requests.total * 0.01) // < 1% error rate
    expect(result.latency.p95).toBeLessThan(500) // 95th percentile < 500ms
  })
})

// Stress test for inventory management
describe("Inventory Stress Test", () => {
  it("should handle concurrent inventory updates", () =>
    Effect.gen(function* () {
      const productId = "prod_stress_test"
      const variantId = "var_stress_test"
      
      // Set initial inventory
      yield* InventoryService.set(productId, variantId, 1000)
      
      // Simulate 100 concurrent purchases of 5 items each
      const purchases = Array.from({ length: 100 }, (_, i) =>
        CartService.addItem(`cart_${i}`, {
          productId,
          variantId,
          quantity: 5
        })
      )
      
      const results = yield* Effect.all(purchases, {
        concurrency: "unbounded"
      })
      
      // Check final inventory
      const finalInventory = yield* InventoryService.getQuantity(
        productId,
        variantId
      )
      
      expect(finalInventory).toBe(500) // 1000 - (100 * 5)
      expect(results.every(r => r._tag === "Success")).toBe(true)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Test Utilities

### File: `apps/backend/test/helpers/client.ts`
```typescript
import { Effect, Context, Layer } from "effect"
import { HttpClient } from "@effect/platform"

export class TestClient extends Context.Tag("TestClient")<
  TestClient,
  {
    readonly get: <T = any>(path: string, options?: RequestOptions) => Effect.Effect<T>
    readonly post: <T = any>(path: string, body?: any, options?: RequestOptions) => Effect.Effect<T>
    readonly patch: <T = any>(path: string, body?: any, options?: RequestOptions) => Effect.Effect<T>
    readonly delete: <T = any>(path: string, options?: RequestOptions) => Effect.Effect<T>
  }
>() {}

interface RequestOptions {
  headers?: Record<string, string>
  cookies?: Record<string, string>
}

export const TestClientLive = Layer.effect(
  TestClient,
  Effect.gen(function* () {
    const baseUrl = "http://localhost:3000"
    const client = yield* HttpClient.HttpClient
    
    let sessionCookie: string | undefined
    
    const request = (
      method: string,
      path: string,
      body?: any,
      options?: RequestOptions
    ) =>
      client.request(
        HttpClientRequest.make(method, `${baseUrl}${path}`).pipe(
          body ? HttpClientRequest.jsonBody(body) : identity,
          HttpClientRequest.setHeaders({
            "content-type": "application/json",
            "cookie": sessionCookie || "",
            ...options?.headers
          })
        )
      ).pipe(
        Effect.tap(response => {
          // Capture session cookie
          const setCookie = response.headers["set-cookie"]
          if (setCookie) {
            sessionCookie = setCookie[0]
          }
        }),
        Effect.flatMap(response => {
          if (response.status >= 400) {
            return Effect.fail(new Error(`HTTP ${response.status}`))
          }
          return response.json
        })
      )
    
    return {
      get: (path, options) => request("GET", path, undefined, options),
      post: (path, body, options) => request("POST", path, body, options),
      patch: (path, body, options) => request("PATCH", path, body, options),
      delete: (path, options) => request("DELETE", path, undefined, options)
    }
  })
)
```

### File: `apps/backend/test/helpers/database.ts`
```typescript
import { Effect } from "effect"
import { Database } from "../../src/services/database"

export const withTransaction = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const db = yield* Database
    
    yield* db.run("BEGIN")
    
    const result = yield* Effect.either(effect)
    
    if (result._tag === "Left") {
      yield* db.run("ROLLBACK")
      yield* Effect.fail(result.left)
    } else {
      yield* db.run("COMMIT")
      return result.right
    }
  })

export const cleanDatabase = () =>
  Effect.gen(function* () {
    const db = yield* Database
    
    // Get all tables
    const tables = yield* db.all(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    )
    
    // Delete data from all tables
    for (const table of tables) {
      yield* db.run(`DELETE FROM ${table.name}`)
    }
    
    // Reset sequences
    yield* db.run(`DELETE FROM sqlite_sequence`)
  })

export const seedDatabase = () =>
  Effect.gen(function* () {
    // Seed categories
    yield* db.run(`
      INSERT INTO categories (id, slug, name) VALUES
      ('cat_electronics', 'electronics', 'Electronics'),
      ('cat_clothing', 'clothing', 'Clothing'),
      ('cat_books', 'books', 'Books')
    `)
    
    // Seed products
    const products = yield* Factory.products(10)
    for (const product of products) {
      yield* ProductService.create(product)
    }
    
    // Seed admin user
    yield* AdminService.create({
      email: "admin@test.com",
      password: "admin123",
      firstName: "Test",
      lastName: "Admin",
      role: "super_admin"
    })
  })
```

## Test Configuration

### File: `bunfig.toml`
```toml
[test]
preload = ["./test/setup.ts"]
coverage = true
coverageReporter = ["text", "lcov", "html"]
coverageThreshold = { line = 80, function = 80, branch = 70 }
```

### File: `package.json`
```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration",
    "test:e2e": "bun test tests/e2e",
    "test:performance": "bun test tests/performance",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage",
    "test:ci": "bun test --coverage --bail"
  },
  "devDependencies": {
    "@faker-js/faker": "^8.0.0",
    "autocannon": "^7.12.0",
    "bun-types": "latest"
  }
}
```

## CI Test Pipeline

### File: `.github/workflows/test.yml`
```yaml
name: Test

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install --frozen-lockfile
      
      - name: Run unit tests
        run: bun test:unit
      
      - name: Run integration tests
        run: bun test:integration
      
      - name: Run E2E tests
        run: |
          bun run build
          bun run start &
          sleep 5
          bun test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
      
      - name: Performance test
        if: github.event_name == 'pull_request'
        run: |
          bun test:performance
          
      - name: Comment test results
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const coverage = require('./coverage/coverage-summary.json');
            const total = coverage.total;
            
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Test Results
              
              - Lines: ${total.lines.pct}%
              - Functions: ${total.functions.pct}%
              - Branches: ${total.branches.pct}%
              `
            });
```

## Test Best Practices

1. **Test Organization**
   - Group related tests in describe blocks
   - Use clear, descriptive test names
   - Follow AAA pattern (Arrange, Act, Assert)

2. **Test Isolation**
   - Each test should be independent
   - Use transactions for database tests
   - Clean up after tests

3. **Test Data**
   - Use factories for consistent test data
   - Avoid hardcoded values
   - Use realistic data with Faker

4. **Performance**
   - Run tests in parallel when possible
   - Use test database in memory
   - Mock external services

5. **Coverage Goals**
   - 80% line coverage minimum
   - 100% coverage for critical paths
   - Focus on behavior, not lines

## Next Steps

1. Add mutation testing
2. Implement visual regression tests
3. Add contract testing for APIs
4. Create load test scenarios
5. Add security testing suite
6. Implement chaos testing
7. Add accessibility tests
8. Create test data management system

This testing strategy ensures:
- Comprehensive test coverage
- Fast feedback loops
- Reliable test results
- Performance validation
- Easy test maintenance
- CI/CD integration