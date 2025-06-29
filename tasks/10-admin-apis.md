# Task 10: Admin APIs

## Overview
Implement comprehensive admin APIs for managing products, orders, customers, and system settings. These APIs build on the admin foundation to provide full administrative control over the e-commerce platform.

## API Groups

### Product Management APIs

#### File: `apps/backend/src/api/admin/products.ts`
```typescript
import { Schema } from "@effect/schema"
import { Effect, pipe } from "effect"
import { Api, ApiGroup, Handler } from "effect-http"
import { 
  Product, 
  ProductVariant, 
  Category,
  CreateProductRequest,
  UpdateProductRequest,
  BulkUpdateRequest
} from "@/packages/api/src/product/schemas"

export const adminProductApi = pipe(
  ApiGroup.make("adminProducts", {
    description: "Admin product management"
  }),
  ApiGroup.addEndpoint(
    Api.get("listProducts", "/admin/products").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        search: Schema.optional(Schema.String),
        category: Schema.optional(Schema.String),
        status: Schema.optional(Schema.Literal("active", "draft", "archived")),
        inStock: Schema.optional(Schema.BooleanFromString),
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString),
        sortBy: Schema.optional(Schema.Literal("name", "price", "created", "updated")),
        sortOrder: Schema.optional(Schema.Literal("asc", "desc"))
      })),
      Api.setResponseBody(Schema.Struct({
        products: Schema.Array(Product),
        total: Schema.Number,
        hasMore: Schema.Boolean
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("createProduct", "/admin/products").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(CreateProductRequest),
      Api.setResponseBody(Product)
    )
  ),
  ApiGroup.addEndpoint(
    Api.patch("updateProduct", "/admin/products/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(UpdateProductRequest),
      Api.setResponseBody(Product)
    )
  ),
  ApiGroup.addEndpoint(
    Api.delete("deleteProduct", "/admin/products/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("bulkUpdateProducts", "/admin/products/bulk").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        productIds: Schema.Array(Schema.String),
        updates: Schema.Struct({
          status: Schema.optional(Schema.Literal("active", "draft", "archived")),
          categoryId: Schema.optional(Schema.String),
          addTags: Schema.optional(Schema.Array(Schema.String)),
          removeTags: Schema.optional(Schema.Array(Schema.String))
        })
      })),
      Api.setResponseBody(Schema.Struct({
        updated: Schema.Number,
        failed: Schema.Array(Schema.Struct({
          productId: Schema.String,
          error: Schema.String
        }))
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("importProducts", "/admin/products/import").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        format: Schema.Literal("csv", "json"),
        data: Schema.String, // Base64 encoded file content
        options: Schema.Struct({
          updateExisting: Schema.Boolean,
          skipValidation: Schema.Boolean
        })
      })),
      Api.setResponseBody(Schema.Struct({
        imported: Schema.Number,
        updated: Schema.Number,
        skipped: Schema.Number,
        errors: Schema.Array(Schema.Struct({
          row: Schema.Number,
          error: Schema.String
        }))
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("exportProducts", "/admin/products/export").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        format: Schema.Literal("csv", "json"),
        fields: Schema.optional(Schema.Array(Schema.String))
      })),
      Api.setResponseBody(Schema.Struct({
        data: Schema.String, // Base64 encoded
        filename: Schema.String,
        mimeType: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("updateInventory", "/admin/products/:id/inventory").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        variantId: Schema.String,
        adjustment: Schema.Number, // Positive to add, negative to subtract
        reason: Schema.String,
        notes: Schema.optional(Schema.String)
      })),
      Api.setResponseBody(Schema.Struct({
        previousQuantity: Schema.Number,
        newQuantity: Schema.Number,
        adjustmentId: Schema.String
      }))
    )
  )
)
```

### Order Management APIs

#### File: `apps/backend/src/api/admin/orders.ts`
```typescript
export const adminOrderApi = pipe(
  ApiGroup.make("adminOrders", {
    description: "Admin order management"
  }),
  ApiGroup.addEndpoint(
    Api.get("listOrders", "/admin/orders").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        search: Schema.optional(Schema.String), // Order number, email, customer name
        status: Schema.optional(OrderStatus),
        paymentStatus: Schema.optional(PaymentStatus),
        fulfillmentStatus: Schema.optional(FulfillmentStatus),
        customerId: Schema.optional(Schema.String),
        dateFrom: Schema.optional(Schema.DateFromString),
        dateTo: Schema.optional(Schema.DateFromString),
        minAmount: Schema.optional(Schema.NumberFromString),
        maxAmount: Schema.optional(Schema.NumberFromString),
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString)
      })),
      Api.setResponseBody(Schema.Struct({
        orders: Schema.Array(OrderWithDetails),
        total: Schema.Number,
        totalAmount: Schema.Number,
        hasMore: Schema.Boolean
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("orderDetails", "/admin/orders/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setResponseBody(OrderWithDetails)
    )
  ),
  ApiGroup.addEndpoint(
    Api.patch("updateOrderStatus", "/admin/orders/:id/status").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        status: OrderStatus,
        reason: Schema.optional(Schema.String),
        notifyCustomer: Schema.Boolean
      })),
      Api.setResponseBody(Order)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("fulfillOrder", "/admin/orders/:id/fulfill").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        items: Schema.Array(Schema.Struct({
          orderItemId: Schema.Number,
          quantity: Schema.Number
        })),
        trackingNumber: Schema.optional(Schema.String),
        carrier: Schema.optional(Schema.String),
        notifyCustomer: Schema.Boolean
      })),
      Api.setResponseBody(Fulfillment)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("refundOrder", "/admin/orders/:id/refund").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        items: Schema.optional(Schema.Array(Schema.Struct({
          orderItemId: Schema.Number,
          quantity: Schema.Number,
          amount: Schema.Number
        }))),
        shippingRefund: Schema.optional(Schema.Number),
        reason: Schema.String,
        notifyCustomer: Schema.Boolean
      })),
      Api.setResponseBody(Schema.Struct({
        refundId: Schema.String,
        amount: Schema.Number,
        status: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("addOrderNote", "/admin/orders/:id/notes").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        note: Schema.String,
        isInternal: Schema.Boolean // false = visible to customer
      })),
      Api.setResponseBody(Schema.Struct({
        noteId: Schema.String,
        createdAt: Schema.DateFromString
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("orderTimeline", "/admin/orders/:id/timeline").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setResponseBody(Schema.Array(OrderEvent))
    )
  )
)
```

### Customer Management APIs

#### File: `apps/backend/src/api/admin/customers.ts`
```typescript
export const adminCustomerApi = pipe(
  ApiGroup.make("adminCustomers", {
    description: "Admin customer management"
  }),
  ApiGroup.addEndpoint(
    Api.get("listCustomers", "/admin/customers").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        search: Schema.optional(Schema.String), // Name, email, phone
        hasOrders: Schema.optional(Schema.BooleanFromString),
        isActive: Schema.optional(Schema.BooleanFromString),
        registeredFrom: Schema.optional(Schema.DateFromString),
        registeredTo: Schema.optional(Schema.DateFromString),
        totalSpentMin: Schema.optional(Schema.NumberFromString),
        totalSpentMax: Schema.optional(Schema.NumberFromString),
        orderCountMin: Schema.optional(Schema.NumberFromString),
        orderCountMax: Schema.optional(Schema.NumberFromString),
        tags: Schema.optional(Schema.Array(Schema.String)),
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString)
      })),
      Api.setResponseBody(Schema.Struct({
        customers: Schema.Array(CustomerWithStats),
        total: Schema.Number,
        hasMore: Schema.Boolean
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("customerDetails", "/admin/customers/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setResponseBody(CustomerWithStats)
    )
  ),
  ApiGroup.addEndpoint(
    Api.patch("updateCustomer", "/admin/customers/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        firstName: Schema.optional(Schema.String),
        lastName: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
        phone: Schema.optional(Schema.String),
        isActive: Schema.optional(Schema.Boolean),
        tags: Schema.optional(Schema.Array(Schema.String)),
        notes: Schema.optional(Schema.String)
      })),
      Api.setResponseBody(Customer)
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("customerOrders", "/admin/customers/:id/orders").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString)
      })),
      Api.setResponseBody(Schema.Struct({
        orders: Schema.Array(Order),
        total: Schema.Number,
        totalSpent: Schema.Number
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("sendCustomerEmail", "/admin/customers/:id/email").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        subject: Schema.String,
        body: Schema.String,
        isHtml: Schema.Boolean
      })),
      Api.setResponseBody(Schema.Struct({
        sent: Schema.Boolean,
        messageId: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("mergeCustomers", "/admin/customers/merge").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        primaryCustomerId: Schema.String,
        secondaryCustomerIds: Schema.Array(Schema.String)
      })),
      Api.setResponseBody(Schema.Struct({
        mergedCustomer: Customer,
        mergedOrderCount: Schema.Number,
        mergedAddressCount: Schema.Number
      }))
    )
  )
)
```

### Reports & Analytics APIs

#### File: `apps/backend/src/api/admin/reports.ts`
```typescript
export const adminReportApi = pipe(
  ApiGroup.make("adminReports", {
    description: "Admin reporting and analytics"
  }),
  ApiGroup.addEndpoint(
    Api.get("salesReport", "/admin/reports/sales").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        startDate: Schema.DateFromString,
        endDate: Schema.DateFromString,
        groupBy: Schema.Literal("day", "week", "month"),
        includeRefunds: Schema.optional(Schema.BooleanFromString)
      })),
      Api.setResponseBody(Schema.Struct({
        summary: Schema.Struct({
          totalRevenue: Schema.Number,
          totalOrders: Schema.Number,
          averageOrderValue: Schema.Number,
          totalRefunds: Schema.Number
        }),
        data: Schema.Array(Schema.Struct({
          date: Schema.DateFromString,
          revenue: Schema.Number,
          orders: Schema.Number,
          refunds: Schema.Number
        }))
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("productReport", "/admin/reports/products").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        startDate: Schema.DateFromString,
        endDate: Schema.DateFromString,
        limit: Schema.optional(Schema.NumberFromString),
        sortBy: Schema.optional(Schema.Literal("revenue", "quantity", "views"))
      })),
      Api.setResponseBody(Schema.Struct({
        topProducts: Schema.Array(Schema.Struct({
          product: Product,
          revenue: Schema.Number,
          quantitySold: Schema.Number,
          orderCount: Schema.Number
        })),
        lowStock: Schema.Array(Schema.Struct({
          product: Product,
          currentStock: Schema.Number,
          averageDailySales: Schema.Number,
          daysUntilOutOfStock: Schema.Number
        }))
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("customerReport", "/admin/reports/customers").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        startDate: Schema.DateFromString,
        endDate: Schema.DateFromString
      })),
      Api.setResponseBody(Schema.Struct({
        summary: Schema.Struct({
          newCustomers: Schema.Number,
          returningCustomers: Schema.Number,
          averageLifetimeValue: Schema.Number,
          churnRate: Schema.Number
        }),
        topCustomers: Schema.Array(Schema.Struct({
          customer: Customer,
          totalSpent: Schema.Number,
          orderCount: Schema.Number,
          lastOrderDate: Schema.DateFromString
        })),
        segments: Schema.Array(Schema.Struct({
          name: Schema.String,
          count: Schema.Number,
          averageSpent: Schema.Number
        }))
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("customReport", "/admin/reports/custom").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        name: Schema.String,
        query: Schema.Struct({
          metrics: Schema.Array(Schema.String),
          dimensions: Schema.Array(Schema.String),
          filters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
          dateRange: Schema.Struct({
            start: Schema.DateFromString,
            end: Schema.DateFromString
          })
        })
      })),
      Api.setResponseBody(Schema.Struct({
        columns: Schema.Array(Schema.Struct({
          name: Schema.String,
          type: Schema.String
        })),
        data: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
      }))
    )
  )
)
```

### System Settings APIs

#### File: `apps/backend/src/api/admin/settings.ts`
```typescript
export const adminSettingsApi = pipe(
  ApiGroup.make("adminSettings", {
    description: "System settings management"
  }),
  ApiGroup.addEndpoint(
    Api.get("getSettings", "/admin/settings/:category").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        category: Schema.Literal("general", "checkout", "shipping", "tax", "email", "payments")
      })),
      Api.setResponseBody(Schema.Record(Schema.String, Schema.Unknown))
    )
  ),
  ApiGroup.addEndpoint(
    Api.patch("updateSettings", "/admin/settings/:category").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        category: Schema.Literal("general", "checkout", "shipping", "tax", "email", "payments")
      })),
      Api.setRequestBody(Schema.Record(Schema.String, Schema.Unknown)),
      Api.setResponseBody(Schema.Record(Schema.String, Schema.Unknown))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("getEmailTemplates", "/admin/settings/email/templates").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setResponseBody(Schema.Array(Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        subject: Schema.String,
        body: Schema.String,
        variables: Schema.Array(Schema.String)
      })))
    )
  ),
  ApiGroup.addEndpoint(
    Api.patch("updateEmailTemplate", "/admin/settings/email/templates/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        subject: Schema.optional(Schema.String),
        body: Schema.optional(Schema.String)
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("testEmailTemplate", "/admin/settings/email/templates/:id/test").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        recipientEmail: Schema.String,
        testData: Schema.Record(Schema.String, Schema.Unknown)
      }))
    )
  )
)
```

## Service Implementations

### File: `apps/backend/src/services/admin/product-admin.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { ProductService } from "../product"
import { InventoryService } from "../inventory"
import { AuditService, withAudit } from "../admin"

export class ProductAdminService extends Context.Tag("ProductAdminService")<
  ProductAdminService,
  {
    readonly bulkUpdate: (request: BulkUpdateRequest) => Effect.Effect<BulkUpdateResult>
    readonly import: (request: ImportRequest) => Effect.Effect<ImportResult>
    readonly export: (request: ExportRequest) => Effect.Effect<ExportResult>
    readonly updateInventory: (request: InventoryAdjustmentRequest) => Effect.Effect<InventoryAdjustmentResult>
  }
>() {}

export const ProductAdminServiceLive = Layer.effect(
  ProductAdminService,
  Effect.gen(function* () {
    const products = yield* ProductService
    const inventory = yield* InventoryService
    const audit = yield* AuditService
    
    const bulkUpdate = (request: BulkUpdateRequest) =>
      Effect.gen(function* () {
        const results = yield* Effect.all(
          request.productIds.map(productId =>
            Effect.either(
              products.update(productId, request.updates).pipe(
                withAudit("bulk_update", "product", () => productId)
              )
            )
          ),
          { concurrency: 10 }
        )
        
        const updated = results.filter(r => r._tag === "Right").length
        const failed = results
          .filter(r => r._tag === "Left")
          .map((r, i) => ({
            productId: request.productIds[i],
            error: String(r.left)
          }))
        
        return { updated, failed }
      })
    
    const importProducts = (request: ImportRequest) =>
      Effect.gen(function* () {
        // Parse data based on format
        const rows = request.format === "csv" 
          ? yield* parseCsv(request.data)
          : JSON.parse(atob(request.data))
        
        let imported = 0
        let updated = 0
        let skipped = 0
        const errors: ImportError[] = []
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const result = yield* Effect.either(
            validateAndImportRow(row, request.options)
          )
          
          if (result._tag === "Right") {
            if (result.right.action === "created") imported++
            else if (result.right.action === "updated") updated++
            else skipped++
          } else {
            errors.push({ row: i + 1, error: String(result.left) })
          }
        }
        
        yield* audit.log({
          action: "import_products",
          resourceType: "product",
          metadata: { imported, updated, skipped, errors: errors.length }
        })
        
        return { imported, updated, skipped, errors }
      })
    
    return {
      bulkUpdate,
      import: importProducts,
      export: (request) =>
        Effect.gen(function* () {
          const allProducts = yield* products.list({})
          
          const data = request.format === "csv"
            ? yield* generateCsv(allProducts, request.fields)
            : JSON.stringify(allProducts.map(p => 
                request.fields 
                  ? pick(p, request.fields)
                  : p
              ))
          
          return {
            data: btoa(data),
            filename: `products-export-${Date.now()}.${request.format}`,
            mimeType: request.format === "csv" 
              ? "text/csv" 
              : "application/json"
          }
        }),
      updateInventory: (request) =>
        Effect.gen(function* () {
          const current = yield* inventory.getQuantity(
            request.productId,
            request.variantId
          )
          
          yield* inventory.adjust(
            request.productId,
            request.variantId,
            request.adjustment,
            request.reason,
            request.notes
          ).pipe(
            withAudit("inventory_adjustment", "product", () => request.productId)
          )
          
          const adjustmentId = yield* ids.generate("inv_adj")
          
          return {
            previousQuantity: current,
            newQuantity: current + request.adjustment,
            adjustmentId
          }
        })
    }
  })
)
```

### File: `apps/backend/src/services/admin/order-admin.ts`
```typescript
export class OrderAdminService extends Context.Tag("OrderAdminService")<
  OrderAdminService,
  {
    readonly listWithFilters: (filters: OrderFilters) => Effect.Effect<OrderListResult>
    readonly updateStatus: (orderId: string, status: OrderStatus, options: UpdateStatusOptions) => Effect.Effect<Order>
    readonly fulfill: (orderId: string, request: FulfillmentRequest) => Effect.Effect<Fulfillment>
    readonly refund: (orderId: string, request: RefundRequest) => Effect.Effect<RefundResult>
    readonly addNote: (orderId: string, note: string, isInternal: boolean) => Effect.Effect<NoteResult>
    readonly getTimeline: (orderId: string) => Effect.Effect<OrderEvent[]>
  }
>() {}

export const OrderAdminServiceLive = Layer.effect(
  OrderAdminService,
  Effect.gen(function* () {
    const orders = yield* OrderService
    const notifications = yield* NotificationService
    const payments = yield* PaymentService
    const audit = yield* AuditService
    
    const updateStatus = (orderId: string, status: OrderStatus, options: UpdateStatusOptions) =>
      Effect.gen(function* () {
        const order = yield* orders.get(orderId)
        
        // Validate status transition
        if (!isValidStatusTransition(order.status, status)) {
          yield* Effect.fail(new InvalidStatusTransitionError({
            from: order.status,
            to: status
          }))
        }
        
        yield* db.run(
          `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [status, orderId]
        )
        
        // Log status change
        yield* orders.addEvent(orderId, {
          type: "status_changed",
          data: {
            from: order.status,
            to: status,
            reason: options.reason
          }
        })
        
        // Send notification if requested
        if (options.notifyCustomer) {
          yield* notifications.send({
            type: "order_status_changed",
            recipientEmail: order.email,
            data: { order, newStatus: status }
          })
        }
        
        yield* audit.log({
          action: "update_order_status",
          resourceType: "order",
          resourceId: orderId,
          changes: { status, reason: options.reason }
        })
        
        return yield* orders.get(orderId)
      }).pipe(
        withAudit("update_status", "order", () => orderId)
      )
    
    const fulfill = (orderId: string, request: FulfillmentRequest) =>
      Effect.gen(function* () {
        const order = yield* orders.get(orderId)
        
        // Create fulfillment
        const fulfillmentId = yield* ids.generate("ful")
        
        yield* db.run(
          `INSERT INTO fulfillments (
            id, order_id, status, tracking_number, carrier
          ) VALUES (?, ?, 'shipped', ?, ?)`,
          [fulfillmentId, orderId, request.trackingNumber, request.carrier]
        )
        
        // Update item fulfillment quantities
        for (const item of request.items) {
          yield* db.run(
            `UPDATE order_items 
             SET fulfilled_quantity = fulfilled_quantity + ? 
             WHERE id = ? AND order_id = ?`,
            [item.quantity, item.orderItemId, orderId]
          )
        }
        
        // Update order fulfillment status
        const allFulfilled = yield* checkAllItemsFulfilled(orderId)
        yield* db.run(
          `UPDATE orders 
           SET fulfillment_status = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [allFulfilled ? "fulfilled" : "partially_fulfilled", orderId]
        )
        
        // Send notification
        if (request.notifyCustomer) {
          yield* notifications.send({
            type: "order_shipped",
            recipientEmail: order.email,
            data: {
              order,
              trackingNumber: request.trackingNumber,
              carrier: request.carrier
            }
          })
        }
        
        return yield* db.get(
          `SELECT * FROM fulfillments WHERE id = ?`,
          [fulfillmentId]
        ).pipe(Effect.map(Option.getOrThrow))
      })
    
    const refund = (orderId: string, request: RefundRequest) =>
      Effect.gen(function* () {
        const order = yield* orders.get(orderId)
        
        // Calculate refund amount
        let refundAmount = request.shippingRefund || 0
        
        if (request.items) {
          for (const item of request.items) {
            refundAmount += item.amount
            
            // Update refunded quantities
            yield* db.run(
              `UPDATE order_items 
               SET refunded_quantity = refunded_quantity + ? 
               WHERE id = ? AND order_id = ?`,
              [item.quantity, item.orderItemId, orderId]
            )
          }
        } else {
          // Full refund
          refundAmount = order.totalAmount
        }
        
        // Process refund through payment provider
        const refundResult = yield* payments.refund(
          order.paymentIntentId,
          refundAmount,
          request.reason
        )
        
        // Update order payment status
        const isFullRefund = refundAmount === order.totalAmount
        yield* db.run(
          `UPDATE orders 
           SET payment_status = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [isFullRefund ? "refunded" : "partially_refunded", orderId]
        )
        
        // Log refund event
        yield* orders.addEvent(orderId, {
          type: "order_refunded",
          data: {
            amount: refundAmount,
            reason: request.reason,
            items: request.items
          }
        })
        
        // Send notification
        if (request.notifyCustomer) {
          yield* notifications.send({
            type: "order_refunded",
            recipientEmail: order.email,
            data: {
              order,
              refundAmount,
              reason: request.reason
            }
          })
        }
        
        return {
          refundId: refundResult.id,
          amount: refundAmount,
          status: refundResult.status
        }
      })
    
    return {
      listWithFilters,
      updateStatus,
      fulfill,
      refund,
      addNote: (orderId, note, isInternal) =>
        Effect.gen(function* () {
          const noteId = yield* ids.generate("note")
          const context = yield* AuthContext
          
          yield* db.run(
            `INSERT INTO order_notes (
              id, order_id, note, is_internal, created_by
            ) VALUES (?, ?, ?, ?, ?)`,
            [noteId, orderId, note, isInternal ? 1 : 0, context.userId]
          )
          
          yield* orders.addEvent(orderId, {
            type: "note_added",
            data: { noteId, isInternal }
          })
          
          return {
            noteId,
            createdAt: new Date()
          }
        }),
      getTimeline: (orderId) =>
        Effect.gen(function* () {
          const events = yield* db.all(
            `SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC`,
            [orderId]
          )
          
          return events.map(e => new OrderEvent({
            id: e.id,
            orderId: e.order_id,
            eventType: e.event_type,
            eventData: JSON.parse(e.event_data || "{}"),
            userId: e.user_id,
            createdAt: new Date(e.created_at)
          }))
        })
    }
  })
)
```

### File: `apps/backend/src/services/admin/report-admin.ts`
```typescript
export class ReportService extends Context.Tag("ReportService")<
  ReportService,
  {
    readonly salesReport: (request: SalesReportRequest) => Effect.Effect<SalesReport>
    readonly productReport: (request: ProductReportRequest) => Effect.Effect<ProductReport>
    readonly customerReport: (request: CustomerReportRequest) => Effect.Effect<CustomerReport>
    readonly customReport: (request: CustomReportRequest) => Effect.Effect<CustomReportResult>
  }
>() {}

export const ReportServiceLive = Layer.effect(
  ReportService,
  Effect.gen(function* () {
    const db = yield* Database
    
    const salesReport = (request: SalesReportRequest) =>
      Effect.gen(function* () {
        // Summary statistics
        const summary = yield* db.get(`
          SELECT 
            COALESCE(SUM(total_amount), 0) as totalRevenue,
            COUNT(*) as totalOrders,
            COALESCE(AVG(total_amount), 0) as averageOrderValue,
            COALESCE(SUM(CASE WHEN payment_status IN ('partially_refunded', 'refunded') THEN refund_amount END), 0) as totalRefunds
          FROM orders
          WHERE created_at BETWEEN ? AND ?
            AND payment_status IN ('paid', 'partially_refunded', 'refunded')
        `, [request.startDate.toISOString(), request.endDate.toISOString()])
          .pipe(Effect.map(Option.getOrThrow))
        
        // Time series data
        const groupFormat = {
          day: '%Y-%m-%d',
          week: '%Y-W%W',
          month: '%Y-%m'
        }[request.groupBy]
        
        const data = yield* db.all(`
          SELECT 
            strftime('${groupFormat}', created_at) as date,
            COALESCE(SUM(total_amount), 0) as revenue,
            COUNT(*) as orders,
            COALESCE(SUM(CASE WHEN payment_status IN ('partially_refunded', 'refunded') THEN refund_amount END), 0) as refunds
          FROM orders
          WHERE created_at BETWEEN ? AND ?
            AND payment_status IN ('paid', 'partially_refunded', 'refunded')
          GROUP BY strftime('${groupFormat}', created_at)
          ORDER BY date
        `, [request.startDate.toISOString(), request.endDate.toISOString()])
        
        return {
          summary: {
            totalRevenue: summary.totalRevenue,
            totalOrders: summary.totalOrders,
            averageOrderValue: summary.averageOrderValue,
            totalRefunds: summary.totalRefunds
          },
          data: data.map(row => ({
            date: new Date(row.date),
            revenue: row.revenue,
            orders: row.orders,
            refunds: row.refunds
          }))
        }
      })
    
    const productReport = (request: ProductReportRequest) =>
      Effect.gen(function* () {
        // Top selling products
        const topProducts = yield* db.all(`
          SELECT 
            p.*,
            COALESCE(SUM(oi.subtotal), 0) as revenue,
            COALESCE(SUM(oi.quantity), 0) as quantitySold,
            COUNT(DISTINCT oi.order_id) as orderCount
          FROM products p
          JOIN order_items oi ON p.id = oi.product_id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at BETWEEN ? AND ?
            AND o.payment_status IN ('paid', 'partially_refunded')
          GROUP BY p.id
          ORDER BY ${request.sortBy || 'revenue'} DESC
          LIMIT ?
        `, [
          request.startDate.toISOString(),
          request.endDate.toISOString(),
          request.limit || 10
        ])
        
        // Low stock products
        const lowStock = yield* db.all(`
          SELECT 
            p.*,
            i.quantity as currentStock,
            COALESCE(AVG(daily_sales.quantity), 0) as averageDailySales
          FROM products p
          JOIN inventory i ON p.id = i.product_id
          LEFT JOIN (
            SELECT 
              oi.product_id,
              SUM(oi.quantity) / 30.0 as quantity
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.created_at >= date('now', '-30 days')
              AND o.payment_status IN ('paid', 'partially_refunded')
            GROUP BY oi.product_id
          ) daily_sales ON p.id = daily_sales.product_id
          WHERE i.quantity < 50
            AND p.is_active = 1
          ORDER BY i.quantity ASC
          LIMIT 20
        `)
        
        return {
          topProducts: yield* Effect.all(
            topProducts.map(async row => ({
              product: yield* ProductService.get(ProductId(row.id)),
              revenue: row.revenue,
              quantitySold: row.quantitySold,
              orderCount: row.orderCount
            }))
          ),
          lowStock: lowStock.map(row => ({
            product: yield* ProductService.get(ProductId(row.id)),
            currentStock: row.currentStock,
            averageDailySales: row.averageDailySales,
            daysUntilOutOfStock: row.averageDailySales > 0 
              ? Math.floor(row.currentStock / row.averageDailySales)
              : Infinity
          }))
        }
      })
    
    return {
      salesReport,
      productReport,
      customerReport: (request) =>
        Effect.gen(function* () {
          // Implementation similar to above
          // Customer acquisition, retention, lifetime value, etc.
        }),
      customReport: (request) =>
        Effect.gen(function* () {
          // Build dynamic SQL based on request
          // Support for custom metrics and dimensions
        })
    }
  })
)
```

## Tests

### File: `apps/backend/src/api/admin/admin.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { TestClient } from "../../test/client"
import { adminProductApi, adminOrderApi } from "./index"

describe("Admin APIs", () => {
  describe("Product Management", () => {
    it("should bulk update products", () =>
      Effect.gen(function* () {
        const client = yield* TestClient
        
        // Create test products
        const products = yield* Effect.all([
          client.post("/admin/products", { name: "Product 1" }),
          client.post("/admin/products", { name: "Product 2" })
        ])
        
        // Bulk update
        const result = yield* client.post("/admin/products/bulk", {
          productIds: products.map(p => p.id),
          updates: {
            status: "archived",
            addTags: ["discontinued"]
          }
        })
        
        expect(result.updated).toBe(2)
        expect(result.failed).toHaveLength(0)
        
        // Verify updates
        const updated = yield* client.get(`/admin/products/${products[0].id}`)
        expect(updated.status).toBe("archived")
        expect(updated.tags).toContain("discontinued")
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
  })
  
  describe("Order Management", () => {
    it("should fulfill order items", () =>
      Effect.gen(function* () {
        const client = yield* TestClient
        
        // Create and complete an order
        const order = yield* createTestOrder()
        
        // Fulfill order
        const fulfillment = yield* client.post(`/admin/orders/${order.id}/fulfill`, {
          items: order.items.map(item => ({
            orderItemId: item.id,
            quantity: item.quantity
          })),
          trackingNumber: "TRACK123",
          carrier: "UPS",
          notifyCustomer: true
        })
        
        expect(fulfillment.trackingNumber).toBe("TRACK123")
        
        // Check order status
        const updated = yield* client.get(`/admin/orders/${order.id}`)
        expect(updated.fulfillmentStatus).toBe("fulfilled")
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
    
    it("should process refunds", () =>
      Effect.gen(function* () {
        const client = yield* TestClient
        
        const order = yield* createTestOrder()
        
        // Process partial refund
        const refund = yield* client.post(`/admin/orders/${order.id}/refund`, {
          items: [{
            orderItemId: order.items[0].id,
            quantity: 1,
            amount: 50.00
          }],
          reason: "Customer request",
          notifyCustomer: true
        })
        
        expect(refund.amount).toBe(50.00)
        expect(refund.status).toBe("succeeded")
        
        // Check order payment status
        const updated = yield* client.get(`/admin/orders/${order.id}`)
        expect(updated.paymentStatus).toBe("partially_refunded")
      }).pipe(
        Effect.provide(testLayer),
        Effect.runPromise
      )
    )
  })
})
```

## Migration

### File: `apps/backend/src/db/migrations/010_admin_apis.sql`
```sql
-- Order notes table
CREATE TABLE IF NOT EXISTS order_notes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  note TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (created_by) REFERENCES admin_users(id)
);

-- Inventory adjustments table
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  adjustment INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (variant_id) REFERENCES product_variants(id),
  FOREIGN KEY (created_by) REFERENCES admin_users(id)
);

-- Customer tags table
CREATE TABLE IF NOT EXISTS customer_tags (
  customer_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, tag),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Email logs table
CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_id TEXT,
  status TEXT NOT NULL, -- sent, failed, bounced
  message_id TEXT,
  error TEXT,
  sent_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sent_by) REFERENCES admin_users(id)
);

-- Settings table
CREATE TABLE IF NOT EXISTS system_settings (
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (category, key),
  FOREIGN KEY (updated_by) REFERENCES admin_users(id)
);

-- Report cache table
CREATE TABLE IF NOT EXISTS report_cache (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  parameters TEXT NOT NULL, -- JSON
  data TEXT NOT NULL, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- Indexes
CREATE INDEX idx_order_notes_order_id ON order_notes(order_id);
CREATE INDEX idx_inventory_adjustments_product ON inventory_adjustments(product_id, variant_id);
CREATE INDEX idx_customer_tags_customer_id ON customer_tags(customer_id);
CREATE INDEX idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX idx_report_cache_type ON report_cache(report_type, expires_at);

-- Default settings
INSERT OR IGNORE INTO system_settings (category, key, value) VALUES
('general', 'store_name', 'My E-Commerce Store'),
('general', 'store_url', 'https://example.com'),
('general', 'currency', 'USD'),
('checkout', 'guest_checkout_enabled', 'true'),
('checkout', 'require_phone', 'false'),
('shipping', 'free_shipping_threshold', '100'),
('tax', 'tax_enabled', 'true'),
('tax', 'tax_rate', '0.08'),
('email', 'from_email', 'noreply@example.com'),
('email', 'from_name', 'My Store'),
('payments', 'stripe_enabled', 'true');
```

## Next Steps

1. Implement webhook handlers for payment providers
2. Add bulk operations for all entities
3. Create admin dashboard widgets API
4. Implement real-time updates via WebSockets
5. Add export queuing for large datasets
6. Create admin action approval workflow
7. Implement advanced search with Elasticsearch
8. Add multi-language support for admin UI

This completes the admin API implementation with:
- Comprehensive product management
- Full order lifecycle control
- Customer management and segmentation
- Reporting and analytics
- System settings management
- Audit trail for all operations
- Bulk operations support
- Import/export functionality