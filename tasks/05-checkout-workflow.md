# Task 05: Checkout Workflow

## Overview
Implement the checkout workflow that guides users from cart to order completion. This includes address collection, shipping calculation, payment processing abstraction, and order creation.

## Database Schema

```sql
-- Checkout sessions table
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id TEXT PRIMARY KEY,
  cart_id TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'started', -- started, address_set, shipping_set, payment_set, completed, expired
  email TEXT NOT NULL,
  shipping_address TEXT, -- JSON
  billing_address TEXT, -- JSON
  shipping_method_id TEXT,
  shipping_cost DECIMAL(10, 2),
  payment_intent_id TEXT,
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (cart_id) REFERENCES carts(id)
);

-- Shipping methods table
CREATE TABLE IF NOT EXISTS shipping_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  base_cost DECIMAL(10, 2) NOT NULL,
  cost_per_kg DECIMAL(10, 2) DEFAULT 0,
  min_days INTEGER NOT NULL,
  max_days INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  countries TEXT, -- JSON array of country codes
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Payment intents table (abstraction over payment providers)
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- stripe, paypal, etc.
  provider_intent_id TEXT UNIQUE,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, processing, succeeded, failed, cancelled
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checkout_session_id) REFERENCES checkout_sessions(id)
);

-- Indexes
CREATE INDEX idx_checkout_sessions_cart_id ON checkout_sessions(cart_id);
CREATE INDEX idx_checkout_sessions_status ON checkout_sessions(status);
CREATE INDEX idx_checkout_sessions_expires_at ON checkout_sessions(expires_at);
CREATE INDEX idx_payment_intents_checkout_session_id ON payment_intents(checkout_session_id);
CREATE INDEX idx_payment_intents_provider_intent_id ON payment_intents(provider_intent_id);
```

## Effect Schemas

### File: `packages/api/src/checkout/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { CartId, CartIdSchema } from "../common/id"

// Address schema
export class Address extends Schema.Class<Address>("Address")({
  firstName: Schema.String.pipe(Schema.minLength(1)),
  lastName: Schema.String.pipe(Schema.minLength(1)),
  line1: Schema.String.pipe(Schema.minLength(1)),
  line2: Schema.optional(Schema.String),
  city: Schema.String.pipe(Schema.minLength(1)),
  state: Schema.String.pipe(Schema.minLength(1)),
  postalCode: Schema.String.pipe(Schema.pattern(/^[A-Z0-9-\s]{3,10}$/i)),
  country: Schema.String.pipe(Schema.length(2)), // ISO country code
  phone: Schema.optional(Schema.String.pipe(Schema.pattern(/^[+]?[0-9-\s()]+$/)))
}) {}

// Checkout session status
export const CheckoutStatus = Schema.Literal(
  "started",
  "address_set", 
  "shipping_set",
  "payment_set",
  "completed",
  "expired"
)
export type CheckoutStatus = Schema.Schema.Type<typeof CheckoutStatus>

// Checkout session
export class CheckoutSession extends Schema.Class<CheckoutSession>("CheckoutSession")({
  id: Schema.String,
  cartId: CartIdSchema,
  status: CheckoutStatus,
  email: Schema.String,
  shippingAddress: Schema.optional(Address),
  billingAddress: Schema.optional(Schema.Union(Address, Schema.Literal("same_as_shipping"))),
  shippingMethodId: Schema.optional(Schema.String),
  shippingCost: Schema.optional(Schema.Number),
  paymentIntentId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf
}) {}

// Shipping method
export class ShippingMethod extends Schema.Class<ShippingMethod>("ShippingMethod")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  baseCost: Schema.Number,
  costPerKg: Schema.Number,
  estimatedDays: Schema.Struct({
    min: Schema.Number,
    max: Schema.Number
  }),
  isActive: Schema.Boolean,
  countries: Schema.Array(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
}) {}

// Payment provider enum
export const PaymentProvider = Schema.Literal("stripe", "paypal", "mock")
export type PaymentProvider = Schema.Schema.Type<typeof PaymentProvider>

// Payment intent status
export const PaymentStatus = Schema.Literal(
  "pending",
  "processing", 
  "succeeded",
  "failed",
  "cancelled"
)
export type PaymentStatus = Schema.Schema.Type<typeof PaymentStatus>

// Payment intent
export class PaymentIntent extends Schema.Class<PaymentIntent>("PaymentIntent")({
  id: Schema.String,
  checkoutSessionId: Schema.String,
  provider: PaymentProvider,
  providerIntentId: Schema.optional(Schema.String),
  amount: Schema.Number,
  currency: Schema.String,
  status: PaymentStatus,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Request schemas
export class SetAddressesRequest extends Schema.Class<SetAddressesRequest>("SetAddressesRequest")({
  shipping: Address,
  billing: Schema.Union(Address, Schema.Literal("same_as_shipping"))
}) {}

export class SetShippingMethodRequest extends Schema.Class<SetShippingMethodRequest>("SetShippingMethodRequest")({
  shippingMethodId: Schema.String
}) {}

export class ProcessPaymentRequest extends Schema.Class<ProcessPaymentRequest>("ProcessPaymentRequest")({
  provider: PaymentProvider,
  paymentMethod: Schema.Union(
    // Stripe
    Schema.Struct({
      type: Schema.Literal("stripe"),
      token: Schema.String
    }),
    // PayPal
    Schema.Struct({
      type: Schema.Literal("paypal"),
      orderId: Schema.String
    }),
    // Mock for testing
    Schema.Struct({
      type: Schema.Literal("mock"),
      succeed: Schema.Boolean
    })
  )
}) {}

// Checkout summary
export class CheckoutSummary extends Schema.Class<CheckoutSummary>("CheckoutSummary")({
  items: Schema.Number,
  subtotal: Schema.Number,
  shipping: Schema.Number,
  tax: Schema.Number,
  discount: Schema.Number,
  total: Schema.Number,
  currency: Schema.String
}) {}

// Complete checkout response
export class CheckoutDetails extends Schema.Class<CheckoutDetails>("CheckoutDetails")({
  session: CheckoutSession,
  summary: CheckoutSummary,
  availableShippingMethods: Schema.optional(Schema.Array(ShippingMethod)),
  selectedShippingMethod: Schema.optional(ShippingMethod),
  paymentIntent: Schema.optional(PaymentIntent)
}) {}
```

## Checkout Service

### File: `apps/backend/src/services/CheckoutService.ts`
```typescript
import { Context, Effect, Layer, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import { 
  CheckoutSession, CheckoutStatus, CheckoutDetails, CheckoutSummary,
  Address, ShippingMethod, PaymentIntent, PaymentProvider, PaymentStatus,
  SetAddressesRequest, SetShippingMethodRequest, ProcessPaymentRequest
} from "@turbobun/api/checkout/schemas"
import { CartId } from "@turbobun/api/common/id"
import { CartService } from "./CartService"
import { ConfigService } from "./ConfigService"
import { TaxService } from "./TaxService"
import { PaymentService } from "./PaymentService"
import { NotFoundError, BusinessError, ValidationError } from "@turbobun/api/common/errors"

export class CheckoutService extends Context.Tag("CheckoutService")<
  CheckoutService,
  {
    readonly startCheckout: (cartId: CartId) => Effect.Effect<CheckoutSession, BusinessError>
    readonly getSession: (sessionId: string) => Effect.Effect<CheckoutSession, NotFoundError>
    readonly getCheckoutDetails: (sessionId: string) => Effect.Effect<CheckoutDetails>
    
    readonly setAddresses: (
      sessionId: string,
      request: SetAddressesRequest
    ) => Effect.Effect<CheckoutDetails>
    
    readonly getShippingMethods: (
      sessionId: string
    ) => Effect.Effect<ShippingMethod[]>
    
    readonly setShippingMethod: (
      sessionId: string,
      methodId: string
    ) => Effect.Effect<CheckoutDetails>
    
    readonly calculateTotals: (
      sessionId: string
    ) => Effect.Effect<CheckoutSummary>
    
    readonly processPayment: (
      sessionId: string,
      request: ProcessPaymentRequest
    ) => Effect.Effect<PaymentIntent>
    
    readonly completeCheckout: (
      sessionId: string
    ) => Effect.Effect<{ orderId: string }>
    
    readonly cleanup: Effect.Effect<number>
  }
>() {}

export const CheckoutServiceLive = Layer.effect(
  CheckoutService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const cartService = yield* CartService
    const configService = yield* ConfigService
    const taxService = yield* TaxService
    const paymentService = yield* PaymentService
    
    const checkoutTtlMinutes = 30
    
    const startCheckout = (cartId: CartId) =>
      Effect.gen(function* () {
        // Validate cart
        const validation = yield* cartService.validateCart(cartId)
        if (!validation.valid) {
          return yield* Effect.fail(new BusinessError({
            code: "INVALID_CART",
            message: "Cart is not valid for checkout",
            details: { issues: validation.issues }
          }))
        }
        
        // Get cart details
        const cartDetails = yield* cartService.getCartDetails(cartId)
        if (!cartDetails.cart.email) {
          return yield* Effect.fail(new BusinessError({
            code: "EMAIL_REQUIRED",
            message: "Email is required to start checkout"
          }))
        }
        
        // Check for existing session
        const existing = yield* sql`
          SELECT id FROM checkout_sessions 
          WHERE cart_id = ${cartId} 
            AND status != 'completed'
            AND expires_at > datetime('now')
        `
        
        if (existing.length > 0) {
          return yield* getSession(existing[0].id)
        }
        
        // Create new session
        const sessionId = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const now = new Date()
        const expiresAt = new Date(now.getTime() + checkoutTtlMinutes * 60 * 1000)
        
        yield* sql`
          INSERT INTO checkout_sessions (
            id, cart_id, status, email, metadata,
            created_at, updated_at, expires_at
          ) VALUES (
            ${sessionId}, ${cartId}, 'started', ${cartDetails.cart.email},
            '{}', ${now}, ${now}, ${expiresAt}
          )
        `
        
        return new CheckoutSession({
          id: sessionId,
          cartId,
          status: "started",
          email: cartDetails.cart.email,
          metadata: {},
          createdAt: now,
          updatedAt: now,
          expiresAt
        })
      })
    
    const getSession = (sessionId: string) =>
      sql`
        SELECT * FROM checkout_sessions 
        WHERE id = ${sessionId} AND expires_at > datetime('now')
      `.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new CheckoutSession({
                ...rows[0],
                shippingAddress: rows[0].shipping_address 
                  ? JSON.parse(rows[0].shipping_address)
                  : undefined,
                billingAddress: rows[0].billing_address
                  ? JSON.parse(rows[0].billing_address)
                  : undefined,
                metadata: JSON.parse(rows[0].metadata || "{}"),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at),
                expiresAt: new Date(rows[0].expires_at)
              }))
            : Effect.fail(new NotFoundError({ resource: "CheckoutSession", id: sessionId }))
        )
      )
    
    const getCheckoutDetails = (sessionId: string) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        const cartDetails = yield* cartService.getCartDetails(session.cartId)
        
        // Calculate base totals
        const subtotal = cartDetails.summary.subtotal
        let shipping = 0
        let tax = 0
        
        // Get shipping cost if method selected
        let selectedShippingMethod: ShippingMethod | undefined
        if (session.shippingMethodId) {
          const methods = yield* sql`
            SELECT * FROM shipping_methods WHERE id = ${session.shippingMethodId}
          `
          if (methods.length > 0) {
            selectedShippingMethod = new ShippingMethod({
              ...methods[0],
              baseCost: Number(methods[0].base_cost),
              costPerKg: Number(methods[0].cost_per_kg),
              estimatedDays: {
                min: methods[0].min_days,
                max: methods[0].max_days
              },
              isActive: Boolean(methods[0].is_active),
              countries: JSON.parse(methods[0].countries || "[]"),
              metadata: JSON.parse(methods[0].metadata || "{}")
            })
            shipping = selectedShippingMethod.baseCost
          }
        }
        
        // Calculate tax if address is set
        if (session.shippingAddress) {
          tax = yield* taxService.calculateTax({
            amount: subtotal + shipping,
            address: session.shippingAddress
          })
        }
        
        const summary = new CheckoutSummary({
          items: cartDetails.summary.itemCount,
          subtotal,
          shipping,
          tax,
          discount: 0, // TODO: Implement discounts
          total: subtotal + shipping + tax,
          currency: cartDetails.cart.currency
        })
        
        // Get available shipping methods if address is set
        let availableShippingMethods: ShippingMethod[] | undefined
        if (session.shippingAddress && session.status === "address_set") {
          availableShippingMethods = yield* getShippingMethods(sessionId)
        }
        
        // Get payment intent if exists
        let paymentIntent: PaymentIntent | undefined
        if (session.paymentIntentId) {
          const intents = yield* sql`
            SELECT * FROM payment_intents WHERE id = ${session.paymentIntentId}
          `
          if (intents.length > 0) {
            paymentIntent = new PaymentIntent({
              ...intents[0],
              amount: Number(intents[0].amount),
              metadata: JSON.parse(intents[0].metadata || "{}"),
              createdAt: new Date(intents[0].created_at),
              updatedAt: new Date(intents[0].updated_at)
            })
          }
        }
        
        return new CheckoutDetails({
          session,
          summary,
          availableShippingMethods,
          selectedShippingMethod,
          paymentIntent
        })
      })
    
    const setAddresses = (sessionId: string, request: SetAddressesRequest) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        const now = new Date()
        
        // Validate addresses
        const shippingAddress = request.shipping
        const billingAddress = request.billing === "same_as_shipping" 
          ? "same_as_shipping" 
          : request.billing
        
        yield* sql`
          UPDATE checkout_sessions 
          SET 
            shipping_address = ${JSON.stringify(shippingAddress)},
            billing_address = ${JSON.stringify(billingAddress)},
            status = 'address_set',
            updated_at = ${now}
          WHERE id = ${sessionId}
        `
        
        return yield* getCheckoutDetails(sessionId)
      })
    
    const getShippingMethods = (sessionId: string) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        
        if (!session.shippingAddress) {
          return []
        }
        
        // Get applicable shipping methods
        const methods = yield* sql`
          SELECT * FROM shipping_methods 
          WHERE is_active = 1
            AND (countries IS NULL OR countries LIKE '%${session.shippingAddress.country}%')
          ORDER BY base_cost
        `
        
        // Get cart weight for shipping calculation
        const cartDetails = yield* cartService.getCartDetails(session.cartId)
        const totalWeight = yield* calculateCartWeight(cartDetails)
        
        return methods.map(m => new ShippingMethod({
          id: m.id,
          name: m.name,
          description: m.description,
          baseCost: Number(m.base_cost) + (Number(m.cost_per_kg) * totalWeight / 1000),
          costPerKg: Number(m.cost_per_kg),
          estimatedDays: {
            min: m.min_days,
            max: m.max_days
          },
          isActive: Boolean(m.is_active),
          countries: JSON.parse(m.countries || "[]"),
          metadata: JSON.parse(m.metadata || "{}")
        }))
      })
    
    const calculateCartWeight = (cartDetails: CartDetails) =>
      Effect.gen(function* () {
        // TODO: Get actual product weights
        // For now, estimate 500g per item
        return cartDetails.summary.itemCount * 500
      })
    
    const setShippingMethod = (sessionId: string, methodId: string) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        
        if (session.status !== "address_set") {
          return yield* Effect.fail(new BusinessError({
            code: "ADDRESS_REQUIRED",
            message: "Shipping address must be set first"
          }))
        }
        
        // Validate shipping method
        const methods = yield* getShippingMethods(sessionId)
        const selected = methods.find(m => m.id === methodId)
        
        if (!selected) {
          return yield* Effect.fail(new ValidationError({
            field: "shippingMethodId",
            message: "Invalid shipping method",
            value: methodId
          }))
        }
        
        const now = new Date()
        
        yield* sql`
          UPDATE checkout_sessions 
          SET 
            shipping_method_id = ${methodId},
            shipping_cost = ${selected.baseCost},
            status = 'shipping_set',
            updated_at = ${now}
          WHERE id = ${sessionId}
        `
        
        return yield* getCheckoutDetails(sessionId)
      })
    
    const calculateTotals = (sessionId: string) =>
      Effect.gen(function* () {
        const details = yield* getCheckoutDetails(sessionId)
        return details.summary
      })
    
    const processPayment = (sessionId: string, request: ProcessPaymentRequest) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        
        if (session.status !== "shipping_set") {
          return yield* Effect.fail(new BusinessError({
            code: "INCOMPLETE_CHECKOUT",
            message: "Shipping method must be set first"
          }))
        }
        
        const details = yield* getCheckoutDetails(sessionId)
        const paymentIntentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const now = new Date()
        
        // Create payment intent record
        yield* sql`
          INSERT INTO payment_intents (
            id, checkout_session_id, provider, amount, currency,
            status, metadata, created_at, updated_at
          ) VALUES (
            ${paymentIntentId}, ${sessionId}, ${request.provider},
            ${details.summary.total}, ${details.summary.currency},
            'pending', '{}', ${now}, ${now}
          )
        `
        
        // Process with provider
        const result = yield* paymentService.processPayment({
          provider: request.provider,
          amount: details.summary.total,
          currency: details.summary.currency,
          paymentMethod: request.paymentMethod,
          metadata: {
            checkoutSessionId: sessionId,
            cartId: session.cartId
          }
        })
        
        // Update payment intent
        yield* sql`
          UPDATE payment_intents 
          SET 
            provider_intent_id = ${result.providerIntentId},
            status = ${result.status},
            updated_at = ${now}
          WHERE id = ${paymentIntentId}
        `
        
        // Update checkout session
        if (result.status === "succeeded") {
          yield* sql`
            UPDATE checkout_sessions 
            SET 
              payment_intent_id = ${paymentIntentId},
              status = 'payment_set',
              updated_at = ${now}
            WHERE id = ${sessionId}
          `
        }
        
        return new PaymentIntent({
          id: paymentIntentId,
          checkoutSessionId: sessionId,
          provider: request.provider,
          providerIntentId: result.providerIntentId,
          amount: details.summary.total,
          currency: details.summary.currency,
          status: result.status as PaymentStatus,
          metadata: {},
          createdAt: now,
          updatedAt: now
        })
      })
    
    const completeCheckout = (sessionId: string) =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId)
        
        if (session.status !== "payment_set") {
          return yield* Effect.fail(new BusinessError({
            code: "PAYMENT_REQUIRED",
            message: "Payment must be processed first"
          }))
        }
        
        // Verify payment succeeded
        const paymentIntent = yield* sql`
          SELECT status FROM payment_intents 
          WHERE id = ${session.paymentIntentId}
        `.pipe(Effect.map(r => r[0]))
        
        if (paymentIntent.status !== "succeeded") {
          return yield* Effect.fail(new BusinessError({
            code: "PAYMENT_NOT_COMPLETED",
            message: "Payment has not been completed"
          }))
        }
        
        // This will be handled by OrderService in the next task
        // For now, just mark as completed
        const now = new Date()
        
        yield* sql`
          UPDATE checkout_sessions 
          SET status = 'completed', updated_at = ${now}
          WHERE id = ${sessionId}
        `
        
        yield* cartService.markCompleted(session.cartId)
        
        // Placeholder for order creation
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        
        return { orderId }
      })
    
    const cleanup = sql`
      DELETE FROM checkout_sessions 
      WHERE expires_at < datetime('now')
        AND status != 'completed'
    `.pipe(
      Effect.map(result => result.rowsAffected)
    )
    
    return CheckoutService.of({
      startCheckout,
      getSession,
      getCheckoutDetails,
      setAddresses,
      getShippingMethods,
      setShippingMethod,
      calculateTotals,
      processPayment,
      completeCheckout,
      cleanup
    })
  })
)
```

## Tax Service

### File: `apps/backend/src/services/TaxService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { Address } from "@turbobun/api/checkout/schemas"

export class TaxService extends Context.Tag("TaxService")<
  TaxService,
  {
    readonly calculateTax: (params: {
      amount: number
      address: Address
    }) => Effect.Effect<number>
  }
>() {}

export const TaxServiceLive = Layer.succeed(
  TaxService,
  TaxService.of({
    calculateTax: ({ amount, address }) =>
      Effect.gen(function* () {
        // Simple tax calculation - in production, use a tax API
        const taxRates: Record<string, number> = {
          US: 0.08, // 8% average
          CA: 0.13, // 13% average
          GB: 0.20, // 20% VAT
          EU: 0.21, // 21% average VAT
        }
        
        const rate = taxRates[address.country] || 0.10 // 10% default
        return Math.round(amount * rate * 100) / 100
      })
  })
)
```

## Payment Service

### File: `apps/backend/src/services/PaymentService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { PaymentProvider } from "@turbobun/api/checkout/schemas"

interface PaymentResult {
  providerIntentId: string
  status: "pending" | "processing" | "succeeded" | "failed"
  metadata?: Record<string, unknown>
}

export class PaymentService extends Context.Tag("PaymentService")<
  PaymentService,
  {
    readonly processPayment: (params: {
      provider: PaymentProvider
      amount: number
      currency: string
      paymentMethod: any
      metadata?: Record<string, unknown>
    }) => Effect.Effect<PaymentResult>
  }
>() {}

export const PaymentServiceLive = Layer.succeed(
  PaymentService,
  PaymentService.of({
    processPayment: (params) =>
      Effect.gen(function* () {
        switch (params.provider) {
          case "stripe":
            // TODO: Implement Stripe integration
            return {
              providerIntentId: `pi_mock_${Date.now()}`,
              status: "succeeded" as const
            }
            
          case "paypal":
            // TODO: Implement PayPal integration
            return {
              providerIntentId: `paypal_mock_${Date.now()}`,
              status: "succeeded" as const
            }
            
          case "mock":
            // Mock provider for testing
            const mockMethod = params.paymentMethod as { succeed: boolean }
            return {
              providerIntentId: `mock_${Date.now()}`,
              status: mockMethod.succeed ? "succeeded" as const : "failed" as const
            }
            
          default:
            return yield* Effect.fail(new Error(`Unknown payment provider: ${params.provider}`))
        }
      })
  })
)
```

## Checkout Workflow

### File: `apps/backend/src/workflows/CheckoutWorkflow.ts`
```typescript
import { Effect, pipe } from "effect"
import { CheckoutService } from "../services/CheckoutService"
import { CartService } from "../services/CartService"
import { OrderService } from "../services/OrderService"
import { EmailService } from "../services/EmailService"
import { InventoryService } from "../services/InventoryService"

export const checkoutWorkflow = (checkoutSessionId: string) =>
  Effect.gen(function* () {
    const checkoutService = yield* CheckoutService
    const cartService = yield* CartService
    const orderService = yield* OrderService
    const emailService = yield* EmailService
    const inventoryService = yield* InventoryService
    
    // Step 1: Validate checkout session
    const session = yield* checkoutService.getSession(checkoutSessionId)
    if (session.status !== "payment_set") {
      return yield* Effect.fail(new Error("Checkout not ready for completion"))
    }
    
    // Step 2: Reserve inventory
    const cartDetails = yield* cartService.getCartDetails(session.cartId)
    const inventoryItems = cartDetails.items.map(item => ({
      variantId: item.variantId,
      quantity: item.quantity
    }))
    
    yield* inventoryService.reserveItems(inventoryItems).pipe(
      Effect.catchTag("InsufficientInventory", () =>
        Effect.fail(new Error("Some items are no longer available"))
      )
    )
    
    // Step 3: Create order
    const order = yield* orderService.createFromCheckout(checkoutSessionId).pipe(
      Effect.catchAll(() => {
        // Rollback: Release inventory
        return inventoryService.releaseItems(inventoryItems).pipe(
          Effect.flatMap(() => Effect.fail(new Error("Failed to create order")))
        )
      })
    )
    
    // Step 4: Confirm inventory
    yield* inventoryService.confirmReservation(order.id)
    
    // Step 5: Mark checkout complete
    yield* checkoutService.completeCheckout(checkoutSessionId)
    
    // Step 6: Send confirmation email
    yield* emailService.sendOrderConfirmation(order.id).pipe(
      Effect.catchAll(() => Effect.unit) // Don't fail if email fails
    )
    
    return order
  })
```

## Checkout API

### File: `packages/api/src/checkout/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { 
  CheckoutSession, CheckoutDetails, ShippingMethod,
  SetAddressesRequest, SetShippingMethodRequest, ProcessPaymentRequest
} from "./schemas"

class CheckoutGroup extends HttpApiGroup.make("checkout")
  .add(
    HttpApiEndpoint.post("startCheckout")`/checkout/start`
      .addSuccess(CheckoutSession)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getCheckoutDetails")`/checkout/session`
      .addSuccess(CheckoutDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("setAddresses")`/checkout/addresses`
      .setPayload(SetAddressesRequest)
      .addSuccess(CheckoutDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getShippingMethods")`/checkout/shipping-methods`
      .addSuccess(Schema.Array(ShippingMethod))
  )
  .add(
    HttpApiEndpoint.post("setShippingMethod")`/checkout/shipping`
      .setPayload(SetShippingMethodRequest)
      .addSuccess(CheckoutDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("processPayment")`/checkout/payment`
      .setPayload(ProcessPaymentRequest)
      .addSuccess(Schema.Struct({
        paymentIntentId: Schema.String,
        status: Schema.String,
        clientSecret: Schema.optional(Schema.String)
      }))
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("completeCheckout")`/checkout/complete`
      .addSuccess(Schema.Struct({
        orderId: Schema.String,
        orderNumber: Schema.String
      }))
      .addError(Schema.String)
  ) {}

export class CheckoutApi extends HttpApi.make("checkout-api").add(CheckoutGroup) {}
```

### File: `apps/backend/src/http/api/checkout.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { CheckoutApi } from "@turbobun/api/checkout/api"
import { CheckoutService } from "../../services/CheckoutService"
import { CartService } from "../../services/CartService"
import { SessionContext } from "../middleware/session"
import { successResponse, errorResponse } from "../response"

export const CheckoutApiLive = HttpApiBuilder.group(
  CheckoutApi,
  "checkout",
  (handlers) =>
    handlers
      .handle("startCheckout", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          const checkoutService = yield* CheckoutService
          
          // Get current cart
          const cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            return yield* errorResponse(new NotFoundError({
              resource: "Cart",
              id: "session"
            }))
          }
          
          const checkoutSession = yield* checkoutService.startCheckout(cart.id).pipe(
            Effect.catchTag("BusinessError", errorResponse)
          )
          
          return yield* successResponse(checkoutSession)
        })
      )
      .handle("getCheckoutDetails", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const checkoutService = yield* CheckoutService
          
          // Get checkout session from cookie or header
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const details = yield* checkoutService.getCheckoutDetails(checkoutSessionId).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("setAddresses", ({ payload }) =>
        Effect.gen(function* () {
          const checkoutService = yield* CheckoutService
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const details = yield* checkoutService.setAddresses(
            checkoutSessionId,
            payload
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("getShippingMethods", () =>
        Effect.gen(function* () {
          const checkoutService = yield* CheckoutService
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const methods = yield* checkoutService.getShippingMethods(checkoutSessionId)
          
          return yield* successResponse(methods)
        })
      )
      .handle("setShippingMethod", ({ payload }) =>
        Effect.gen(function* () {
          const checkoutService = yield* CheckoutService
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const details = yield* checkoutService.setShippingMethod(
            checkoutSessionId,
            payload.shippingMethodId
          ).pipe(
            Effect.catchTags({
              BusinessError: errorResponse,
              ValidationError: errorResponse
            })
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("processPayment", ({ payload }) =>
        Effect.gen(function* () {
          const checkoutService = yield* CheckoutService
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const paymentIntent = yield* checkoutService.processPayment(
            checkoutSessionId,
            payload
          ).pipe(
            Effect.catchTag("BusinessError", errorResponse)
          )
          
          return yield* successResponse({
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
            clientSecret: paymentIntent.metadata?.clientSecret as string | undefined
          })
        })
      )
      .handle("completeCheckout", () =>
        Effect.gen(function* () {
          const checkoutService = yield* CheckoutService
          const checkoutSessionId = yield* getCheckoutSessionId()
          
          const result = yield* checkoutService.completeCheckout(checkoutSessionId).pipe(
            Effect.catchTag("BusinessError", errorResponse)
          )
          
          return yield* successResponse({
            orderId: result.orderId,
            orderNumber: `ORD-${result.orderId.substring(4, 10).toUpperCase()}`
          })
        })
      )
)

// Helper to get checkout session ID from request
const getCheckoutSessionId = () =>
  Effect.gen(function* () {
    // TODO: Get from cookie or header
    const request = yield* HttpServerRequest.HttpServerRequest
    const checkoutId = request.headers["x-checkout-session"]?.[0]
    
    if (!checkoutId) {
      return yield* Effect.fail(new Error("Checkout session not found"))
    }
    
    return checkoutId
  })
```

## Tests

### File: `apps/backend/src/services/__tests__/CheckoutService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { CheckoutService, CheckoutServiceLive } from "../CheckoutService"
import { CartService, CartServiceLive } from "../CartService"
import { ProductService, ProductServiceLive } from "../ProductService"
import { PaymentServiceLive } from "../PaymentService"
import { TaxServiceLive } from "../TaxService"
// ... other imports

const testLayer = Layer.mergeAll(
  TestDatabaseLive,
  IdServiceLive,
  ConfigServiceLive,
  SessionServiceLive,
  ProductServiceLive,
  CartServiceLive,
  TaxServiceLive,
  PaymentServiceLive,
  CheckoutServiceLive
)

describe("CheckoutService", () => {
  it("should complete full checkout flow", () =>
    Effect.gen(function* () {
      // Setup
      const sessionService = yield* SessionService
      const cartService = yield* CartService
      const productService = yield* ProductService
      const checkoutService = yield* CheckoutService
      
      // Create session and cart
      const session = yield* sessionService.create({})
      const cart = yield* cartService.createCart(session.id)
      
      // Add product
      const product = yield* productService.createProduct({
        name: "Test Product",
        slug: "test-product",
        basePrice: 100,
        variants: [{
          sku: "TEST-001",
          name: "Default",
          attributes: {},
          stock: 10
        }]
      })
      
      yield* cartService.addItem(cart.id, {
        productId: product.product.id,
        variantId: product.variants[0].id,
        quantity: 2
      })
      
      // Set email
      yield* cartService.setEmail(cart.id, "test@example.com")
      
      // Start checkout
      const checkoutSession = yield* checkoutService.startCheckout(cart.id)
      expect(checkoutSession.status).toBe("started")
      
      // Set addresses
      const withAddresses = yield* checkoutService.setAddresses(checkoutSession.id, {
        shipping: {
          firstName: "John",
          lastName: "Doe",
          line1: "123 Main St",
          city: "New York",
          state: "NY",
          postalCode: "10001",
          country: "US",
          phone: "+1234567890"
        },
        billing: "same_as_shipping"
      })
      expect(withAddresses.session.status).toBe("address_set")
      
      // Get shipping methods
      const shippingMethods = yield* checkoutService.getShippingMethods(checkoutSession.id)
      expect(shippingMethods.length).toBeGreaterThan(0)
      
      // Set shipping method
      const withShipping = yield* checkoutService.setShippingMethod(
        checkoutSession.id,
        shippingMethods[0].id
      )
      expect(withShipping.session.status).toBe("shipping_set")
      expect(withShipping.summary.shipping).toBeGreaterThan(0)
      
      // Process payment
      const paymentIntent = yield* checkoutService.processPayment(checkoutSession.id, {
        provider: "mock",
        paymentMethod: {
          type: "mock",
          succeed: true
        }
      })
      expect(paymentIntent.status).toBe("succeeded")
      
      // Complete checkout
      const result = yield* checkoutService.completeCheckout(checkoutSession.id)
      expect(result.orderId).toBeTruthy()
      
      // Verify checkout is completed
      const finalSession = yield* checkoutService.getSession(checkoutSession.id)
      expect(finalSession.status).toBe("completed")
      
      // Verify cart is completed
      const cartStatus = yield* sql`
        SELECT status FROM carts WHERE id = ${cart.id}
      `.pipe(Effect.map(r => r[0].status))
      expect(cartStatus).toBe("completed")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/migrations/0005_checkout_workflow.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS checkout_sessions (
      id TEXT PRIMARY KEY,
      cart_id TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'started',
      email TEXT NOT NULL,
      shipping_address TEXT,
      billing_address TEXT,
      shipping_method_id TEXT,
      shipping_cost DECIMAL(10, 2),
      payment_intent_id TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (cart_id) REFERENCES carts(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS shipping_methods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      base_cost DECIMAL(10, 2) NOT NULL,
      cost_per_kg DECIMAL(10, 2) DEFAULT 0,
      min_days INTEGER NOT NULL,
      max_days INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT true,
      countries TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      checkout_session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_intent_id TEXT UNIQUE,
      amount DECIMAL(10, 2) NOT NULL,
      currency TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (checkout_session_id) REFERENCES checkout_sessions(id)
    )
  `
  
  // Create indexes
  const indexes = [
    "CREATE INDEX idx_checkout_sessions_cart_id ON checkout_sessions(cart_id)",
    "CREATE INDEX idx_checkout_sessions_status ON checkout_sessions(status)",
    "CREATE INDEX idx_checkout_sessions_expires_at ON checkout_sessions(expires_at)",
    "CREATE INDEX idx_payment_intents_checkout_session_id ON payment_intents(checkout_session_id)",
    "CREATE INDEX idx_payment_intents_provider_intent_id ON payment_intents(provider_intent_id)"
  ]
  
  yield* Effect.forEach(
    indexes,
    (idx) => sql.unsafe(idx),
    { concurrency: "unbounded" }
  )
  
  // Insert default shipping methods
  const shippingMethods = [
    {
      id: "ship_standard",
      name: "Standard Shipping",
      description: "5-7 business days",
      base_cost: 5.99,
      cost_per_kg: 0.5,
      min_days: 5,
      max_days: 7,
      countries: JSON.stringify(["US", "CA", "GB", "EU"])
    },
    {
      id: "ship_express",
      name: "Express Shipping",
      description: "2-3 business days",
      base_cost: 15.99,
      cost_per_kg: 1.0,
      min_days: 2,
      max_days: 3,
      countries: JSON.stringify(["US", "CA", "GB", "EU"])
    },
    {
      id: "ship_overnight",
      name: "Overnight Shipping",
      description: "Next business day",
      base_cost: 29.99,
      cost_per_kg: 2.0,
      min_days: 1,
      max_days: 1,
      countries: JSON.stringify(["US"])
    }
  ]
  
  yield* Effect.forEach(
    shippingMethods,
    (method) =>
      sql`
        INSERT INTO shipping_methods (
          id, name, description, base_cost, cost_per_kg,
          min_days, max_days, is_active, countries
        ) VALUES (
          ${method.id}, ${method.name}, ${method.description},
          ${method.base_cost}, ${method.cost_per_kg},
          ${method.min_days}, ${method.max_days}, 1, ${method.countries}
        )
      `,
    { concurrency: "unbounded" }
  )
})
```

## Next Steps

After completing this task:
1. Test the complete checkout flow
2. Verify payment processing (mock)
3. Test address validation
4. Test shipping calculation
5. Move to Task 06: Order Management