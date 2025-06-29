# E-Commerce Backend Architecture V2
*Updated for Guest Checkout and Multi-Actor System*

## System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        GUEST[Guest Users]
        CUSTOMER[Registered Customers]
        ADMIN[Admin Dashboard]
        API_CLIENT[API Clients]
    end
    
    subgraph "Session Layer"
        SESSION_MW[Session Middleware]
        COOKIE_MGR[Cookie Manager]
        DEVICE_FP[Device Fingerprinting]
    end
    
    subgraph "API Gateway"
        AUTH_MW[Auth Middleware]
        SCOPE_CHECK[Scope Validator]
        RATE_LIMIT[Rate Limiter]
        VALIDATION[Request Validation]
    end
    
    subgraph "Application Layer - Effect Services"
        subgraph "Core Commerce"
            CART_SVC[Cart Service]
            CHECKOUT_SVC[Checkout Service]
            ORDER_SVC[Order Service]
            PRODUCT_SVC[Product Service]
        end
        
        subgraph "User Services"
            CUSTOMER_SVC[Customer Service]
            ADMIN_SVC[Admin Service]
            AUTH_SVC[Auth Service]
        end
        
        subgraph "Support Services"
            EMAIL_SVC[Email Service]
            PAYMENT_SVC[Payment Service]
            FULFILLMENT_SVC[Fulfillment Service]
            ANALYTICS_SVC[Analytics Service]
        end
    end
    
    subgraph "Workflow Layer"
        CHECKOUT_WF[Checkout Workflow]
        ORDER_WF[Order Workflow]
        CART_RECOVERY_WF[Cart Recovery Workflow]
    end
    
    subgraph "Infrastructure Layer"
        DB[(SQLite DB)]
        CACHE[(Session Cache)]
        QUEUE[(Job Queue)]
        STORAGE[(File Storage)]
    end
    
    GUEST --> SESSION_MW
    CUSTOMER --> SESSION_MW
    ADMIN --> AUTH_MW
    
    SESSION_MW --> COOKIE_MGR
    SESSION_MW --> DEVICE_FP
    SESSION_MW --> AUTH_MW
    
    AUTH_MW --> SCOPE_CHECK
    SCOPE_CHECK --> RATE_LIMIT
    RATE_LIMIT --> VALIDATION
    
    VALIDATION --> CART_SVC
    VALIDATION --> CHECKOUT_SVC
    VALIDATION --> ADMIN_SVC
```

## Session-Based Cart Architecture

```mermaid
sequenceDiagram
    participant Guest
    participant Session
    participant Cart
    participant Checkout
    participant Order
    participant Email
    
    Guest->>Session: First Visit
    Session->>Session: Generate Session ID
    Session->>Cart: Create Anonymous Cart
    Cart->>Guest: Return Cart ID (Cookie)
    
    Guest->>Cart: Add Items
    Cart->>Cart: Validate & Update
    
    Guest->>Checkout: Start Checkout
    Checkout->>Guest: Request Email
    Guest->>Checkout: Provide Email
    Checkout->>Cart: Attach Email to Cart
    
    Guest->>Checkout: Complete Purchase
    Checkout->>Order: Create Order
    Order->>Cart: Mark Cart Completed
    Order->>Email: Send Confirmation
    Email->>Guest: Order Confirmation
    
    Order->>Guest: Offer Account Creation
```

## Multi-Actor Authentication Flow

```mermaid
graph LR
    subgraph "Authentication Scopes"
        GUEST_SCOPE[Guest Scope]
        CUSTOMER_SCOPE[Customer Scope]
        ADMIN_SCOPE[Admin Scope]
    end
    
    subgraph "Access Patterns"
        PUBLIC[Public Endpoints]
        SESSION[Session Endpoints]
        CUSTOMER_AUTH[Customer Auth Endpoints]
        ADMIN_AUTH[Admin Auth Endpoints]
    end
    
    GUEST_SCOPE --> SESSION
    GUEST_SCOPE --> PUBLIC
    
    CUSTOMER_SCOPE --> SESSION
    CUSTOMER_SCOPE --> PUBLIC
    CUSTOMER_SCOPE --> CUSTOMER_AUTH
    
    ADMIN_SCOPE --> ADMIN_AUTH
```

## Layer Composition (Updated)

```typescript
// Core Infrastructure Layers
const SessionLive = Layer.mergeAll(
  SessionStoreLive,
  CookieManagerLive,
  DeviceFingerprintLive
)

const DatabaseLive = Layer.mergeAll(
  SqliteClientLive,
  MigrationServiceLive
)

// Repository Layers
const RepositoryLive = Layer.mergeAll(
  CartRepositoryLive,
  ProductRepositoryLive,
  OrderRepositoryLive,
  CustomerRepositoryLive,
  AdminRepositoryLive
).pipe(Layer.provide(DatabaseLive))

// Service Layers
const CommerceServicesLive = Layer.mergeAll(
  CartServiceLive,
  CheckoutServiceLive,
  OrderServiceLive,
  ProductServiceLive
).pipe(Layer.provide(RepositoryLive))

const UserServicesLive = Layer.mergeAll(
  CustomerServiceLive,
  AdminServiceLive,
  AuthServiceLive
).pipe(Layer.provide(RepositoryLive))

// Workflow Layers
const WorkflowLive = Layer.mergeAll(
  CheckoutWorkflowLive,
  OrderWorkflowLive,
  CartRecoveryWorkflowLive
).pipe(Layer.provide(CommerceServicesLive))

// API Layers
const PublicApiLive = Layer.mergeAll(
  ProductApiLive,
  CartApiLive,
  CheckoutApiLive
)

const CustomerApiLive = Layer.mergeAll(
  CustomerProfileApiLive,
  CustomerOrderApiLive
)

const AdminApiLive = Layer.mergeAll(
  AdminProductApiLive,
  AdminOrderApiLive,
  AdminCustomerApiLive,
  AdminAnalyticsApiLive
)

// Complete Application
const AppLive = Layer.mergeAll(
  SessionLive,
  CommerceServicesLive,
  UserServicesLive,
  WorkflowLive,
  PublicApiLive,
  CustomerApiLive,
  AdminApiLive
)

// Server with Middleware
const ServerLive = HttpApiBuilder.serve(
  HttpMiddleware.logger
).pipe(
  // Session middleware runs first
  Layer.provide(SessionMiddlewareLive),
  // Then auth middleware
  Layer.provide(AuthMiddlewareLive),
  // Then rate limiting
  Layer.provide(RateLimitMiddlewareLive),
  // Application layer
  Layer.provide(AppLive),
  // HTTP server
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)
```

## Cart Lifecycle Management

```mermaid
stateDiagram-v2
    [*] --> Created: Session Start
    Created --> Active: Add First Item
    Active --> Active: Add/Remove Items
    Active --> Checkout: Start Checkout
    Checkout --> Checkout: Add Email/Address
    Checkout --> Completed: Order Created
    Checkout --> Active: Checkout Abandoned
    Active --> Abandoned: 30 Days Inactive
    Abandoned --> Recovered: User Returns
    Recovered --> Active: Items Still Valid
    Completed --> [*]
    Abandoned --> [*]
```

## Database Schema Relationships

```mermaid
erDiagram
    SESSIONS ||--o| CARTS : has
    CUSTOMERS ||--o{ CARTS : owns
    CARTS ||--o{ CART_ITEMS : contains
    PRODUCTS ||--o{ CART_ITEMS : referenced_in
    CARTS ||--o| ORDERS : becomes
    ORDERS ||--o{ ORDER_ITEMS : contains
    CUSTOMERS ||--o{ ORDERS : places
    ADMINS ||--o{ AUDIT_LOGS : creates
    
    SESSIONS {
        string id PK
        string fingerprint
        string user_agent
        datetime expires_at
    }
    
    CARTS {
        string id PK
        string session_id FK
        string customer_id FK
        string email
        string status
        datetime expires_at
    }
    
    CUSTOMERS {
        string id PK
        string email UK
        string password_hash
        boolean is_guest
        datetime registered_at
    }
    
    ORDERS {
        string id PK
        string cart_id FK
        string customer_id FK
        string guest_email
        string status
        decimal total
    }
```

## Workflow Architecture

### Checkout Workflow Steps
```typescript
const checkoutWorkflow = workflow("checkout", {
  steps: [
    {
      name: "validateCart",
      run: ({ cartId }) => CartService.validate(cartId),
      compensate: ({ cartId }) => CartService.unlock(cartId)
    },
    {
      name: "captureEmail",
      run: ({ cartId, email }) => CartService.setEmail(cartId, email)
    },
    {
      name: "calculateTotals",
      run: ({ cartId, shippingMethod }) => 
        CheckoutService.calculateTotals(cartId, shippingMethod)
    },
    {
      name: "processPayment",
      run: ({ payment }) => PaymentService.process(payment),
      compensate: ({ paymentId }) => PaymentService.reverse(paymentId)
    },
    {
      name: "createOrder",
      run: ({ cartId, paymentId }) => 
        OrderService.createFromCart(cartId, paymentId),
      compensate: ({ orderId }) => OrderService.cancel(orderId)
    },
    {
      name: "sendConfirmation",
      run: ({ orderId, email }) => 
        EmailService.sendOrderConfirmation(orderId, email)
    }
  ]
})
```

## Security Architecture (Updated)

### Authentication Levels
```typescript
enum AuthLevel {
  NONE = 0,        // Public endpoints
  SESSION = 1,     // Valid session required
  CUSTOMER = 2,    // Customer JWT required
  ADMIN = 3        // Admin JWT required
}

// Endpoint security mapping
const securityMap = {
  "GET /products": AuthLevel.NONE,
  "GET /cart": AuthLevel.SESSION,
  "POST /checkout/complete": AuthLevel.SESSION,
  "GET /customers/me": AuthLevel.CUSTOMER,
  "GET /admin/orders": AuthLevel.ADMIN
}
```

### Session Security
- HTTP-only cookies for session IDs
- Secure flag in production
- SameSite=Lax for CSRF protection
- 30-day expiration with sliding window
- Device fingerprinting for recovery

## Performance Optimizations

### Caching Strategy
```typescript
// Cache layers for different data types
const CacheLive = Layer.mergeAll(
  // Product catalog - 5 minute TTL
  ProductCacheLive.pipe(
    Layer.provide(RedisCacheLive({ ttl: 300 }))
  ),
  
  // Session data - 1 hour TTL
  SessionCacheLive.pipe(
    Layer.provide(RedisCacheLive({ ttl: 3600 }))
  ),
  
  // Cart data - No cache, always fresh
  CartCacheLive.pipe(
    Layer.provide(NoOpCacheLive)
  )
)
```

### Database Optimization
- Indexes on frequently queried fields
- Separate read replicas for analytics
- Connection pooling
- Query result caching

## Monitoring & Observability

### Key Metrics
1. **Conversion Funnel**
   - Sessions created
   - Carts with items
   - Checkouts started
   - Orders completed

2. **Performance Metrics**
   - API response times by endpoint
   - Database query performance
   - Cache hit rates
   - Session recovery success rate

3. **Business Metrics**
   - Average order value
   - Cart abandonment rate
   - Guest vs registered conversion
   - Admin task completion time

### Health Checks
```typescript
const healthChecks = {
  database: () => SqlClient.execute("SELECT 1"),
  cache: () => Cache.ping(),
  payment: () => PaymentService.healthCheck(),
  email: () => EmailService.healthCheck()
}
```

This architecture prioritizes conversion through guest-friendly flows while maintaining security and scalability for growth.