# Task 06: Order Management

## Overview
Implement order creation from completed checkouts, order tracking, and order history. Orders can be created by guests (tracked by email) or authenticated customers.

## Database Schema

```sql
-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  guest_email TEXT,
  status TEXT DEFAULT 'pending', -- pending, processing, shipped, delivered, cancelled, refunded
  payment_status TEXT DEFAULT 'pending', -- pending, paid, partially_refunded, refunded
  fulfillment_status TEXT DEFAULT 'unfulfilled', -- unfulfilled, partially_fulfilled, fulfilled
  
  -- Addresses
  shipping_address TEXT NOT NULL, -- JSON
  billing_address TEXT NOT NULL, -- JSON
  
  -- Amounts
  subtotal DECIMAL(10, 2) NOT NULL,
  shipping_cost DECIMAL(10, 2) NOT NULL,
  tax_amount DECIMAL(10, 2) NOT NULL,
  discount_amount DECIMAL(10, 2) DEFAULT 0,
  total_amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  
  -- References
  cart_id TEXT NOT NULL,
  checkout_session_id TEXT NOT NULL,
  
  -- Metadata
  notes TEXT,
  metadata TEXT, -- JSON
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (cart_id) REFERENCES carts(id),
  FOREIGN KEY (checkout_session_id) REFERENCES checkout_sessions(id)
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  
  -- Snapshot of product info at time of order
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  
  -- Fulfillment
  fulfilled_quantity INTEGER DEFAULT 0,
  refunded_quantity INTEGER DEFAULT 0,
  
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (variant_id) REFERENCES product_variants(id)
);

-- Order events table for history tracking
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- status_changed, payment_received, item_fulfilled, note_added, etc.
  event_data TEXT, -- JSON
  user_id TEXT, -- Who triggered the event (customer, admin, system)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Fulfillments table
CREATE TABLE IF NOT EXISTS fulfillments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, shipped, delivered, returned
  tracking_number TEXT,
  carrier TEXT,
  shipped_at DATETIME,
  delivered_at DATETIME,
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Fulfillment items
CREATE TABLE IF NOT EXISTS fulfillment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fulfillment_id TEXT NOT NULL,
  order_item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY (fulfillment_id) REFERENCES fulfillments(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);

-- Indexes
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_guest_email ON orders(guest_email);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_events_order_id ON order_events(order_id);
CREATE INDEX idx_fulfillments_order_id ON fulfillments(order_id);
```

## Effect Schemas

### File: `packages/api/src/order/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { 
  OrderId, OrderIdSchema, CustomerId, CustomerIdSchema,
  CartId, CartIdSchema, ProductId, ProductIdSchema,
  VariantId, VariantIdSchema
} from "../common/id"
import { Address } from "../checkout/schemas"

// Order status enums
export const OrderStatus = Schema.Literal(
  "pending", "processing", "shipped", "delivered", "cancelled", "refunded"
)
export type OrderStatus = Schema.Schema.Type<typeof OrderStatus>

export const PaymentStatus = Schema.Literal(
  "pending", "paid", "partially_refunded", "refunded"
)
export type PaymentStatus = Schema.Schema.Type<typeof PaymentStatus>

export const FulfillmentStatus = Schema.Literal(
  "unfulfilled", "partially_fulfilled", "fulfilled"
)
export type FulfillmentStatus = Schema.Schema.Type<typeof FulfillmentStatus>

// Order schema
export class Order extends Schema.Class<Order>("Order")({
  id: OrderIdSchema,
  orderNumber: Schema.String,
  customerId: Schema.optional(CustomerIdSchema),
  guestEmail: Schema.optional(Schema.String),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  
  shippingAddress: Address,
  billingAddress: Address,
  
  subtotal: Schema.Number,
  shippingCost: Schema.Number,
  taxAmount: Schema.Number,
  discountAmount: Schema.Number,
  totalAmount: Schema.Number,
  currency: Schema.String,
  
  cartId: CartIdSchema,
  checkoutSessionId: Schema.String,
  
  notes: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Order item schema
export class OrderItem extends Schema.Class<OrderItem>("OrderItem")({
  id: Schema.Number,
  orderId: OrderIdSchema,
  productId: ProductIdSchema,
  variantId: VariantIdSchema,
  
  productName: Schema.String,
  variantName: Schema.String,
  sku: Schema.String,
  
  quantity: Schema.Number,
  unitPrice: Schema.Number,
  subtotal: Schema.Number,
  
  fulfilledQuantity: Schema.Number,
  refundedQuantity: Schema.Number,
  
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf
}) {}

// Order with items
export class OrderWithItems extends Schema.Class<OrderWithItems>("OrderWithItems")({
  order: Order,
  items: Schema.Array(OrderItem)
}) {}

// Order event types
export enum OrderEventType {
  Created = "created",
  StatusChanged = "status_changed",
  PaymentReceived = "payment_received",
  PaymentFailed = "payment_failed",
  ItemFulfilled = "item_fulfilled",
  ShippingInfoAdded = "shipping_info_added",
  Delivered = "delivered",
  Cancelled = "cancelled",
  RefundInitiated = "refund_initiated",
  RefundCompleted = "refund_completed",
  NoteAdded = "note_added"
}

export class OrderEvent extends Schema.Class<OrderEvent>("OrderEvent")({
  id: Schema.Number,
  orderId: OrderIdSchema,
  eventType: Schema.Enums(OrderEventType),
  eventData: Schema.Record(Schema.String, Schema.Unknown),
  userId: Schema.optional(Schema.String),
  createdAt: Schema.DateFromSelf
}) {}

// Fulfillment schemas
export class Fulfillment extends Schema.Class<Fulfillment>("Fulfillment")({
  id: Schema.String,
  orderId: OrderIdSchema,
  status: Schema.Literal("pending", "shipped", "delivered", "returned"),
  trackingNumber: Schema.optional(Schema.String),
  carrier: Schema.optional(Schema.String),
  shippedAt: Schema.optional(Schema.DateFromSelf),
  deliveredAt: Schema.optional(Schema.DateFromSelf),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Request schemas
export class CreateOrderFromCheckoutRequest extends Schema.Class<CreateOrderFromCheckoutRequest>("CreateOrderFromCheckoutRequest")({
  checkoutSessionId: Schema.String,
  notes: Schema.optional(Schema.String)
}) {}

export class TrackOrderRequest extends Schema.Class<TrackOrderRequest>("TrackOrderRequest")({
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/)),
  orderNumber: Schema.String
}) {}

export class UpdateOrderStatusRequest extends Schema.Class<UpdateOrderStatusRequest>("UpdateOrderStatusRequest")({
  status: OrderStatus,
  notes: Schema.optional(Schema.String),
  notifyCustomer: Schema.Boolean.pipe(Schema.optional)
}) {}

export class CreateFulfillmentRequest extends Schema.Class<CreateFulfillmentRequest>("CreateFulfillmentRequest")({
  items: Schema.Array(Schema.Struct({
    orderItemId: Schema.Number,
    quantity: Schema.Number
  })),
  trackingNumber: Schema.optional(Schema.String),
  carrier: Schema.optional(Schema.String),
  notifyCustomer: Schema.Boolean.pipe(Schema.optional)
}) {}

// Response schemas
export class OrderSummary extends Schema.Class<OrderSummary>("OrderSummary")({
  id: OrderIdSchema,
  orderNumber: Schema.String,
  status: OrderStatus,
  totalAmount: Schema.Number,
  currency: Schema.String,
  itemCount: Schema.Number,
  createdAt: Schema.DateFromSelf
}) {}

export class OrderTrackingInfo extends Schema.Class<OrderTrackingInfo>("OrderTrackingInfo")({
  orderNumber: Schema.String,
  status: OrderStatus,
  estimatedDelivery: Schema.optional(Schema.DateFromSelf),
  fulfillments: Schema.Array(Fulfillment),
  events: Schema.Array(OrderEvent)
}) {}
```

## Order Service

### File: `apps/backend/src/services/OrderService.ts`
```typescript
import { Context, Effect, Layer, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import { 
  Order, OrderItem, OrderWithItems, OrderStatus, PaymentStatus,
  FulfillmentStatus, OrderEventType, Fulfillment, OrderSummary,
  OrderTrackingInfo
} from "@turbobun/api/order/schemas"
import { OrderId, CustomerId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { CheckoutService } from "./CheckoutService"
import { CartService } from "./CartService"
import { ProductService } from "./ProductService"
import { EmailService } from "./EmailService"
import { NotFoundError, BusinessError } from "@turbobun/api/common/errors"

export class OrderService extends Context.Tag("OrderService")<
  OrderService,
  {
    readonly createFromCheckout: (
      checkoutSessionId: string,
      notes?: string
    ) => Effect.Effect<OrderWithItems, BusinessError>
    
    readonly getOrder: (id: OrderId) => Effect.Effect<OrderWithItems, NotFoundError>
    readonly getOrderByNumber: (orderNumber: string) => Effect.Effect<OrderWithItems, NotFoundError>
    
    readonly listOrders: (params: {
      customerId?: CustomerId
      email?: string
      status?: OrderStatus
      page?: number
      pageSize?: number
    }) => Effect.Effect<{ data: OrderSummary[]; total: number }>
    
    readonly trackOrder: (
      email: string,
      orderNumber: string
    ) => Effect.Effect<OrderTrackingInfo, NotFoundError>
    
    readonly updateStatus: (
      id: OrderId,
      status: OrderStatus,
      notes?: string,
      userId?: string
    ) => Effect.Effect<void>
    
    readonly createFulfillment: (
      orderId: OrderId,
      items: Array<{ orderItemId: number; quantity: number }>,
      tracking?: { trackingNumber?: string; carrier?: string }
    ) => Effect.Effect<Fulfillment>
    
    readonly addEvent: (
      orderId: OrderId,
      eventType: OrderEventType,
      eventData: Record<string, unknown>,
      userId?: string
    ) => Effect.Effect<void>
    
    readonly cancelOrder: (
      id: OrderId,
      reason: string,
      userId?: string
    ) => Effect.Effect<void, BusinessError>
  }
>() {}

export const OrderServiceLive = Layer.effect(
  OrderService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    const checkoutService = yield* CheckoutService
    const cartService = yield* CartService
    const productService = yield* ProductService
    const emailService = yield* EmailService
    
    const generateOrderNumber = () =>
      Effect.sync(() => {
        const date = new Date()
        const year = date.getFullYear().toString().slice(-2)
        const month = (date.getMonth() + 1).toString().padStart(2, "0")
        const random = Math.random().toString(36).substring(2, 6).toUpperCase()
        return `ORD-${year}${month}-${random}`
      })
    
    const createFromCheckout = (checkoutSessionId: string, notes?: string) =>
      Effect.gen(function* () {
        // Get checkout details
        const checkoutDetails = yield* checkoutService.getCheckoutDetails(checkoutSessionId)
        const session = checkoutDetails.session
        
        if (session.status !== "payment_set") {
          return yield* Effect.fail(new BusinessError({
            code: "CHECKOUT_INCOMPLETE",
            message: "Checkout must be completed before creating order"
          }))
        }
        
        // Get cart details
        const cartDetails = yield* cartService.getCartDetails(session.cartId)
        
        // Generate order ID and number
        const orderId = yield* idService.generateOrderId
        const orderNumber = yield* generateOrderNumber()
        const now = new Date()
        
        // Get billing address
        const billingAddress = session.billingAddress === "same_as_shipping"
          ? session.shippingAddress!
          : session.billingAddress!
        
        // Create order
        yield* sql`
          INSERT INTO orders (
            id, order_number, customer_id, guest_email,
            status, payment_status, fulfillment_status,
            shipping_address, billing_address,
            subtotal, shipping_cost, tax_amount, discount_amount, total_amount,
            currency, cart_id, checkout_session_id,
            notes, metadata, created_at, updated_at
          ) VALUES (
            ${orderId}, ${orderNumber}, ${cartDetails.cart.customerId || null},
            ${cartDetails.cart.email}, 'pending', 'paid', 'unfulfilled',
            ${JSON.stringify(session.shippingAddress)},
            ${JSON.stringify(billingAddress)},
            ${checkoutDetails.summary.subtotal}, ${checkoutDetails.summary.shipping},
            ${checkoutDetails.summary.tax}, ${checkoutDetails.summary.discount},
            ${checkoutDetails.summary.total}, ${checkoutDetails.summary.currency},
            ${session.cartId}, ${checkoutSessionId},
            ${notes || null}, '{}', ${now}, ${now}
          )
        `
        
        // Create order items
        const orderItems = yield* Effect.forEach(
          cartDetails.items,
          (cartItem, index) =>
            Effect.gen(function* () {
              const subtotal = cartItem.unitPrice * cartItem.quantity
              
              yield* sql`
                INSERT INTO order_items (
                  order_id, product_id, variant_id,
                  product_name, variant_name, sku,
                  quantity, unit_price, subtotal,
                  fulfilled_quantity, refunded_quantity,
                  metadata, created_at
                ) VALUES (
                  ${orderId}, ${cartItem.productId}, ${cartItem.variantId},
                  ${cartItem.product.name}, ${cartItem.variant.name}, ${cartItem.variant.sku},
                  ${cartItem.quantity}, ${cartItem.unitPrice}, ${subtotal},
                  0, 0, ${JSON.stringify(cartItem.metadata || {})}, ${now}
                )
              `
              
              const result = yield* sql`SELECT last_insert_rowid() as id`
              
              return new OrderItem({
                id: result[0].id,
                orderId,
                productId: cartItem.productId,
                variantId: cartItem.variantId,
                productName: cartItem.product.name,
                variantName: cartItem.variant.name,
                sku: cartItem.variant.sku,
                quantity: cartItem.quantity,
                unitPrice: cartItem.unitPrice,
                subtotal,
                fulfilledQuantity: 0,
                refundedQuantity: 0,
                metadata: cartItem.metadata,
                createdAt: now
              })
            }),
          { concurrency: "unbounded" }
        )
        
        // Add order created event
        yield* addEvent(orderId, OrderEventType.Created, {
          orderNumber,
          totalAmount: checkoutDetails.summary.total,
          itemCount: cartDetails.items.length
        })
        
        // Mark cart and checkout as completed
        yield* cartService.markCompleted(session.cartId)
        yield* checkoutService.completeCheckout(checkoutSessionId)
        
        // Deduct inventory
        yield* Effect.forEach(
          cartDetails.items,
          (item) =>
            productService.updateInventory(
              item.variantId,
              -item.quantity
            ),
          { concurrency: "unbounded" }
        )
        
        const order = new Order({
          id: orderId,
          orderNumber,
          customerId: cartDetails.cart.customerId,
          guestEmail: cartDetails.cart.email,
          status: "pending",
          paymentStatus: "paid",
          fulfillmentStatus: "unfulfilled",
          shippingAddress: session.shippingAddress!,
          billingAddress,
          subtotal: checkoutDetails.summary.subtotal,
          shippingCost: checkoutDetails.summary.shipping,
          taxAmount: checkoutDetails.summary.tax,
          discountAmount: checkoutDetails.summary.discount,
          totalAmount: checkoutDetails.summary.total,
          currency: checkoutDetails.summary.currency,
          cartId: session.cartId,
          checkoutSessionId,
          notes,
          metadata: {},
          createdAt: now,
          updatedAt: now
        })
        
        // Send confirmation email
        yield* emailService.sendOrderConfirmation({
          email: cartDetails.cart.email!,
          order,
          items: orderItems
        }).pipe(
          Effect.catchAll(() => Effect.unit) // Don't fail if email fails
        )
        
        return new OrderWithItems({ order, items: orderItems })
      })
    
    const getOrder = (id: OrderId) =>
      Effect.gen(function* () {
        const orders = yield* sql`
          SELECT * FROM orders WHERE id = ${id}
        `
        
        if (orders.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Order",
            id
          }))
        }
        
        const orderRow = orders[0]
        
        const items = yield* sql`
          SELECT * FROM order_items WHERE order_id = ${id}
          ORDER BY id
        `
        
        const order = new Order({
          ...orderRow,
          shippingAddress: JSON.parse(orderRow.shipping_address),
          billingAddress: JSON.parse(orderRow.billing_address),
          subtotal: Number(orderRow.subtotal),
          shippingCost: Number(orderRow.shipping_cost),
          taxAmount: Number(orderRow.tax_amount),
          discountAmount: Number(orderRow.discount_amount),
          totalAmount: Number(orderRow.total_amount),
          metadata: JSON.parse(orderRow.metadata || "{}"),
          createdAt: new Date(orderRow.created_at),
          updatedAt: new Date(orderRow.updated_at)
        })
        
        const orderItems = items.map(item => new OrderItem({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          fulfilledQuantity: Number(item.fulfilled_quantity),
          refundedQuantity: Number(item.refunded_quantity),
          metadata: JSON.parse(item.metadata || "{}"),
          createdAt: new Date(item.created_at)
        }))
        
        return new OrderWithItems({ order, items: orderItems })
      })
    
    const getOrderByNumber = (orderNumber: string) =>
      Effect.gen(function* () {
        const orders = yield* sql`
          SELECT id FROM orders WHERE order_number = ${orderNumber}
        `
        
        if (orders.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Order",
            id: orderNumber
          }))
        }
        
        return yield* getOrder(orders[0].id)
      })
    
    const listOrders = (params: Parameters<OrderService["listOrders"]>[0]) =>
      Effect.gen(function* () {
        const page = params.page || 1
        const pageSize = params.pageSize || 20
        const offset = (page - 1) * pageSize
        
        // Build query conditions
        const conditions: string[] = []
        const values: unknown[] = []
        
        if (params.customerId) {
          conditions.push("customer_id = ?")
          values.push(params.customerId)
        }
        
        if (params.email) {
          conditions.push("(guest_email = ? OR customer_id IN (SELECT id FROM customers WHERE email = ?))")
          values.push(params.email, params.email)
        }
        
        if (params.status) {
          conditions.push("status = ?")
          values.push(params.status)
        }
        
        const whereClause = conditions.length > 0 
          ? `WHERE ${conditions.join(" AND ")}`
          : ""
        
        // Count total
        const countQuery = `SELECT COUNT(*) as total FROM orders ${whereClause}`
        const countResult = yield* Effect.tryPromise(() =>
          sql.unsafe(countQuery, values)
        )
        const total = countResult[0].total
        
        // Get orders
        const ordersQuery = `
          SELECT 
            o.id, o.order_number, o.status, o.total_amount, o.currency, o.created_at,
            COUNT(oi.id) as item_count
          FROM orders o
          LEFT JOIN order_items oi ON o.id = oi.order_id
          ${whereClause}
          GROUP BY o.id
          ORDER BY o.created_at DESC
          LIMIT ? OFFSET ?
        `
        
        values.push(pageSize, offset)
        
        const orders = yield* Effect.tryPromise(() =>
          sql.unsafe(ordersQuery, values)
        )
        
        const data = orders.map(o => new OrderSummary({
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          totalAmount: Number(o.total_amount),
          currency: o.currency,
          itemCount: o.item_count,
          createdAt: new Date(o.created_at)
        }))
        
        return { data, total }
      })
    
    const trackOrder = (email: string, orderNumber: string) =>
      Effect.gen(function* () {
        const orders = yield* sql`
          SELECT * FROM orders 
          WHERE order_number = ${orderNumber}
            AND (guest_email = ${email} OR customer_id IN (
              SELECT id FROM customers WHERE email = ${email}
            ))
        `
        
        if (orders.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Order",
            id: `${email}/${orderNumber}`
          }))
        }
        
        const order = orders[0]
        const orderId = order.id
        
        // Get fulfillments
        const fulfillments = yield* sql`
          SELECT * FROM fulfillments WHERE order_id = ${orderId}
          ORDER BY created_at DESC
        `
        
        // Get events
        const events = yield* sql`
          SELECT * FROM order_events WHERE order_id = ${orderId}
          ORDER BY created_at DESC
          LIMIT 20
        `
        
        // Calculate estimated delivery
        let estimatedDelivery: Date | undefined
        if (order.status === "shipped" && fulfillments.length > 0) {
          const latestFulfillment = fulfillments[0]
          if (latestFulfillment.shipped_at) {
            const shippedDate = new Date(latestFulfillment.shipped_at)
            estimatedDelivery = new Date(shippedDate.getTime() + 5 * 24 * 60 * 60 * 1000) // 5 days
          }
        }
        
        return new OrderTrackingInfo({
          orderNumber: order.order_number,
          status: order.status,
          estimatedDelivery,
          fulfillments: fulfillments.map(f => new Fulfillment({
            ...f,
            shippedAt: f.shipped_at ? new Date(f.shipped_at) : undefined,
            deliveredAt: f.delivered_at ? new Date(f.delivered_at) : undefined,
            metadata: JSON.parse(f.metadata || "{}"),
            createdAt: new Date(f.created_at),
            updatedAt: new Date(f.updated_at)
          })),
          events: events.map(e => ({
            id: e.id,
            orderId: e.order_id,
            eventType: e.event_type,
            eventData: JSON.parse(e.event_data || "{}"),
            userId: e.user_id,
            createdAt: new Date(e.created_at)
          }))
        })
      })
    
    const updateStatus = (id: OrderId, status: OrderStatus, notes?: string, userId?: string) =>
      Effect.gen(function* () {
        const currentOrder = yield* getOrder(id)
        const now = new Date()
        
        // Validate status transition
        if (!isValidStatusTransition(currentOrder.order.status, status)) {
          return yield* Effect.fail(new BusinessError({
            code: "INVALID_STATUS_TRANSITION",
            message: `Cannot transition from ${currentOrder.order.status} to ${status}`
          }))
        }
        
        yield* sql`
          UPDATE orders 
          SET status = ${status}, updated_at = ${now}
          WHERE id = ${id}
        `
        
        yield* addEvent(id, OrderEventType.StatusChanged, {
          oldStatus: currentOrder.order.status,
          newStatus: status,
          notes
        }, userId)
        
        // Send notification email for certain status changes
        if (["shipped", "delivered", "cancelled"].includes(status)) {
          yield* emailService.sendOrderStatusUpdate({
            email: currentOrder.order.guestEmail || "",
            order: { ...currentOrder.order, status },
            message: notes
          }).pipe(
            Effect.catchAll(() => Effect.unit)
          )
        }
      })
    
    const isValidStatusTransition = (from: OrderStatus, to: OrderStatus): boolean => {
      const transitions: Record<OrderStatus, OrderStatus[]> = {
        pending: ["processing", "cancelled"],
        processing: ["shipped", "cancelled"],
        shipped: ["delivered", "cancelled"],
        delivered: ["refunded"],
        cancelled: [],
        refunded: []
      }
      
      return transitions[from]?.includes(to) || false
    }
    
    const createFulfillment = (
      orderId: OrderId,
      items: Array<{ orderItemId: number; quantity: number }>,
      tracking?: { trackingNumber?: string; carrier?: string }
    ) =>
      Effect.gen(function* () {
        const order = yield* getOrder(orderId)
        const fulfillmentId = `ful_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const now = new Date()
        
        // Validate items
        for (const item of items) {
          const orderItem = order.items.find(oi => oi.id === item.orderItemId)
          if (!orderItem) {
            return yield* Effect.fail(new BusinessError({
              code: "INVALID_ORDER_ITEM",
              message: `Order item ${item.orderItemId} not found`
            }))
          }
          
          const remainingToFulfill = orderItem.quantity - orderItem.fulfilledQuantity
          if (item.quantity > remainingToFulfill) {
            return yield* Effect.fail(new BusinessError({
              code: "QUANTITY_EXCEEDS_UNFULFILLED",
              message: `Can only fulfill ${remainingToFulfill} of item ${orderItem.productName}`
            }))
          }
        }
        
        // Create fulfillment
        yield* sql`
          INSERT INTO fulfillments (
            id, order_id, status, tracking_number, carrier,
            metadata, created_at, updated_at
          ) VALUES (
            ${fulfillmentId}, ${orderId}, 'pending',
            ${tracking?.trackingNumber || null}, ${tracking?.carrier || null},
            '{}', ${now}, ${now}
          )
        `
        
        // Create fulfillment items and update order items
        yield* Effect.forEach(
          items,
          (item) =>
            Effect.gen(function* () {
              yield* sql`
                INSERT INTO fulfillment_items (
                  fulfillment_id, order_item_id, quantity
                ) VALUES (
                  ${fulfillmentId}, ${item.orderItemId}, ${item.quantity}
                )
              `
              
              yield* sql`
                UPDATE order_items 
                SET fulfilled_quantity = fulfilled_quantity + ${item.quantity}
                WHERE id = ${item.orderItemId}
              `
            }),
          { concurrency: "unbounded" }
        )
        
        // Update order fulfillment status
        const allFulfilled = yield* sql`
          SELECT 
            SUM(quantity) = SUM(fulfilled_quantity) as all_fulfilled,
            SUM(fulfilled_quantity) > 0 as partially_fulfilled
          FROM order_items 
          WHERE order_id = ${orderId}
        `.pipe(Effect.map(r => r[0]))
        
        const newFulfillmentStatus = allFulfilled.all_fulfilled 
          ? "fulfilled" 
          : allFulfilled.partially_fulfilled 
            ? "partially_fulfilled" 
            : "unfulfilled"
        
        yield* sql`
          UPDATE orders 
          SET fulfillment_status = ${newFulfillmentStatus}, updated_at = ${now}
          WHERE id = ${orderId}
        `
        
        yield* addEvent(orderId, OrderEventType.ItemFulfilled, {
          fulfillmentId,
          items,
          trackingNumber: tracking?.trackingNumber
        })
        
        return new Fulfillment({
          id: fulfillmentId,
          orderId,
          status: "pending",
          trackingNumber: tracking?.trackingNumber,
          carrier: tracking?.carrier,
          metadata: {},
          createdAt: now,
          updatedAt: now
        })
      })
    
    const addEvent = (
      orderId: OrderId,
      eventType: OrderEventType,
      eventData: Record<string, unknown>,
      userId?: string
    ) =>
      sql`
        INSERT INTO order_events (
          order_id, event_type, event_data, user_id
        ) VALUES (
          ${orderId}, ${eventType}, ${JSON.stringify(eventData)}, ${userId || "system"}
        )
      `.pipe(Effect.asUnit)
    
    const cancelOrder = (id: OrderId, reason: string, userId?: string) =>
      Effect.gen(function* () {
        const order = yield* getOrder(id)
        
        if (!["pending", "processing"].includes(order.order.status)) {
          return yield* Effect.fail(new BusinessError({
            code: "CANNOT_CANCEL",
            message: "Order cannot be cancelled in current status"
          }))
        }
        
        // Update status
        yield* updateStatus(id, "cancelled", reason, userId)
        
        // Release inventory
        yield* Effect.forEach(
          order.items,
          (item) =>
            productService.releaseInventory([{
              variantId: item.variantId,
              quantity: item.quantity - item.fulfilledQuantity
            }]),
          { concurrency: "unbounded" }
        )
        
        // TODO: Process refund if payment was made
      })
    
    return OrderService.of({
      createFromCheckout,
      getOrder,
      getOrderByNumber,
      listOrders,
      trackOrder,
      updateStatus,
      createFulfillment,
      addEvent,
      cancelOrder
    })
  })
)
```

## Order API

### File: `packages/api/src/order/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { 
  OrderWithItems, OrderSummary, OrderTrackingInfo,
  TrackOrderRequest, OrderIdSchema
} from "./schemas"
import { PaginatedResponse } from "../common/response"

class OrderGroup extends HttpApiGroup.make("order")
  .add(
    HttpApiEndpoint.get("trackOrder")`/orders/track`
      .setUrlParams(TrackOrderRequest)
      .addSuccess(OrderTrackingInfo)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getOrder")`/orders/${OrderIdSchema("id")}`
      .addSuccess(OrderWithItems)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("listOrders")`/orders`
      .setUrlParams(Schema.Struct({
        page: Schema.optional(Schema.NumberFromString),
        pageSize: Schema.optional(Schema.NumberFromString),
        status: Schema.optional(Schema.String)
      }))
      .addSuccess(PaginatedResponse(OrderSummary))
  ) {}

export class OrderApi extends HttpApi.make("order-api").add(OrderGroup) {}
```

### File: `apps/backend/src/http/api/order.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { OrderApi } from "@turbobun/api/order/api"
import { OrderService } from "../../services/OrderService"
import { SessionContext } from "../middleware/session"
import { AuthContext } from "../middleware/auth"
import { successResponse, paginatedResponse, errorResponse } from "../response"

export const OrderApiLive = HttpApiBuilder.group(
  OrderApi,
  "order",
  (handlers) =>
    handlers
      .handle("trackOrder", ({ urlParams }) =>
        Effect.gen(function* () {
          const orderService = yield* OrderService
          
          const trackingInfo = yield* orderService.trackOrder(
            urlParams.email,
            urlParams.orderNumber
          ).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(trackingInfo)
        })
      )
      .handle("getOrder", ({ path }) =>
        Effect.gen(function* () {
          const orderService = yield* OrderService
          
          // TODO: Check if user has access to this order
          const order = yield* orderService.getOrder(path.id).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(order)
        })
      )
      .handle("listOrders", ({ urlParams }) =>
        Effect.gen(function* () {
          const orderService = yield* OrderService
          
          // Get customer from auth context if authenticated
          const customerId = yield* AuthContext.pipe(
            Effect.map(auth => auth?.customerId),
            Effect.catchAll(() => Effect.succeed(undefined))
          )
          
          const result = yield* orderService.listOrders({
            customerId,
            status: urlParams.status as any,
            page: urlParams.page,
            pageSize: urlParams.pageSize
          })
          
          return yield* paginatedResponse(
            result.data,
            {
              page: urlParams.page || 1,
              pageSize: urlParams.pageSize || 20,
              total: result.total
            }
          )
        })
      )
)
```

## Email Service (Order Notifications)

### File: `apps/backend/src/services/EmailService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { Order, OrderItem } from "@turbobun/api/order/schemas"

interface EmailData {
  to: string
  subject: string
  template: string
  data: Record<string, unknown>
}

export class EmailService extends Context.Tag("EmailService")<
  EmailService,
  {
    readonly send: (email: EmailData) => Effect.Effect<void>
    readonly sendOrderConfirmation: (params: {
      email: string
      order: Order
      items: OrderItem[]
    }) => Effect.Effect<void>
    readonly sendOrderStatusUpdate: (params: {
      email: string
      order: Order
      message?: string
    }) => Effect.Effect<void>
  }
>() {}

export const EmailServiceLive = Layer.succeed(
  EmailService,
  EmailService.of({
    send: (email) =>
      Effect.gen(function* () {
        // TODO: Implement actual email sending
        console.log("Sending email:", email)
      }),
    
    sendOrderConfirmation: ({ email, order, items }) =>
      Effect.gen(function* () {
        yield* Effect.log(`Sending order confirmation to ${email}`)
        
        // TODO: Use proper email template
        const emailData = {
          to: email,
          subject: `Order Confirmation - ${order.orderNumber}`,
          template: "order-confirmation",
          data: {
            orderNumber: order.orderNumber,
            orderDate: order.createdAt,
            items: items.map(item => ({
              name: `${item.productName} - ${item.variantName}`,
              quantity: item.quantity,
              price: item.unitPrice,
              total: item.subtotal
            })),
            subtotal: order.subtotal,
            shipping: order.shippingCost,
            tax: order.taxAmount,
            total: order.totalAmount,
            shippingAddress: order.shippingAddress,
            trackingUrl: `${process.env.FRONTEND_URL}/orders/track?email=${email}&orderNumber=${order.orderNumber}`
          }
        }
        
        // Send email
        yield* EmailService.send(emailData)
      }),
    
    sendOrderStatusUpdate: ({ email, order, message }) =>
      Effect.gen(function* () {
        const statusMessages = {
          processing: "Your order is being processed",
          shipped: "Your order has been shipped",
          delivered: "Your order has been delivered",
          cancelled: "Your order has been cancelled",
          refunded: "Your order has been refunded"
        }
        
        yield* Effect.log(`Sending status update to ${email}`)
        
        const emailData = {
          to: email,
          subject: `Order ${order.orderNumber} - ${statusMessages[order.status]}`,
          template: "order-status-update",
          data: {
            orderNumber: order.orderNumber,
            status: order.status,
            statusMessage: statusMessages[order.status],
            customMessage: message,
            trackingUrl: `${process.env.FRONTEND_URL}/orders/track?email=${email}&orderNumber=${order.orderNumber}`
          }
        }
        
        yield* EmailService.send(emailData)
      })
  })
)
```

## Tests

### File: `apps/backend/src/services/__tests__/OrderService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { OrderService, OrderServiceLive } from "../OrderService"
import { CheckoutService, CheckoutServiceLive } from "../CheckoutService"
// ... other imports

describe("OrderService", () => {
  it("should create order from checkout", () =>
    Effect.gen(function* () {
      // Complete checkout flow setup...
      
      // Create order
      const order = yield* orderService.createFromCheckout(
        checkoutSession.id,
        "Test order notes"
      )
      
      expect(order.order.orderNumber).toMatch(/^ORD-\d{4}-[A-Z0-9]{4}$/)
      expect(order.order.status).toBe("pending")
      expect(order.order.paymentStatus).toBe("paid")
      expect(order.order.fulfillmentStatus).toBe("unfulfilled")
      expect(order.items).toHaveLength(2)
      
      // Verify inventory was deducted
      const product = yield* productService.getProduct(productId)
      const inventory = product.inventory[0]
      expect(inventory.quantity).toBe(8) // Started with 10, ordered 2
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should track order by email and number", () =>
    Effect.gen(function* () {
      // Create order...
      
      // Track order
      const tracking = yield* orderService.trackOrder(
        "test@example.com",
        order.order.orderNumber
      )
      
      expect(tracking.orderNumber).toBe(order.order.orderNumber)
      expect(tracking.status).toBe("pending")
      expect(tracking.events).toHaveLength(1)
      expect(tracking.events[0].eventType).toBe(OrderEventType.Created)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should handle order fulfillment", () =>
    Effect.gen(function* () {
      // Create order...
      
      // Create fulfillment
      const fulfillment = yield* orderService.createFulfillment(
        order.order.id,
        [{ orderItemId: order.items[0].id, quantity: 1 }],
        { trackingNumber: "1234567890", carrier: "UPS" }
      )
      
      expect(fulfillment.trackingNumber).toBe("1234567890")
      
      // Check order fulfillment status
      const updated = yield* orderService.getOrder(order.order.id)
      expect(updated.order.fulfillmentStatus).toBe("partially_fulfilled")
      expect(updated.items[0].fulfilledQuantity).toBe(1)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/migrations/0006_order_management.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  // Create tables
  yield* sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      guest_email TEXT,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      fulfillment_status TEXT DEFAULT 'unfulfilled',
      shipping_address TEXT NOT NULL,
      billing_address TEXT NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      shipping_cost DECIMAL(10, 2) NOT NULL,
      tax_amount DECIMAL(10, 2) NOT NULL,
      discount_amount DECIMAL(10, 2) DEFAULT 0,
      total_amount DECIMAL(10, 2) NOT NULL,
      currency TEXT NOT NULL,
      cart_id TEXT NOT NULL,
      checkout_session_id TEXT NOT NULL,
      notes TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cart_id) REFERENCES carts(id),
      FOREIGN KEY (checkout_session_id) REFERENCES checkout_sessions(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      fulfilled_quantity INTEGER DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS fulfillments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      tracking_number TEXT,
      carrier TEXT,
      shipped_at DATETIME,
      delivered_at DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS fulfillment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fulfillment_id TEXT NOT NULL,
      order_item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (fulfillment_id) REFERENCES fulfillments(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    )
  `
  
  // Create indexes
  const indexes = [
    "CREATE INDEX idx_orders_order_number ON orders(order_number)",
    "CREATE INDEX idx_orders_customer_id ON orders(customer_id)",
    "CREATE INDEX idx_orders_guest_email ON orders(guest_email)",
    "CREATE INDEX idx_orders_status ON orders(status)",
    "CREATE INDEX idx_orders_created_at ON orders(created_at)",
    "CREATE INDEX idx_order_items_order_id ON order_items(order_id)",
    "CREATE INDEX idx_order_events_order_id ON order_events(order_id)",
    "CREATE INDEX idx_fulfillments_order_id ON fulfillments(order_id)"
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
1. Test order creation from checkout
2. Test guest order tracking
3. Test order fulfillment flow
4. Verify inventory updates
5. Move to Task 07: Customer Accounts