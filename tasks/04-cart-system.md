# Task 04: Cart System

## Overview
Implement a session-based cart system that works for both anonymous and authenticated users. Carts persist for 30 days and can be transferred when users log in.

## Database Schema

```sql
-- Carts table
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  customer_id TEXT,
  email TEXT,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'active', -- active, merged, abandoned, completed
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Cart items table
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_at_time DECIMAL(10, 2) NOT NULL, -- Snapshot of price when added
  metadata TEXT, -- JSON for gift message, customization, etc.
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (variant_id) REFERENCES product_variants(id),
  UNIQUE(cart_id, variant_id)
);

-- Cart events for analytics
CREATE TABLE IF NOT EXISTS cart_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- item_added, item_removed, item_updated, cart_viewed, etc.
  event_data TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cart_id) REFERENCES carts(id)
);

-- Indexes
CREATE INDEX idx_carts_session_id ON carts(session_id);
CREATE INDEX idx_carts_customer_id ON carts(customer_id);
CREATE INDEX idx_carts_status ON carts(status);
CREATE INDEX idx_carts_expires_at ON carts(expires_at);
CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX idx_cart_events_cart_id ON cart_events(cart_id);
```

## Effect Schemas

### File: `packages/api/src/cart/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { 
  CartId, CartIdSchema, SessionId, SessionIdSchema, 
  CustomerId, CustomerIdSchema, ProductId, ProductIdSchema,
  VariantId, VariantIdSchema 
} from "../common/id"
import { Product, ProductVariant, ProductImage } from "../product/schemas"

export const CartStatus = Schema.Literal("active", "merged", "abandoned", "completed")
export type CartStatus = Schema.Schema.Type<typeof CartStatus>

export class Cart extends Schema.Class<Cart>("Cart")({
  id: CartIdSchema,
  sessionId: SessionIdSchema,
  customerId: Schema.optional(CustomerIdSchema),
  email: Schema.optional(Schema.String.pipe(Schema.pattern(/.+@.+\..+/))),
  currency: Schema.String.pipe(Schema.length(3)),
  status: CartStatus,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf
}) {}

export class CartItem extends Schema.Class<CartItem>("CartItem")({
  id: Schema.Number,
  cartId: CartIdSchema,
  productId: ProductIdSchema,
  variantId: VariantIdSchema,
  quantity: Schema.Number.pipe(Schema.int(), Schema.positive()),
  priceAtTime: Schema.Number.pipe(Schema.positive()),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  addedAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Extended cart item with product details for responses
export class CartItemWithDetails extends Schema.Class<CartItemWithDetails>("CartItemWithDetails")({
  id: Schema.Number,
  productId: ProductIdSchema,
  variantId: VariantIdSchema,
  product: Schema.Struct({
    name: Schema.String,
    slug: Schema.String,
    images: Schema.Array(ProductImage)
  }),
  variant: Schema.Struct({
    sku: Schema.String,
    name: Schema.String,
    attributes: Schema.Record(Schema.String, Schema.Unknown)
  }),
  quantity: Schema.Number,
  unitPrice: Schema.Number,
  subtotal: Schema.Number,
  priceChanged: Schema.Boolean, // True if current price differs from priceAtTime
  currentPrice: Schema.optional(Schema.Number),
  isAvailable: Schema.Boolean,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
}) {}

export class CartSummary extends Schema.Class<CartSummary>("CartSummary")({
  itemCount: Schema.Number,
  uniqueItems: Schema.Number,
  subtotal: Schema.Number,
  tax: Schema.Number,
  shipping: Schema.Number,
  discount: Schema.Number,
  total: Schema.Number,
  currency: Schema.String
}) {}

export class CartDetails extends Schema.Class<CartDetails>("CartDetails")({
  cart: Cart,
  items: Schema.Array(CartItemWithDetails),
  summary: CartSummary,
  warnings: Schema.optional(Schema.Array(Schema.Struct({
    type: Schema.Literal("price_changed", "out_of_stock", "low_stock"),
    message: Schema.String,
    itemId: Schema.optional(Schema.Number)
  })))
}) {}

// Request schemas
export class AddToCartRequest extends Schema.Class<AddToCartRequest>("AddToCartRequest")({
  productId: ProductIdSchema,
  variantId: VariantIdSchema,
  quantity: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(100))
}) {}

export class UpdateCartItemRequest extends Schema.Class<UpdateCartItemRequest>("UpdateCartItemRequest")({
  quantity: Schema.Number.pipe(Schema.int(), Schema.nonNegative(), Schema.lessThanOrEqualTo(100))
}) {}

export class SetCartEmailRequest extends Schema.Class<SetCartEmailRequest>("SetCartEmailRequest")({
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/))
}) {}

// Cart events
export enum CartEventType {
  Created = "created",
  ItemAdded = "item_added",
  ItemUpdated = "item_updated", 
  ItemRemoved = "item_removed",
  EmailSet = "email_set",
  CustomerLinked = "customer_linked",
  Merged = "merged",
  Abandoned = "abandoned",
  Completed = "completed",
  Recovered = "recovered"
}
```

## Cart Service

### File: `apps/backend/src/services/CartService.ts`
```typescript
import { Context, Effect, Layer, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import { 
  Cart, CartItem, CartDetails, CartItemWithDetails, CartSummary,
  CartStatus, AddToCartRequest, CartEventType
} from "@turbobun/api/cart/schemas"
import { CartId, SessionId, CustomerId, VariantId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { ConfigService } from "./ConfigService"
import { ProductService } from "./ProductService"
import { SessionService } from "./SessionService"
import { NotFoundError, ValidationError, BusinessError } from "@turbobun/api/common/errors"

export class CartService extends Context.Tag("CartService")<
  CartService,
  {
    readonly createCart: (sessionId: SessionId) => Effect.Effect<Cart>
    readonly getCart: (id: CartId) => Effect.Effect<Cart, NotFoundError>
    readonly getCartBySession: (sessionId: SessionId) => Effect.Effect<Cart | null>
    readonly getCartDetails: (id: CartId) => Effect.Effect<CartDetails>
    
    readonly addItem: (
      cartId: CartId,
      request: AddToCartRequest
    ) => Effect.Effect<CartDetails, ValidationError | BusinessError>
    
    readonly updateItem: (
      cartId: CartId,
      itemId: number,
      quantity: number
    ) => Effect.Effect<CartDetails>
    
    readonly removeItem: (
      cartId: CartId,
      itemId: number
    ) => Effect.Effect<CartDetails>
    
    readonly setEmail: (
      cartId: CartId,
      email: string
    ) => Effect.Effect<void>
    
    readonly linkCustomer: (
      cartId: CartId,
      customerId: CustomerId
    ) => Effect.Effect<void>
    
    readonly mergeGuestCart: (
      guestCartId: CartId,
      customerCartId: CartId
    ) => Effect.Effect<CartDetails>
    
    readonly validateCart: (
      cartId: CartId
    ) => Effect.Effect<{ valid: boolean; issues: string[] }>
    
    readonly markCompleted: (cartId: CartId) => Effect.Effect<void>
    readonly cleanup: Effect.Effect<number>
  }
>() {}

export const CartServiceLive = Layer.effect(
  CartService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    const configService = yield* ConfigService
    const productService = yield* ProductService
    const sessionService = yield* SessionService
    
    const cartTtlDays = yield* configService.get("cartTtlDays")
    const maxCartItems = yield* configService.get("maxCartItems")
    
    const trackEvent = (cartId: CartId, eventType: CartEventType, data?: Record<string, unknown>) =>
      sql`
        INSERT INTO cart_events (cart_id, event_type, event_data)
        VALUES (${cartId}, ${eventType}, ${JSON.stringify(data || {})})
      `.pipe(Effect.asUnit)
    
    const createCart = (sessionId: SessionId) =>
      Effect.gen(function* () {
        const id = yield* idService.generateCartId
        const now = new Date()
        const expiresAt = new Date(now.getTime() + cartTtlDays * 24 * 60 * 60 * 1000)
        
        yield* sql`
          INSERT INTO carts (
            id, session_id, currency, status, metadata,
            created_at, updated_at, expires_at
          ) VALUES (
            ${id}, ${sessionId}, 'USD', 'active', '{}',
            ${now}, ${now}, ${expiresAt}
          )
        `
        
        yield* trackEvent(id, CartEventType.Created, { sessionId })
        
        return new Cart({
          id,
          sessionId,
          currency: "USD",
          status: "active",
          metadata: {},
          createdAt: now,
          updatedAt: now,
          expiresAt
        })
      })
    
    const getCart = (id: CartId) =>
      sql`
        SELECT * FROM carts 
        WHERE id = ${id} AND status IN ('active', 'merged')
      `.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Cart({
                ...rows[0],
                metadata: JSON.parse(rows[0].metadata || "{}"),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at),
                expiresAt: new Date(rows[0].expires_at)
              }))
            : Effect.fail(new NotFoundError({ resource: "Cart", id }))
        )
      )
    
    const getCartBySession = (sessionId: SessionId) =>
      sql`
        SELECT * FROM carts 
        WHERE session_id = ${sessionId} 
          AND status = 'active'
          AND expires_at > datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `.pipe(
        Effect.map(rows =>
          rows.length > 0
            ? new Cart({
                ...rows[0],
                metadata: JSON.parse(rows[0].metadata || "{}"),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at),
                expiresAt: new Date(rows[0].expires_at)
              })
            : null
        )
      )
    
    const getCartDetails = (id: CartId) =>
      Effect.gen(function* () {
        const cart = yield* getCart(id)
        
        // Get cart items with product details
        const items = yield* sql`
          SELECT 
            ci.*,
            p.id as product_id, p.name as product_name, p.slug as product_slug,
            v.id as variant_id, v.sku, v.name as variant_name, v.attributes, v.price as variant_price,
            p.base_price,
            i.quantity as stock_quantity, i.reserved_quantity, i.track_inventory, i.allow_backorder
          FROM cart_items ci
          JOIN products p ON ci.product_id = p.id
          JOIN product_variants v ON ci.variant_id = v.id
          LEFT JOIN inventory i ON v.id = i.variant_id
          WHERE ci.cart_id = ${id}
          ORDER BY ci.added_at DESC
        `
        
        // Get product images
        const productIds = [...new Set(items.map(i => i.product_id))]
        const images = productIds.length > 0
          ? yield* sql`
              SELECT * FROM product_images 
              WHERE product_id IN (${productIds})
              ORDER BY sort_order
            `
          : []
        
        const imagesByProduct = images.reduce((acc, img) => {
          if (!acc[img.product_id]) acc[img.product_id] = []
          acc[img.product_id].push(img)
          return acc
        }, {} as Record<string, typeof images>)
        
        // Build cart items with details
        const warnings: Array<{ type: string; message: string; itemId?: number }> = []
        
        const itemsWithDetails = items.map(item => {
          const currentPrice = item.variant_price !== null 
            ? Number(item.variant_price) 
            : Number(item.base_price)
          
          const priceChanged = currentPrice !== Number(item.price_at_time)
          if (priceChanged) {
            warnings.push({
              type: "price_changed",
              message: `Price changed for ${item.product_name} - ${item.variant_name}`,
              itemId: item.id
            })
          }
          
          const availableStock = item.track_inventory 
            ? item.stock_quantity - item.reserved_quantity
            : Number.MAX_SAFE_INTEGER
          
          const isAvailable = item.allow_backorder || availableStock >= item.quantity
          
          if (!isAvailable) {
            warnings.push({
              type: "out_of_stock",
              message: `${item.product_name} - ${item.variant_name} is out of stock`,
              itemId: item.id
            })
          } else if (item.track_inventory && availableStock < 10) {
            warnings.push({
              type: "low_stock",
              message: `Only ${availableStock} left in stock for ${item.product_name} - ${item.variant_name}`,
              itemId: item.id
            })
          }
          
          return new CartItemWithDetails({
            id: item.id,
            productId: item.product_id,
            variantId: item.variant_id,
            product: {
              name: item.product_name,
              slug: item.product_slug,
              images: (imagesByProduct[item.product_id] || []).map(img => ({
                id: img.id,
                productId: img.product_id,
                variantId: img.variant_id,
                url: img.url,
                altText: img.alt_text,
                sortOrder: img.sort_order,
                isPrimary: Boolean(img.is_primary),
                createdAt: new Date(img.created_at)
              }))
            },
            variant: {
              sku: item.sku,
              name: item.variant_name,
              attributes: JSON.parse(item.attributes)
            },
            quantity: item.quantity,
            unitPrice: Number(item.price_at_time),
            subtotal: Number(item.price_at_time) * item.quantity,
            priceChanged,
            currentPrice: priceChanged ? currentPrice : undefined,
            isAvailable,
            metadata: JSON.parse(item.metadata || "{}")
          })
        })
        
        // Calculate summary
        const summary = new CartSummary({
          itemCount: itemsWithDetails.reduce((sum, item) => sum + item.quantity, 0),
          uniqueItems: itemsWithDetails.length,
          subtotal: itemsWithDetails.reduce((sum, item) => sum + item.subtotal, 0),
          tax: 0, // Will be calculated in checkout
          shipping: 0, // Will be calculated in checkout
          discount: 0, // Will be applied in checkout
          total: itemsWithDetails.reduce((sum, item) => sum + item.subtotal, 0),
          currency: cart.currency
        })
        
        return new CartDetails({
          cart,
          items: itemsWithDetails,
          summary,
          warnings: warnings.length > 0 ? warnings : undefined
        })
      })
    
    const addItem = (cartId: CartId, request: AddToCartRequest) =>
      Effect.gen(function* () {
        const cart = yield* getCart(cartId)
        
        // Check cart item limit
        const itemCount = yield* sql`
          SELECT COUNT(*) as count FROM cart_items WHERE cart_id = ${cartId}
        `.pipe(Effect.map(r => r[0].count))
        
        if (itemCount >= maxCartItems) {
          return yield* Effect.fail(new BusinessError({
            code: "CART_LIMIT_EXCEEDED",
            message: `Cart cannot have more than ${maxCartItems} items`
          }))
        }
        
        // Get product and variant details
        const product = yield* productService.getProduct(request.productId)
        const variant = product.variants.find(v => v.id === request.variantId)
        
        if (!variant) {
          return yield* Effect.fail(new ValidationError({
            field: "variantId",
            message: "Invalid variant",
            value: request.variantId
          }))
        }
        
        // Check inventory
        const inventory = product.inventory.find(i => i.variantId === request.variantId)
        if (!inventory || !inventory.isInStock) {
          return yield* Effect.fail(new BusinessError({
            code: "OUT_OF_STOCK",
            message: "Product is out of stock"
          }))
        }
        
        if (inventory.trackInventory && inventory.availableQuantity < request.quantity) {
          return yield* Effect.fail(new BusinessError({
            code: "INSUFFICIENT_STOCK",
            message: `Only ${inventory.availableQuantity} items available`,
            details: { available: inventory.availableQuantity }
          }))
        }
        
        const price = variant.price ?? product.product.basePrice
        const now = new Date()
        
        // Check if item already exists
        const existing = yield* sql`
          SELECT id, quantity FROM cart_items 
          WHERE cart_id = ${cartId} AND variant_id = ${request.variantId}
        `
        
        if (existing.length > 0) {
          // Update quantity
          const newQuantity = existing[0].quantity + request.quantity
          
          if (inventory.trackInventory && inventory.availableQuantity < newQuantity) {
            return yield* Effect.fail(new BusinessError({
              code: "INSUFFICIENT_STOCK",
              message: `Only ${inventory.availableQuantity} items available`,
              details: { available: inventory.availableQuantity }
            }))
          }
          
          yield* sql`
            UPDATE cart_items 
            SET 
              quantity = ${newQuantity},
              updated_at = ${now}
            WHERE id = ${existing[0].id}
          `
        } else {
          // Add new item
          yield* sql`
            INSERT INTO cart_items (
              cart_id, product_id, variant_id, quantity,
              price_at_time, metadata, added_at, updated_at
            ) VALUES (
              ${cartId}, ${request.productId}, ${request.variantId},
              ${request.quantity}, ${price}, '{}', ${now}, ${now}
            )
          `
        }
        
        // Update cart timestamp
        yield* sql`
          UPDATE carts SET updated_at = ${now} WHERE id = ${cartId}
        `
        
        // Track event
        yield* trackEvent(cartId, CartEventType.ItemAdded, {
          productId: request.productId,
          variantId: request.variantId,
          quantity: request.quantity,
          price
        })
        
        // Track in session
        const session = yield* sql`
          SELECT session_id FROM carts WHERE id = ${cartId}
        `.pipe(Effect.map(r => r[0].session_id))
        
        yield* sessionService.trackEvent(
          session,
          "add_to_cart",
          { productId: request.productId, quantity: request.quantity }
        )
        
        return yield* getCartDetails(cartId)
      })
    
    const updateItem = (cartId: CartId, itemId: number, quantity: number) =>
      Effect.gen(function* () {
        const cart = yield* getCart(cartId)
        const now = new Date()
        
        if (quantity === 0) {
          return yield* removeItem(cartId, itemId)
        }
        
        // Get item details for inventory check
        const items = yield* sql`
          SELECT ci.*, i.quantity as stock, i.reserved_quantity, i.track_inventory
          FROM cart_items ci
          JOIN inventory i ON ci.variant_id = i.variant_id
          WHERE ci.id = ${itemId} AND ci.cart_id = ${cartId}
        `
        
        if (items.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "CartItem",
            id: String(itemId)
          }))
        }
        
        const item = items[0]
        const available = item.track_inventory 
          ? item.stock - item.reserved_quantity
          : Number.MAX_SAFE_INTEGER
        
        if (item.track_inventory && available < quantity) {
          return yield* Effect.fail(new BusinessError({
            code: "INSUFFICIENT_STOCK",
            message: `Only ${available} items available`,
            details: { available }
          }))
        }
        
        yield* sql`
          UPDATE cart_items 
          SET quantity = ${quantity}, updated_at = ${now}
          WHERE id = ${itemId}
        `
        
        yield* sql`
          UPDATE carts SET updated_at = ${now} WHERE id = ${cartId}
        `
        
        yield* trackEvent(cartId, CartEventType.ItemUpdated, {
          itemId,
          oldQuantity: item.quantity,
          newQuantity: quantity
        })
        
        return yield* getCartDetails(cartId)
      })
    
    const removeItem = (cartId: CartId, itemId: number) =>
      Effect.gen(function* () {
        const cart = yield* getCart(cartId)
        const now = new Date()
        
        // Get item details for event tracking
        const items = yield* sql`
          SELECT * FROM cart_items 
          WHERE id = ${itemId} AND cart_id = ${cartId}
        `
        
        if (items.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "CartItem",
            id: String(itemId)
          }))
        }
        
        yield* sql`
          DELETE FROM cart_items WHERE id = ${itemId}
        `
        
        yield* sql`
          UPDATE carts SET updated_at = ${now} WHERE id = ${cartId}
        `
        
        yield* trackEvent(cartId, CartEventType.ItemRemoved, {
          itemId,
          productId: items[0].product_id,
          variantId: items[0].variant_id,
          quantity: items[0].quantity
        })
        
        return yield* getCartDetails(cartId)
      })
    
    const setEmail = (cartId: CartId, email: string) =>
      Effect.gen(function* () {
        const now = new Date()
        
        yield* sql`
          UPDATE carts 
          SET email = ${email}, updated_at = ${now}
          WHERE id = ${cartId}
        `
        
        yield* trackEvent(cartId, CartEventType.EmailSet, { email })
      })
    
    const linkCustomer = (cartId: CartId, customerId: CustomerId) =>
      Effect.gen(function* () {
        const now = new Date()
        
        yield* sql`
          UPDATE carts 
          SET customer_id = ${customerId}, updated_at = ${now}
          WHERE id = ${cartId}
        `
        
        yield* trackEvent(cartId, CartEventType.CustomerLinked, { customerId })
      })
    
    const mergeGuestCart = (guestCartId: CartId, customerCartId: CartId) =>
      Effect.gen(function* () {
        // Get items from guest cart
        const guestItems = yield* sql`
          SELECT * FROM cart_items WHERE cart_id = ${guestCartId}
        `
        
        // Merge items into customer cart
        yield* Effect.forEach(
          guestItems,
          (item) =>
            sql`
              INSERT INTO cart_items (
                cart_id, product_id, variant_id, quantity,
                price_at_time, metadata, added_at, updated_at
              ) VALUES (
                ${customerCartId}, ${item.product_id}, ${item.variant_id},
                ${item.quantity}, ${item.price_at_time}, ${item.metadata},
                ${item.added_at}, CURRENT_TIMESTAMP
              )
              ON CONFLICT (cart_id, variant_id) DO UPDATE SET
                quantity = cart_items.quantity + ${item.quantity},
                updated_at = CURRENT_TIMESTAMP
            `,
          { concurrency: "unbounded" }
        )
        
        // Mark guest cart as merged
        yield* sql`
          UPDATE carts 
          SET status = 'merged', updated_at = CURRENT_TIMESTAMP
          WHERE id = ${guestCartId}
        `
        
        yield* trackEvent(customerCartId, CartEventType.Merged, {
          guestCartId,
          itemsMerged: guestItems.length
        })
        
        return yield* getCartDetails(customerCartId)
      })
    
    const validateCart = (cartId: CartId) =>
      Effect.gen(function* () {
        const details = yield* getCartDetails(cartId)
        const issues: string[] = []
        
        if (details.items.length === 0) {
          issues.push("Cart is empty")
        }
        
        details.items.forEach(item => {
          if (!item.isAvailable) {
            issues.push(`${item.product.name} - ${item.variant.name} is out of stock`)
          }
          if (item.priceChanged) {
            issues.push(`Price changed for ${item.product.name} - ${item.variant.name}`)
          }
        })
        
        if (!details.cart.email) {
          issues.push("Email address is required")
        }
        
        return { valid: issues.length === 0, issues }
      })
    
    const markCompleted = (cartId: CartId) =>
      Effect.gen(function* () {
        yield* sql`
          UPDATE carts 
          SET status = 'completed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ${cartId}
        `
        
        yield* trackEvent(cartId, CartEventType.Completed)
      })
    
    const cleanup = sql`
      DELETE FROM carts 
      WHERE 
        (expires_at < datetime('now') AND status = 'active')
        OR (status = 'merged' AND updated_at < datetime('now', '-7 days'))
    `.pipe(
      Effect.map(result => result.rowsAffected)
    )
    
    return CartService.of({
      createCart,
      getCart,
      getCartBySession,
      getCartDetails,
      addItem,
      updateItem,
      removeItem,
      setEmail,
      linkCustomer,
      mergeGuestCart,
      validateCart,
      markCompleted,
      cleanup
    })
  })
)

// Background cleanup task
export const CartCleanupLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const cartService = yield* CartService
    
    // Run cleanup every hour
    yield* cartService.cleanup.pipe(
      Effect.tap(count =>
        Effect.log(`Cleaned up ${count} expired carts`)
      ),
      Effect.repeat(Schedule.fixed("1 hour")),
      Effect.forkDaemon
    )
  })
)
```

## Cart Recovery Service

### File: `apps/backend/src/services/CartRecoveryService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { CartService } from "./CartService"
import { SessionRecoveryService } from "./SessionRecoveryService"
import { EmailService } from "./EmailService"
import { Cart, CartDetails } from "@turbobun/api/cart/schemas"
import { SessionId } from "@turbobun/api/common/id"

export class CartRecoveryService extends Context.Tag("CartRecoveryService")<
  CartRecoveryService,
  {
    readonly findAbandonedCarts: (hours?: number) => Effect.Effect<Cart[]>
    readonly sendRecoveryEmail: (cart: Cart) => Effect.Effect<void>
    readonly recoverCartForSession: (
      sessionId: SessionId,
      fingerprint?: string
    ) => Effect.Effect<Cart | null>
  }
>() {}

export const CartRecoveryServiceLive = Layer.effect(
  CartRecoveryService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const cartService = yield* CartService
    const sessionRecoveryService = yield* SessionRecoveryService
    const emailService = yield* EmailService
    
    const findAbandonedCarts = (hours = 24) =>
      Effect.gen(function* () {
        const threshold = new Date(Date.now() - hours * 60 * 60 * 1000)
        
        const rows = yield* sql`
          SELECT c.* FROM carts c
          JOIN cart_items ci ON c.id = ci.cart_id
          WHERE 
            c.status = 'active'
            AND c.email IS NOT NULL
            AND c.updated_at < ${threshold}
            AND c.expires_at > datetime('now')
            AND NOT EXISTS (
              SELECT 1 FROM cart_events ce 
              WHERE ce.cart_id = c.id 
                AND ce.event_type = 'recovery_email_sent'
                AND ce.created_at > datetime('now', '-7 days')
            )
          GROUP BY c.id
          HAVING COUNT(ci.id) > 0
          LIMIT 100
        `
        
        return rows.map(row => new Cart({
          ...row,
          metadata: JSON.parse(row.metadata || "{}"),
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          expiresAt: new Date(row.expires_at)
        }))
      })
    
    const sendRecoveryEmail = (cart: Cart) =>
      Effect.gen(function* () {
        if (!cart.email) return
        
        const details = yield* cartService.getCartDetails(cart.id)
        
        yield* emailService.send({
          to: cart.email,
          subject: "You left items in your cart",
          template: "cart-recovery",
          data: {
            cartId: cart.id,
            items: details.items,
            total: details.summary.total,
            recoveryUrl: `${process.env.FRONTEND_URL}/cart/recover?id=${cart.id}`
          }
        })
        
        // Track email sent
        yield* sql`
          INSERT INTO cart_events (cart_id, event_type, event_data)
          VALUES (${cart.id}, 'recovery_email_sent', '{}')
        `
      })
    
    const recoverCartForSession = (sessionId: SessionId, fingerprint?: string) =>
      Effect.gen(function* () {
        // First try direct session lookup
        const directCart = yield* cartService.getCartBySession(sessionId)
        if (directCart) return directCart
        
        if (!fingerprint) return null
        
        // Try to find similar sessions
        const similarSessions = yield* sessionRecoveryService.findSimilarSessions(
          fingerprint,
          0.8
        )
        
        // Look for carts in similar sessions
        for (const session of similarSessions) {
          const cart = yield* cartService.getCartBySession(session.id)
          if (cart && cart.status === "active") {
            // Update cart to new session
            yield* sql`
              UPDATE carts 
              SET session_id = ${sessionId}
              WHERE id = ${cart.id}
            `
            
            yield* sql`
              INSERT INTO cart_events (cart_id, event_type, event_data)
              VALUES (${cart.id}, 'recovered', ${JSON.stringify({
                oldSessionId: session.id,
                newSessionId: sessionId,
                fingerprint
              })})
            `
            
            return { ...cart, sessionId }
          }
        }
        
        return null
      })
    
    return CartRecoveryService.of({
      findAbandonedCarts,
      sendRecoveryEmail,
      recoverCartForSession
    })
  })
)
```

## Cart API

### File: `packages/api/src/cart/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { 
  CartDetails, AddToCartRequest, UpdateCartItemRequest, 
  SetCartEmailRequest 
} from "./schemas"

class CartGroup extends HttpApiGroup.make("cart")
  .add(
    HttpApiEndpoint.get("getCart")`/cart`
      .addSuccess(CartDetails)
  )
  .add(
    HttpApiEndpoint.put("addToCart")`/cart/items`
      .setPayload(AddToCartRequest)
      .addSuccess(CartDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.patch("updateCartItem")`/cart/items/${Schema.Number("itemId")}`
      .setPayload(UpdateCartItemRequest)
      .addSuccess(CartDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.delete("removeCartItem")`/cart/items/${Schema.Number("itemId")}`
      .addSuccess(CartDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.put("setCartEmail")`/cart/email`
      .setPayload(SetCartEmailRequest)
      .addSuccess(Schema.Void)
  )
  .add(
    HttpApiEndpoint.post("validateCart")`/cart/validate`
      .addSuccess(Schema.Struct({
        valid: Schema.Boolean,
        issues: Schema.Array(Schema.String)
      }))
  ) {}

export class CartApi extends HttpApi.make("cart-api").add(CartGroup) {}
```

### File: `apps/backend/src/http/api/cart.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { CartApi } from "@turbobun/api/cart/api"
import { CartService } from "../../services/CartService"
import { SessionContext } from "../middleware/session"
import { successResponse, errorResponse } from "../response"

export const CartApiLive = HttpApiBuilder.group(
  CartApi,
  "cart",
  (handlers) =>
    handlers
      .handle("getCart", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          // Get or create cart for session
          let cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            cart = yield* cartService.createCart(session.id)
          }
          
          const details = yield* cartService.getCartDetails(cart.id)
          return yield* successResponse(details)
        })
      )
      .handle("addToCart", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          // Get or create cart
          let cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            cart = yield* cartService.createCart(session.id)
          }
          
          const details = yield* cartService.addItem(cart.id, payload).pipe(
            Effect.catchTags({
              ValidationError: errorResponse,
              BusinessError: errorResponse
            })
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("updateCartItem", ({ path, payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          const cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            return yield* errorResponse(new NotFoundError({
              resource: "Cart",
              id: "session"
            }))
          }
          
          const details = yield* cartService.updateItem(
            cart.id,
            path.itemId,
            payload.quantity
          ).pipe(
            Effect.catchTags({
              NotFoundError: errorResponse,
              BusinessError: errorResponse
            })
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("removeCartItem", ({ path }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          const cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            return yield* errorResponse(new NotFoundError({
              resource: "Cart",
              id: "session"
            }))
          }
          
          const details = yield* cartService.removeItem(cart.id, path.itemId).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(details)
        })
      )
      .handle("setCartEmail", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          const cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            return yield* errorResponse(new NotFoundError({
              resource: "Cart",
              id: "session"
            }))
          }
          
          yield* cartService.setEmail(cart.id, payload.email)
          return yield* successResponse(undefined)
        })
      )
      .handle("validateCart", () =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const cartService = yield* CartService
          
          const cart = yield* cartService.getCartBySession(session.id)
          if (!cart) {
            return yield* successResponse({ valid: false, issues: ["No cart found"] })
          }
          
          const validation = yield* cartService.validateCart(cart.id)
          return yield* successResponse(validation)
        })
      )
)
```

## Tests

### File: `apps/backend/src/services/__tests__/CartService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { CartService, CartServiceLive } from "../CartService"
import { ProductService, ProductServiceLive } from "../ProductService"
import { SessionService, SessionServiceLive } from "../SessionService"
import { IdServiceLive } from "../IdService"
import { ConfigServiceLive } from "../ConfigService"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { CartEventType } from "@turbobun/api/cart/schemas"

const TestDatabaseLive = SqliteClient.layer({
  filename: ":memory:"
})

const testLayer = Layer.mergeAll(
  TestDatabaseLive,
  IdServiceLive,
  ConfigServiceLive,
  SessionServiceLive,
  ProductServiceLive,
  CartServiceLive
)

describe("CartService", () => {
  // ... test setup
  
  it("should add items to cart", () =>
    Effect.gen(function* () {
      const cartService = yield* CartService
      const productService = yield* ProductService
      const sessionService = yield* SessionService
      
      // Create session
      const session = yield* sessionService.create({})
      
      // Create product
      const product = yield* productService.createProduct({
        name: "Test Product",
        slug: "test-product",
        basePrice: 50,
        variants: [{
          sku: "TEST-001",
          name: "Default",
          attributes: {},
          stock: 10
        }]
      })
      
      // Create cart
      const cart = yield* cartService.createCart(session.id)
      
      // Add item
      const details = yield* cartService.addItem(cart.id, {
        productId: product.product.id,
        variantId: product.variants[0].id,
        quantity: 2
      })
      
      expect(details.items).toHaveLength(1)
      expect(details.items[0].quantity).toBe(2)
      expect(details.summary.itemCount).toBe(2)
      expect(details.summary.subtotal).toBe(100)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should merge guest cart into customer cart", () =>
    Effect.gen(function* () {
      const cartService = yield* CartService
      const productService = yield* ProductService
      const sessionService = yield* SessionService
      
      // Create guest session and cart
      const guestSession = yield* sessionService.create({})
      const guestCart = yield* cartService.createCart(guestSession.id)
      
      // Create customer session and cart
      const customerSession = yield* sessionService.create({})
      const customerCart = yield* cartService.createCart(customerSession.id)
      
      // Create products
      const product1 = yield* productService.createProduct({
        name: "Product 1",
        slug: "product-1",
        basePrice: 50,
        variants: [{ sku: "P1", name: "Default", attributes: {}, stock: 10 }]
      })
      
      const product2 = yield* productService.createProduct({
        name: "Product 2",
        slug: "product-2",
        basePrice: 30,
        variants: [{ sku: "P2", name: "Default", attributes: {}, stock: 10 }]
      })
      
      // Add items to both carts
      yield* cartService.addItem(guestCart.id, {
        productId: product1.product.id,
        variantId: product1.variants[0].id,
        quantity: 2
      })
      
      yield* cartService.addItem(customerCart.id, {
        productId: product2.product.id,
        variantId: product2.variants[0].id,
        quantity: 1
      })
      
      // Merge carts
      const merged = yield* cartService.mergeGuestCart(guestCart.id, customerCart.id)
      
      expect(merged.items).toHaveLength(2)
      expect(merged.summary.itemCount).toBe(3)
      expect(merged.summary.subtotal).toBe(130) // 2*50 + 1*30
      
      // Verify guest cart is marked as merged
      const guestCartStatus = yield* sql`
        SELECT status FROM carts WHERE id = ${guestCart.id}
      `.pipe(Effect.map(r => r[0].status))
      
      expect(guestCartStatus).toBe("merged")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should validate cart correctly", () =>
    Effect.gen(function* () {
      const cartService = yield* CartService
      const productService = yield* ProductService
      const sessionService = yield* SessionService
      
      const session = yield* sessionService.create({})
      const cart = yield* cartService.createCart(session.id)
      
      // Empty cart should be invalid
      const emptyValidation = yield* cartService.validateCart(cart.id)
      expect(emptyValidation.valid).toBe(false)
      expect(emptyValidation.issues).toContain("Cart is empty")
      
      // Add product
      const product = yield* productService.createProduct({
        name: "Test",
        slug: "test",
        basePrice: 50,
        variants: [{ sku: "T1", name: "Default", attributes: {}, stock: 1 }]
      })
      
      yield* cartService.addItem(cart.id, {
        productId: product.product.id,
        variantId: product.variants[0].id,
        quantity: 1
      })
      
      // Cart without email should be invalid
      const noEmailValidation = yield* cartService.validateCart(cart.id)
      expect(noEmailValidation.valid).toBe(false)
      expect(noEmailValidation.issues).toContain("Email address is required")
      
      // Set email
      yield* cartService.setEmail(cart.id, "test@example.com")
      
      // Now should be valid
      const validValidation = yield* cartService.validateCart(cart.id)
      expect(validValidation.valid).toBe(true)
      expect(validValidation.issues).toHaveLength(0)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/migrations/0004_cart_system.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      customer_id TEXT,
      email TEXT,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'active',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_at_time DECIMAL(10, 2) NOT NULL,
      metadata TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id),
      UNIQUE(cart_id, variant_id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS cart_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cart_id) REFERENCES carts(id)
    )
  `
  
  // Create indexes
  const indexes = [
    "CREATE INDEX idx_carts_session_id ON carts(session_id)",
    "CREATE INDEX idx_carts_customer_id ON carts(customer_id)",
    "CREATE INDEX idx_carts_status ON carts(status)",
    "CREATE INDEX idx_carts_expires_at ON carts(expires_at)",
    "CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id)",
    "CREATE INDEX idx_cart_events_cart_id ON cart_events(cart_id)"
  ]
  
  yield* Effect.forEach(
    indexes,
    (idx) => sql.unsafe(idx),
    { concurrency: "unbounded" }
  )
})
```

## Next Steps

After completing this task:
1. Test cart operations through the API
2. Verify session-based cart persistence
3. Test cart recovery with fingerprinting
4. Test cart merging on login
5. Move to Task 05: Checkout Workflow