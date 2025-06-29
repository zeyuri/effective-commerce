# E-Commerce API Specification V2
*Updated for Guest Checkout and Admin Functionality*

## Base URL
- Development: `http://localhost:3000/api/v1`
- Production: `https://api.yourdomain.com/v1`

## Authentication Types

### 1. Session-Based (Guests)
Session ID in cookie:
```
Cookie: session_id=ses_abc123...
```

### 2. JWT Bearer Token (Customers/Admins)
```
Authorization: Bearer <jwt_token>
```

## Session Management

### Start Session
```http
POST /sessions/start
```

**Purpose**: Initialize anonymous session and cart for new visitors

**Response:**
```json
{
  "data": {
    "sessionId": "ses_1234567890abcdef",
    "cartId": "crt_abcdef1234567890",
    "fingerprint": "fp_xyz789",
    "expiresAt": "2025-07-29T16:30:00Z"
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

**Headers Set:**
```
Set-Cookie: session_id=ses_1234567890abcdef; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
```

## Cart Operations (Session-Based)

### Get Cart
```http
GET /cart
```

**Headers Required:**
```
Cookie: session_id=ses_1234567890abcdef
```

**Response:**
```json
{
  "data": {
    "id": "crt_abcdef1234567890",
    "sessionId": "ses_1234567890abcdef",
    "email": null,
    "items": [
      {
        "id": "itm_123",
        "productId": "prd_abc123",
        "variantId": "var_def456",
        "product": {
          "name": "Wireless Headphones",
          "image": "https://cdn.example.com/headphones.jpg"
        },
        "variant": {
          "name": "Black",
          "sku": "WH-BLK-001"
        },
        "quantity": 2,
        "unitPrice": 79.99,
        "subtotal": 159.98
      }
    ],
    "summary": {
      "itemCount": 2,
      "uniqueItems": 1,
      "subtotal": 159.98,
      "tax": 0,
      "shipping": 0,
      "discount": 0,
      "total": 159.98
    },
    "createdAt": "2025-06-29T10:00:00Z",
    "updatedAt": "2025-06-29T16:00:00Z",
    "expiresAt": "2025-07-29T10:00:00Z"
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

### Add to Cart
```http
PUT /cart/items
```

**Request:**
```json
{
  "productId": "prd_abc123",
  "variantId": "var_def456",
  "quantity": 1
}
```

### Update Cart Item
```http
PATCH /cart/items/:itemId
```

**Request:**
```json
{
  "quantity": 3
}
```

### Set Cart Email (For Guest Checkout)
```http
PUT /cart/email
```

**Request:**
```json
{
  "email": "guest@example.com"
}
```

## Checkout Flow (Session-Based)

### 1. Set Addresses
```http
POST /checkout/addresses
```

**Request:**
```json
{
  "shipping": {
    "firstName": "John",
    "lastName": "Doe",
    "line1": "123 Main St",
    "line2": "Apt 4",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "US",
    "phone": "+1234567890"
  },
  "billing": "same_as_shipping"
}
```

### 2. Get Shipping Methods
```http
GET /checkout/shipping-methods
```

**Response:**
```json
{
  "data": [
    {
      "id": "ship_standard",
      "name": "Standard Shipping",
      "description": "5-7 business days",
      "price": 5.99,
      "estimatedDays": { "min": 5, "max": 7 }
    },
    {
      "id": "ship_express",
      "name": "Express Shipping",
      "description": "2-3 business days",
      "price": 15.99,
      "estimatedDays": { "min": 2, "max": 3 }
    }
  ],
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

### 3. Set Shipping Method
```http
POST /checkout/shipping
```

**Request:**
```json
{
  "shippingMethodId": "ship_standard"
}
```

### 4. Process Payment
```http
POST /checkout/payment
```

**Request:**
```json
{
  "method": "card",
  "token": "tok_visa_4242"
}
```

### 5. Complete Order
```http
POST /checkout/complete
```

**Response:**
```json
{
  "data": {
    "order": {
      "id": "ord_1234567890abcdef",
      "number": "ORD-2025-001234",
      "email": "guest@example.com",
      "status": "pending",
      "total": 165.97,
      "items": [...],
      "trackingCode": "TRK123456"
    },
    "accountCreation": {
      "available": true,
      "token": "act_xyz789",
      "expiresAt": "2025-06-29T17:30:00Z"
    }
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

## Guest Order Tracking

### Track Order
```http
GET /orders/track
```

**Query Parameters:**
- `email`: Customer email
- `orderNumber`: Order number

**Example:**
```http
GET /orders/track?email=guest@example.com&orderNumber=ORD-2025-001234
```

## Post-Purchase Account Creation

### Create Account After Checkout
```http
POST /customers/register-after-checkout
```

**Request:**
```json
{
  "token": "act_xyz789",
  "password": "SecurePassword123!",
  "firstName": "John",
  "lastName": "Doe",
  "newsletter": true
}
```

**Response:**
```json
{
  "data": {
    "customer": {
      "id": "cus_1234567890abcdef",
      "email": "guest@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
    },
    "merged": {
      "orders": 1,
      "addresses": 1
    }
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

## Customer Authentication

### Customer Login
```http
POST /auth/customer/login
```

**Request:**
```json
{
  "email": "customer@example.com",
  "password": "SecurePassword123!",
  "mergeCart": true
}
```

**Response:**
```json
{
  "data": {
    "customer": {
      "id": "cus_1234567890abcdef",
      "email": "customer@example.com",
      "firstName": "John",
      "lastName": "Doe"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
      "expiresIn": 900
    },
    "cart": {
      "merged": true,
      "itemsAdded": 2,
      "cartId": "crt_merged123"
    }
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

## Admin Endpoints

### Admin Login
```http
POST /auth/admin/login
```

**Request:**
```json
{
  "email": "admin@example.com",
  "password": "AdminPassword123!",
  "twoFactorCode": "123456"
}
```

### Product Management

#### List Products (Admin)
```http
GET /admin/products
```

**Query Parameters:**
- All public parameters plus:
- `status`: draft, published, archived
- `stockStatus`: in_stock, low_stock, out_of_stock

#### Create Product
```http
POST /admin/products
```

**Request:**
```json
{
  "name": "New Product",
  "slug": "new-product",
  "description": "Product description",
  "category": "electronics",
  "status": "draft",
  "basePrice": 99.99,
  "variants": [
    {
      "name": "Default",
      "sku": "NP-001",
      "price": 99.99,
      "stock": 100,
      "attributes": {
        "color": "Black"
      }
    }
  ],
  "images": [
    {
      "url": "https://cdn.example.com/product.jpg",
      "alt": "Product image",
      "isPrimary": true
    }
  ],
  "metadata": {
    "brand": "BrandName",
    "warranty": "1 year"
  }
}
```

#### Update Product
```http
PUT /admin/products/:id
```

#### Bulk Update Products
```http
POST /admin/products/bulk
```

**Request:**
```json
{
  "operation": "update",
  "ids": ["prd_123", "prd_456"],
  "data": {
    "status": "published"
  }
}
```

### Order Management

#### List Orders (Admin)
```http
GET /admin/orders
```

**Query Parameters:**
- `status`: pending, processing, shipped, delivered, cancelled
- `dateFrom`: ISO date
- `dateTo`: ISO date
- `customerId`: Filter by customer
- `search`: Search in order number, email

**Response:**
```json
{
  "data": [
    {
      "id": "ord_1234567890abcdef",
      "number": "ORD-2025-001234",
      "customer": {
        "id": "cus_123",
        "email": "customer@example.com",
        "name": "John Doe"
      },
      "status": "processing",
      "paymentStatus": "paid",
      "fulfillmentStatus": "unfulfilled",
      "total": 165.97,
      "itemCount": 2,
      "createdAt": "2025-06-29T10:00:00Z",
      "updatedAt": "2025-06-29T12:00:00Z"
    }
  ],
  "pagination": {...},
  "summary": {
    "totalOrders": 1543,
    "totalRevenue": 125430.50,
    "averageOrderValue": 81.32
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

#### Update Order Status
```http
PUT /admin/orders/:id/status
```

**Request:**
```json
{
  "status": "shipped",
  "trackingNumber": "1234567890",
  "carrier": "UPS",
  "notifyCustomer": true
}
```

#### Process Refund
```http
POST /admin/orders/:id/refund
```

**Request:**
```json
{
  "items": [
    {
      "orderItemId": "oi_123",
      "quantity": 1,
      "reason": "defective"
    }
  ],
  "refundShipping": false,
  "amount": 79.99,
  "notify": true
}
```

### Customer Management

#### List Customers (Admin)
```http
GET /admin/customers
```

**Response includes:**
- Customer details
- Order count and total spent
- Last order date
- Customer groups

#### Customer Details
```http
GET /admin/customers/:id
```

**Response includes:**
- Full customer profile
- Order history
- Addresses
- Cart status
- Lifetime value

### Analytics Dashboard

#### Sales Overview
```http
GET /admin/analytics/sales
```

**Query Parameters:**
- `period`: today, week, month, quarter, year, custom
- `dateFrom`: ISO date (for custom)
- `dateTo`: ISO date (for custom)

**Response:**
```json
{
  "data": {
    "revenue": {
      "total": 45678.90,
      "growth": 15.3,
      "chart": [...]
    },
    "orders": {
      "count": 234,
      "averageValue": 195.21,
      "growth": 8.7
    },
    "customers": {
      "new": 145,
      "returning": 89,
      "conversionRate": 3.2
    },
    "products": {
      "topSelling": [...],
      "lowStock": [...]
    },
    "traffic": {
      "sessions": 15234,
      "conversionRate": 2.8,
      "cartAbandonment": 68.5
    }
  },
  "meta": {
    "period": "month",
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

## Error Responses (Updated)

### Session Errors
```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "Your session has expired. Please refresh the page.",
    "details": {
      "sessionId": "ses_expired123"
    }
  },
  "meta": {
    "timestamp": "2025-06-29T16:30:00Z"
  }
}
```

### Admin-Specific Errors
```json
{
  "error": {
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "You don't have permission to perform this action.",
    "details": {
      "required": "admin.products.write",
      "current": "admin.products.read"
    }
  }
}
```

## Rate Limiting (Updated)
- Anonymous: 60 requests per minute
- Session-based: 120 requests per minute
- Authenticated customers: 300 requests per minute
- Admin users: 600 requests per minute