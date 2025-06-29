# E-Commerce MVP Implementation Plan V2
*Updated with Guest Checkout, Admin Functionality, and Medusa-inspired Architecture*

## Overview
This updated plan incorporates Medusa's flexible commerce patterns, prioritizing guest checkout for higher conversion rates and including admin functionality. The architecture remains Effect-based but adopts Medusa's modular approach.

## Core Principles (Updated)
1. **Conversion First**: Guest checkout without mandatory registration
2. **Modular Architecture**: Independent modules for cart, order, auth, etc.
3. **Multi-Actor Support**: Customers, guests, and admin users
4. **Session-Based Carts**: Cart persistence without user accounts
5. **Workflow Consistency**: Effect-based workflows for complex operations
6. **Progressive Enhancement**: Optional features that don't block core flows

## Key Architecture Changes

### Session & Cart Management
```typescript
// Cart exists independently of users
interface Cart {
  id: string // crt_xxx
  sessionId: string // Anonymous identifier
  customerId?: string // Optional, linked after login/register
  email?: string // Captured during checkout
  items: CartItem[]
  shippingAddress?: Address
  billingAddress?: Address
  metadata: {
    fingerprint?: string // Device fingerprinting for better tracking
    createdAt: Date
    expiresAt: Date // 30 days default
  }
}
```

### Authentication Scopes
```typescript
enum AuthScope {
  GUEST = "guest", // Anonymous users with cart
  CUSTOMER = "customer", // Registered customers
  ADMIN = "admin" // Store administrators
}
```

## Updated API Response Standards

### Session Response (for guests)
```json
{
  "data": {
    "sessionId": "ses_abc123...",
    "cartId": "crt_def456...",
    "expiresAt": "2025-07-29T16:30:00Z"
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

## Revised Implementation Phases

### Phase 1: Foundation & Cart System (Week 1)
**Goal**: Session-based cart system that works for everyone

1. **Session Management**
   - Session ID generation and cookie management
   - Device fingerprinting for cart recovery
   - Session expiration handling

2. **Cart Module**
   - Cart CRUD operations without auth requirement
   - Session-based cart retrieval
   - Cart persistence (30-day expiration)
   - Cart validation and pricing
   - Endpoints:
     - POST /sessions/start (creates session & cart)
     - GET /cart (session-based)
     - PUT /cart/items
     - DELETE /cart/items/:id
     - PUT /cart/email (capture email)

3. **Product Catalog**
   - Basic product management
   - Categories and variants
   - Inventory tracking
   - Public endpoints:
     - GET /products
     - GET /products/:id

### Phase 2: Checkout & Orders (Week 2)
**Goal**: Complete guest checkout flow

1. **Checkout Workflow**
   - Email capture (required for guests)
   - Address collection
   - Shipping method selection
   - Payment method selection
   - Order creation from cart

2. **Order Module**
   - Order creation without account
   - Order tracking by email + order number
   - Order confirmation emails
   - Endpoints:
     - POST /checkout/email
     - POST /checkout/addresses
     - GET /checkout/shipping-methods
     - POST /checkout/payment
     - POST /checkout/complete
     - GET /orders/track (email + order number)

3. **Payment Abstraction**
   - Payment provider interface
   - Mock payment provider for testing
   - Payment session management

### Phase 3: Customer Accounts (Week 3)
**Goal**: Optional customer features for better experience

1. **Customer Module**
   - Registration (optional post-checkout)
   - Login/logout
   - Password reset
   - Profile management

2. **Account Benefits**
   - Order history
   - Saved addresses
   - Wishlist
   - Faster checkout

3. **Cart Association**
   - Link guest cart to customer on login
   - Cart merging strategies
   - Persistent cart across devices

4. **Customer Endpoints**
   - POST /customers/register
   - POST /customers/register-after-checkout
   - POST /auth/customer/login
   - GET /customers/me
   - GET /customers/orders

### Phase 4: Admin System (Week 4)
**Goal**: Store management capabilities

1. **Admin Authentication**
   - Separate admin auth flow
   - Role-based permissions
   - Admin session management
   - Endpoints:
     - POST /auth/admin/login
     - GET /admin/me

2. **Product Management**
   - CRUD operations for products
   - Bulk operations
   - Image management
   - Inventory updates
   - Endpoints:
     - POST /admin/products
     - PUT /admin/products/:id
     - DELETE /admin/products/:id
     - POST /admin/products/bulk

3. **Order Management**
   - View all orders
   - Update order status
   - Process refunds
   - Export capabilities
   - Endpoints:
     - GET /admin/orders
     - PUT /admin/orders/:id/status
     - POST /admin/orders/:id/refund

4. **Customer Management**
   - View customer list
   - Customer details and history
   - Customer groups
   - Endpoints:
     - GET /admin/customers
     - GET /admin/customers/:id

5. **Analytics Dashboard**
   - Sales metrics
   - Popular products
   - Conversion rates
   - Cart abandonment

### Phase 5: Advanced Features & Optimization (Week 5)
**Goal**: Production readiness and advanced features

1. **Fulfillment Module**
   - Shipping provider abstraction
   - Fulfillment workflows
   - Tracking integration
   - Multi-warehouse support

2. **Advanced Cart Features**
   - Abandoned cart recovery
   - Cart reminders
   - Dynamic discounts
   - Tax calculations

3. **Production Hardening**
   - Performance optimization
   - Security audit
   - Load testing
   - Monitoring setup

## Updated Database Schema

### Core Tables
```sql
-- Sessions (for anonymous users)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- ses_xxx
  fingerprint TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

-- Carts (exists independently)
CREATE TABLE carts (
  id TEXT PRIMARY KEY, -- crt_xxx
  session_id TEXT REFERENCES sessions(id),
  customer_id TEXT REFERENCES customers(id),
  email TEXT, -- for guest checkout
  status TEXT DEFAULT 'active', -- active, completed, abandoned
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  expires_at TIMESTAMP
);

-- Customers (optional)
CREATE TABLE customers (
  id TEXT PRIMARY KEY, -- cus_xxx
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admins (separate table)
CREATE TABLE admins (
  id TEXT PRIMARY KEY, -- adm_xxx
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin', -- admin, super_admin
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Workflow Examples

### Guest Checkout Workflow
```typescript
const guestCheckoutWorkflow = workflow({
  name: "guest-checkout",
  steps: [
    validateCart,
    captureEmail,
    validateShippingAddress,
    calculateShipping,
    createPaymentSession,
    processPayment,
    createOrder,
    clearCart,
    sendOrderConfirmation,
    offerAccountCreation
  ]
})
```

### Cart Recovery Workflow
```typescript
const cartRecoveryWorkflow = workflow({
  name: "cart-recovery",
  steps: [
    identifySession,
    findRecentCart,
    validateCartItems,
    updatePricing,
    restoreCart
  ]
})
```

## API Endpoint Summary (Updated)

### Public Endpoints (No Auth)
```
POST   /sessions/start           - Start anonymous session
GET    /products                 - List products
GET    /products/:id             - Get product
GET    /cart                     - Get cart (session-based)
PUT    /cart/items               - Add to cart
DELETE /cart/items/:id           - Remove from cart
PUT    /cart/email               - Add email to cart
POST   /checkout/addresses       - Set addresses
GET    /checkout/shipping-methods - Get shipping options
POST   /checkout/payment         - Process payment
POST   /checkout/complete        - Complete order
GET    /orders/track             - Track order (email + number)
```

### Customer Endpoints (Customer Auth)
```
POST   /auth/customer/login      - Customer login
POST   /auth/customer/logout     - Customer logout
POST   /customers/register       - Register account
GET    /customers/me             - Get profile
PUT    /customers/me             - Update profile
GET    /customers/orders         - Order history
POST   /customers/addresses      - Save address
```

### Admin Endpoints (Admin Auth)
```
POST   /auth/admin/login         - Admin login
GET    /admin/dashboard          - Analytics
GET    /admin/products           - List products
POST   /admin/products           - Create product
PUT    /admin/products/:id       - Update product
DELETE /admin/products/:id       - Delete product
GET    /admin/orders             - List orders
PUT    /admin/orders/:id         - Update order
GET    /admin/customers          - List customers
GET    /admin/customers/:id      - Customer details
```

## Key Implementation Patterns

### Session Management
```typescript
// Middleware to handle session
const sessionMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const cookies = yield* HttpServerRequest.cookies
    const sessionId = cookies["session_id"] || yield* generateSessionId()
    
    // Attach session to request context
    yield* SessionContext.set({ sessionId })
    
    // Set cookie in response
    yield* HttpServerResponse.setCookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 // 30 days
    })
    
    return yield* app
  })
)
```

### Multi-Actor Authentication
```typescript
const authMiddleware = (scope: AuthScope) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const auth = yield* HttpServerRequest.headers.get("authorization")
      
      if (scope === AuthScope.GUEST) {
        // Just need valid session
        const session = yield* SessionContext.get
        if (!session) return yield* HttpServerResponse.unauthorized()
      } else {
        // Need valid JWT with correct scope
        const token = yield* validateJWT(auth)
        if (token.scope !== scope) return yield* HttpServerResponse.forbidden()
      }
      
      return yield* app
    })
  )
```

## Conversion Optimization Features

1. **One-Page Checkout**: All steps on single page for speed
2. **Smart Defaults**: Pre-fill common fields
3. **Address Autocomplete**: Reduce typing friction
4. **Payment Method Memory**: Remember for returning guests
5. **Express Checkout**: Apple Pay, Google Pay integration
6. **Cart Persistence**: Never lose items
7. **Guest Order Tracking**: Easy order lookup
8. **Post-Purchase Account**: Optional registration after success

## Success Metrics (Updated)
1. Cart abandonment rate < 70%
2. Guest checkout conversion > 30%
3. Account creation post-purchase > 20%
4. Admin task completion < 2 minutes average
5. Page load time < 2 seconds
6. Checkout completion < 60 seconds

This updated plan prioritizes conversion through guest checkout while maintaining flexibility for future enhancements. The modular architecture allows independent development of each component while the workflow system ensures consistency across complex operations.