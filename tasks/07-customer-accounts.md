# Task 07: Customer Accounts

## Overview
Implement optional customer registration, login, and account management. Customers can register after checkout or create accounts directly. Guest carts are merged on login.

## Database Schema

```sql
-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email_verified BOOLEAN DEFAULT false,
  email_verification_token TEXT,
  email_verified_at DATETIME,
  
  -- Account status
  is_active BOOLEAN DEFAULT true,
  is_guest_converted BOOLEAN DEFAULT false, -- Was a guest who registered
  
  -- Password reset
  password_reset_token TEXT,
  password_reset_expires DATETIME,
  
  -- Preferences
  preferences TEXT, -- JSON
  
  -- Metadata
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

-- Customer addresses
CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT DEFAULT 'shipping', -- shipping, billing
  is_default BOOLEAN DEFAULT false,
  
  -- Address fields
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL,
  phone TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Customer sessions (for refresh tokens)
CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  refresh_token TEXT UNIQUE NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Guest to customer conversion tokens
CREATE TABLE IF NOT EXISTS guest_conversion_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  order_ids TEXT NOT NULL, -- JSON array of order IDs
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_email_verification_token ON customers(email_verification_token);
CREATE INDEX idx_customers_password_reset_token ON customers(password_reset_token);
CREATE INDEX idx_customer_addresses_customer_id ON customer_addresses(customer_id);
CREATE INDEX idx_customer_sessions_customer_id ON customer_sessions(customer_id);
CREATE INDEX idx_customer_sessions_refresh_token ON customer_sessions(refresh_token);
CREATE INDEX idx_guest_conversion_tokens_email ON guest_conversion_tokens(email);
```

## Effect Schemas

### File: `packages/api/src/customer/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { CustomerId, CustomerIdSchema, AddressId, AddressIdSchema } from "../common/id"
import { Address } from "../checkout/schemas"

// Customer schema
export class Customer extends Schema.Class<Customer>("Customer")({
  id: CustomerIdSchema,
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/)),
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  emailVerified: Schema.Boolean,
  isActive: Schema.Boolean,
  isGuestConverted: Schema.Boolean,
  preferences: Schema.optional(Schema.Struct({
    newsletter: Schema.Boolean,
    notifications: Schema.Struct({
      email: Schema.Boolean,
      sms: Schema.Boolean
    })
  })),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  lastLoginAt: Schema.optional(Schema.DateFromSelf)
}) {}

// Customer address
export class CustomerAddress extends Schema.Class<CustomerAddress>("CustomerAddress")({
  id: AddressIdSchema,
  customerId: CustomerIdSchema,
  type: Schema.Literal("shipping", "billing"),
  isDefault: Schema.Boolean,
  address: Address,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Customer profile (includes addresses)
export class CustomerProfile extends Schema.Class<CustomerProfile>("CustomerProfile")({
  customer: Customer,
  addresses: Schema.Array(CustomerAddress),
  orderCount: Schema.Number,
  totalSpent: Schema.Number
}) {}

// Request schemas
export class RegisterRequest extends Schema.Class<RegisterRequest>("RegisterRequest")({
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/)),
  password: Schema.String.pipe(Schema.minLength(8)),
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  newsletter: Schema.Boolean.pipe(Schema.optional)
}) {}

export class RegisterAfterCheckoutRequest extends Schema.Class<RegisterAfterCheckoutRequest>("RegisterAfterCheckoutRequest")({
  token: Schema.String,
  password: Schema.String.pipe(Schema.minLength(8)),
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  newsletter: Schema.Boolean.pipe(Schema.optional)
}) {}

export class LoginRequest extends Schema.Class<LoginRequest>("LoginRequest")({
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/)),
  password: Schema.String,
  rememberMe: Schema.Boolean.pipe(Schema.optional)
}) {}

export class UpdateProfileRequest extends Schema.Class<UpdateProfileRequest>("UpdateProfileRequest")({
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  preferences: Schema.optional(Schema.Struct({
    newsletter: Schema.Boolean,
    notifications: Schema.Struct({
      email: Schema.Boolean,
      sms: Schema.Boolean
    })
  }))
}) {}

export class AddAddressRequest extends Schema.Class<AddAddressRequest>("AddAddressRequest")({
  type: Schema.Literal("shipping", "billing"),
  isDefault: Schema.Boolean.pipe(Schema.optional),
  address: Address
}) {}

export class UpdatePasswordRequest extends Schema.Class<UpdatePasswordRequest>("UpdatePasswordRequest")({
  currentPassword: Schema.String,
  newPassword: Schema.String.pipe(Schema.minLength(8))
}) {}

export class ForgotPasswordRequest extends Schema.Class<ForgotPasswordRequest>("ForgotPasswordRequest")({
  email: Schema.String.pipe(Schema.pattern(/.+@.+\..+/))
}) {}

export class ResetPasswordRequest extends Schema.Class<ResetPasswordRequest>("ResetPasswordRequest")({
  token: Schema.String,
  newPassword: Schema.String.pipe(Schema.minLength(8))
}) {}

// Response schemas
export class AuthTokens extends Schema.Class<AuthTokens>("AuthTokens")({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresIn: Schema.Number,
  tokenType: Schema.Literal("Bearer")
}) {}

export class AuthResponse extends Schema.Class<AuthResponse>("AuthResponse")({
  customer: Customer,
  tokens: AuthTokens,
  cartMerged: Schema.optional(Schema.Struct({
    itemsAdded: Schema.Number,
    cartId: Schema.String
  }))
}) {}
```

## Customer Service

### File: `apps/backend/src/services/CustomerService.ts`
```typescript
import { Context, Effect, Layer, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import * as bcrypt from "bcrypt"
import * as jwt from "jsonwebtoken"
import { 
  Customer, CustomerProfile, CustomerAddress,
  RegisterRequest, LoginRequest, UpdateProfileRequest
} from "@turbobun/api/customer/schemas"
import { CustomerId, AddressId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { ConfigService } from "./ConfigService"
import { EmailService } from "./EmailService"
import { OrderService } from "./OrderService"
import { CartService } from "./CartService"
import { SessionService } from "./SessionService"
import { NotFoundError, ConflictError, UnauthorizedError } from "@turbobun/api/common/errors"

export class CustomerService extends Context.Tag("CustomerService")<
  CustomerService,
  {
    readonly register: (request: RegisterRequest) => Effect.Effect<Customer, ConflictError>
    readonly registerAfterCheckout: (
      token: string,
      password: string,
      profile?: { firstName?: string; lastName?: string }
    ) => Effect.Effect<Customer>
    
    readonly login: (
      email: string,
      password: string
    ) => Effect.Effect<Customer, UnauthorizedError>
    
    readonly getCustomer: (id: CustomerId) => Effect.Effect<Customer, NotFoundError>
    readonly getCustomerByEmail: (email: string) => Effect.Effect<Customer, NotFoundError>
    readonly getProfile: (id: CustomerId) => Effect.Effect<CustomerProfile>
    
    readonly updateProfile: (
      id: CustomerId,
      request: UpdateProfileRequest
    ) => Effect.Effect<Customer>
    
    readonly updatePassword: (
      id: CustomerId,
      currentPassword: string,
      newPassword: string
    ) => Effect.Effect<void, UnauthorizedError>
    
    readonly addAddress: (
      customerId: CustomerId,
      address: {
        type: "shipping" | "billing"
        isDefault?: boolean
        address: Address
      }
    ) => Effect.Effect<CustomerAddress>
    
    readonly updateAddress: (
      customerId: CustomerId,
      addressId: AddressId,
      updates: Partial<CustomerAddress>
    ) => Effect.Effect<CustomerAddress>
    
    readonly deleteAddress: (
      customerId: CustomerId,
      addressId: AddressId
    ) => Effect.Effect<void>
    
    readonly mergeGuestData: (
      customerId: CustomerId,
      sessionId: string
    ) => Effect.Effect<{ ordersLinked: number; cartMerged: boolean }>
    
    readonly createConversionToken: (
      email: string,
      orderIds: string[]
    ) => Effect.Effect<string>
    
    readonly requestPasswordReset: (email: string) => Effect.Effect<void>
    readonly resetPassword: (token: string, newPassword: string) => Effect.Effect<void>
    readonly verifyEmail: (token: string) => Effect.Effect<void>
  }
>() {}

export const CustomerServiceLive = Layer.effect(
  CustomerService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    const configService = yield* ConfigService
    const emailService = yield* EmailService
    const orderService = yield* OrderService
    const cartService = yield* CartService
    const sessionService = yield* SessionService
    
    const bcryptRounds = yield* configService.get("bcryptRounds")
    
    const hashPassword = (password: string) =>
      Effect.tryPromise({
        try: () => bcrypt.hash(password, bcryptRounds),
        catch: () => new Error("Failed to hash password")
      })
    
    const verifyPassword = (password: string, hash: string) =>
      Effect.tryPromise({
        try: () => bcrypt.compare(password, hash),
        catch: () => new Error("Failed to verify password")
      })
    
    const register = (request: RegisterRequest) =>
      Effect.gen(function* () {
        // Check if email already exists
        const existing = yield* sql`
          SELECT id FROM customers WHERE email = ${request.email}
        `
        
        if (existing.length > 0) {
          return yield* Effect.fail(new ConflictError({
            resource: "Customer",
            field: "email",
            value: request.email
          }))
        }
        
        const id = yield* idService.generateCustomerId
        const passwordHash = yield* hashPassword(request.password)
        const verificationToken = Math.random().toString(36).substring(2, 15)
        const now = new Date()
        
        const preferences = {
          newsletter: request.newsletter || false,
          notifications: {
            email: true,
            sms: false
          }
        }
        
        yield* sql`
          INSERT INTO customers (
            id, email, password_hash, first_name, last_name,
            email_verification_token, preferences, metadata,
            created_at, updated_at
          ) VALUES (
            ${id}, ${request.email}, ${passwordHash},
            ${request.firstName || null}, ${request.lastName || null},
            ${verificationToken}, ${JSON.stringify(preferences)}, '{}',
            ${now}, ${now}
          )
        `
        
        // Send verification email
        yield* emailService.sendEmailVerification({
          email: request.email,
          token: verificationToken,
          name: request.firstName
        }).pipe(
          Effect.catchAll(() => Effect.unit)
        )
        
        return yield* getCustomer(id)
      })
    
    const registerAfterCheckout = (
      token: string,
      password: string,
      profile?: { firstName?: string; lastName?: string }
    ) =>
      Effect.gen(function* () {
        // Get conversion token
        const tokens = yield* sql`
          SELECT * FROM guest_conversion_tokens
          WHERE token = ${token}
            AND expires_at > datetime('now')
            AND used_at IS NULL
        `
        
        if (tokens.length === 0) {
          return yield* Effect.fail(new Error("Invalid or expired token"))
        }
        
        const tokenData = tokens[0]
        const orderIds = JSON.parse(tokenData.order_ids)
        
        // Create customer account
        const customer = yield* register({
          email: tokenData.email,
          password,
          firstName: profile?.firstName,
          lastName: profile?.lastName
        })
        
        // Link orders to customer
        yield* Effect.forEach(
          orderIds,
          (orderId) =>
            sql`
              UPDATE orders 
              SET customer_id = ${customer.id}
              WHERE id = ${orderId} AND guest_email = ${tokenData.email}
            `,
          { concurrency: "unbounded" }
        )
        
        // Mark token as used
        yield* sql`
          UPDATE guest_conversion_tokens
          SET used_at = CURRENT_TIMESTAMP
          WHERE token = ${token}
        `
        
        // Mark as guest converted
        yield* sql`
          UPDATE customers
          SET is_guest_converted = true, email_verified = true
          WHERE id = ${customer.id}
        `
        
        return { ...customer, isGuestConverted: true, emailVerified: true }
      })
    
    const login = (email: string, password: string) =>
      Effect.gen(function* () {
        const customers = yield* sql`
          SELECT * FROM customers WHERE email = ${email} AND is_active = true
        `
        
        if (customers.length === 0) {
          return yield* Effect.fail(new UnauthorizedError({
            message: "Invalid email or password"
          }))
        }
        
        const customer = customers[0]
        const isValid = yield* verifyPassword(password, customer.password_hash)
        
        if (!isValid) {
          return yield* Effect.fail(new UnauthorizedError({
            message: "Invalid email or password"
          }))
        }
        
        // Update last login
        const now = new Date()
        yield* sql`
          UPDATE customers 
          SET last_login_at = ${now}
          WHERE id = ${customer.id}
        `
        
        return new Customer({
          ...customer,
          preferences: JSON.parse(customer.preferences || "{}"),
          metadata: JSON.parse(customer.metadata || "{}"),
          emailVerified: Boolean(customer.email_verified),
          isActive: Boolean(customer.is_active),
          isGuestConverted: Boolean(customer.is_guest_converted),
          createdAt: new Date(customer.created_at),
          updatedAt: new Date(customer.updated_at),
          lastLoginAt: now
        })
      })
    
    const getCustomer = (id: CustomerId) =>
      sql`SELECT * FROM customers WHERE id = ${id}`.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Customer({
                ...rows[0],
                preferences: JSON.parse(rows[0].preferences || "{}"),
                metadata: JSON.parse(rows[0].metadata || "{}"),
                emailVerified: Boolean(rows[0].email_verified),
                isActive: Boolean(rows[0].is_active),
                isGuestConverted: Boolean(rows[0].is_guest_converted),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at),
                lastLoginAt: rows[0].last_login_at 
                  ? new Date(rows[0].last_login_at)
                  : undefined
              }))
            : Effect.fail(new NotFoundError({ resource: "Customer", id }))
        )
      )
    
    const getCustomerByEmail = (email: string) =>
      sql`SELECT * FROM customers WHERE email = ${email}`.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Customer({
                ...rows[0],
                preferences: JSON.parse(rows[0].preferences || "{}"),
                metadata: JSON.parse(rows[0].metadata || "{}"),
                emailVerified: Boolean(rows[0].email_verified),
                isActive: Boolean(rows[0].is_active),
                isGuestConverted: Boolean(rows[0].is_guest_converted),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at),
                lastLoginAt: rows[0].last_login_at 
                  ? new Date(rows[0].last_login_at)
                  : undefined
              }))
            : Effect.fail(new NotFoundError({ resource: "Customer", id: email }))
        )
      )
    
    const getProfile = (id: CustomerId) =>
      Effect.gen(function* () {
        const customer = yield* getCustomer(id)
        
        // Get addresses
        const addressRows = yield* sql`
          SELECT * FROM customer_addresses 
          WHERE customer_id = ${id}
          ORDER BY is_default DESC, created_at DESC
        `
        
        const addresses = addressRows.map(row => new CustomerAddress({
          id: row.id,
          customerId: row.customer_id,
          type: row.type,
          isDefault: Boolean(row.is_default),
          address: {
            firstName: row.first_name,
            lastName: row.last_name,
            line1: row.line1,
            line2: row.line2,
            city: row.city,
            state: row.state,
            postalCode: row.postal_code,
            country: row.country,
            phone: row.phone
          },
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        }))
        
        // Get order stats
        const stats = yield* sql`
          SELECT 
            COUNT(*) as order_count,
            COALESCE(SUM(total_amount), 0) as total_spent
          FROM orders 
          WHERE customer_id = ${id}
            AND status NOT IN ('cancelled', 'refunded')
        `.pipe(Effect.map(r => r[0]))
        
        return new CustomerProfile({
          customer,
          addresses,
          orderCount: stats.order_count,
          totalSpent: Number(stats.total_spent)
        })
      })
    
    const updateProfile = (id: CustomerId, request: UpdateProfileRequest) =>
      Effect.gen(function* () {
        const now = new Date()
        const updates: Record<string, unknown> = {
          updated_at: now
        }
        
        if (request.firstName !== undefined) updates.first_name = request.firstName
        if (request.lastName !== undefined) updates.last_name = request.lastName
        if (request.phone !== undefined) updates.phone = request.phone
        if (request.preferences !== undefined) {
          updates.preferences = JSON.stringify(request.preferences)
        }
        
        const setClause = Object.keys(updates)
          .map(key => `${key} = ?`)
          .join(", ")
        
        const values = [...Object.values(updates), id]
        
        yield* Effect.tryPromise(() =>
          sql.unsafe(
            `UPDATE customers SET ${setClause} WHERE id = ?`,
            values
          )
        )
        
        return yield* getCustomer(id)
      })
    
    const updatePassword = (
      id: CustomerId,
      currentPassword: string,
      newPassword: string
    ) =>
      Effect.gen(function* () {
        const customer = yield* sql`
          SELECT password_hash FROM customers WHERE id = ${id}
        `.pipe(Effect.map(r => r[0]))
        
        const isValid = yield* verifyPassword(currentPassword, customer.password_hash)
        
        if (!isValid) {
          return yield* Effect.fail(new UnauthorizedError({
            message: "Current password is incorrect"
          }))
        }
        
        const newHash = yield* hashPassword(newPassword)
        
        yield* sql`
          UPDATE customers 
          SET password_hash = ${newHash}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
        `
      })
    
    const addAddress = (
      customerId: CustomerId,
      address: Parameters<CustomerService["addAddress"]>[1]
    ) =>
      Effect.gen(function* () {
        const id = yield* idService.generateAddressId
        const now = new Date()
        
        // If setting as default, unset other defaults
        if (address.isDefault) {
          yield* sql`
            UPDATE customer_addresses 
            SET is_default = false
            WHERE customer_id = ${customerId} AND type = ${address.type}
          `
        }
        
        yield* sql`
          INSERT INTO customer_addresses (
            id, customer_id, type, is_default,
            first_name, last_name, line1, line2,
            city, state, postal_code, country, phone,
            created_at, updated_at
          ) VALUES (
            ${id}, ${customerId}, ${address.type}, ${address.isDefault || false},
            ${address.address.firstName}, ${address.address.lastName},
            ${address.address.line1}, ${address.address.line2 || null},
            ${address.address.city}, ${address.address.state},
            ${address.address.postalCode}, ${address.address.country},
            ${address.address.phone || null}, ${now}, ${now}
          )
        `
        
        return new CustomerAddress({
          id,
          customerId,
          type: address.type,
          isDefault: address.isDefault || false,
          address: address.address,
          createdAt: now,
          updatedAt: now
        })
      })
    
    const updateAddress = (
      customerId: CustomerId,
      addressId: AddressId,
      updates: Partial<CustomerAddress>
    ) =>
      Effect.gen(function* () {
        // Verify ownership
        const existing = yield* sql`
          SELECT * FROM customer_addresses 
          WHERE id = ${addressId} AND customer_id = ${customerId}
        `
        
        if (existing.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Address",
            id: addressId
          }))
        }
        
        // Build update query
        const now = new Date()
        const updateFields: Record<string, unknown> = {
          updated_at: now
        }
        
        if (updates.type) updateFields.type = updates.type
        if (updates.isDefault !== undefined) {
          updateFields.is_default = updates.isDefault
          
          // Unset other defaults
          if (updates.isDefault) {
            yield* sql`
              UPDATE customer_addresses 
              SET is_default = false
              WHERE customer_id = ${customerId} 
                AND type = ${updates.type || existing[0].type}
                AND id != ${addressId}
            `
          }
        }
        
        if (updates.address) {
          Object.entries(updates.address).forEach(([key, value]) => {
            const dbKey = key.replace(/([A-Z])/g, "_$1").toLowerCase()
            updateFields[dbKey] = value
          })
        }
        
        const setClause = Object.keys(updateFields)
          .map(key => `${key} = ?`)
          .join(", ")
        
        const values = [...Object.values(updateFields), addressId]
        
        yield* Effect.tryPromise(() =>
          sql.unsafe(
            `UPDATE customer_addresses SET ${setClause} WHERE id = ?`,
            values
          )
        )
        
        const updated = yield* sql`
          SELECT * FROM customer_addresses WHERE id = ${addressId}
        `.pipe(Effect.map(r => r[0]))
        
        return new CustomerAddress({
          ...updated,
          address: {
            firstName: updated.first_name,
            lastName: updated.last_name,
            line1: updated.line1,
            line2: updated.line2,
            city: updated.city,
            state: updated.state,
            postalCode: updated.postal_code,
            country: updated.country,
            phone: updated.phone
          },
          isDefault: Boolean(updated.is_default),
          createdAt: new Date(updated.created_at),
          updatedAt: new Date(updated.updated_at)
        })
      })
    
    const deleteAddress = (customerId: CustomerId, addressId: AddressId) =>
      Effect.gen(function* () {
        const result = yield* sql`
          DELETE FROM customer_addresses 
          WHERE id = ${addressId} AND customer_id = ${customerId}
        `
        
        if (result.rowsAffected === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Address",
            id: addressId
          }))
        }
      })
    
    const mergeGuestData = (customerId: CustomerId, sessionId: string) =>
      Effect.gen(function* () {
        let ordersLinked = 0
        let cartMerged = false
        
        // Get customer email
        const customer = yield* getCustomer(customerId)
        
        // Link guest orders
        const guestOrders = yield* sql`
          UPDATE orders 
          SET customer_id = ${customerId}
          WHERE guest_email = ${customer.email} 
            AND customer_id IS NULL
        `
        ordersLinked = guestOrders.rowsAffected
        
        // Merge guest cart
        const guestCart = yield* cartService.getCartBySession(sessionId)
        if (guestCart) {
          // Get or create customer cart
          let customerCart = yield* sql`
            SELECT id FROM carts 
            WHERE customer_id = ${customerId} 
              AND status = 'active'
            ORDER BY created_at DESC
            LIMIT 1
          `.pipe(Effect.map(r => r[0]?.id))
          
          if (!customerCart) {
            // Create new cart for customer
            customerCart = yield* cartService.createCart(sessionId).pipe(
              Effect.map(c => c.id)
            )
            yield* cartService.linkCustomer(customerCart, customerId)
          }
          
          // Merge carts
          if (customerCart !== guestCart.id) {
            yield* cartService.mergeGuestCart(guestCart.id, customerCart)
            cartMerged = true
          }
        }
        
        // Link session to customer
        yield* sessionService.linkCustomer(sessionId, customerId)
        
        return { ordersLinked, cartMerged }
      })
    
    const createConversionToken = (email: string, orderIds: string[]) =>
      Effect.gen(function* () {
        const token = Math.random().toString(36).substring(2, 15) +
                     Math.random().toString(36).substring(2, 15)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        
        yield* sql`
          INSERT INTO guest_conversion_tokens (
            token, email, order_ids, expires_at
          ) VALUES (
            ${token}, ${email}, ${JSON.stringify(orderIds)}, ${expiresAt}
          )
        `
        
        return token
      })
    
    const requestPasswordReset = (email: string) =>
      Effect.gen(function* () {
        const customer = yield* getCustomerByEmail(email).pipe(
          Effect.catchTag("NotFoundError", () => Effect.unit)
        )
        
        if (!customer) return // Don't reveal if email exists
        
        const token = Math.random().toString(36).substring(2, 15)
        const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour
        
        yield* sql`
          UPDATE customers 
          SET 
            password_reset_token = ${token},
            password_reset_expires = ${expiresAt}
          WHERE id = ${customer.id}
        `
        
        yield* emailService.sendPasswordReset({
          email,
          token,
          name: customer.firstName
        })
      })
    
    const resetPassword = (token: string, newPassword: string) =>
      Effect.gen(function* () {
        const customers = yield* sql`
          SELECT id FROM customers 
          WHERE password_reset_token = ${token}
            AND password_reset_expires > datetime('now')
        `
        
        if (customers.length === 0) {
          return yield* Effect.fail(new Error("Invalid or expired token"))
        }
        
        const customerId = customers[0].id
        const passwordHash = yield* hashPassword(newPassword)
        
        yield* sql`
          UPDATE customers 
          SET 
            password_hash = ${passwordHash},
            password_reset_token = NULL,
            password_reset_expires = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${customerId}
        `
      })
    
    const verifyEmail = (token: string) =>
      Effect.gen(function* () {
        const result = yield* sql`
          UPDATE customers 
          SET 
            email_verified = true,
            email_verified_at = CURRENT_TIMESTAMP,
            email_verification_token = NULL
          WHERE email_verification_token = ${token}
            AND email_verified = false
        `
        
        if (result.rowsAffected === 0) {
          return yield* Effect.fail(new Error("Invalid verification token"))
        }
      })
    
    return CustomerService.of({
      register,
      registerAfterCheckout,
      login,
      getCustomer,
      getCustomerByEmail,
      getProfile,
      updateProfile,
      updatePassword,
      addAddress,
      updateAddress,
      deleteAddress,
      mergeGuestData,
      createConversionToken,
      requestPasswordReset,
      resetPassword,
      verifyEmail
    })
  })
)
```

## Customer API

### File: `packages/api/src/customer/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { 
  Customer, CustomerProfile, CustomerAddress, AuthResponse,
  RegisterRequest, RegisterAfterCheckoutRequest, LoginRequest,
  UpdateProfileRequest, AddAddressRequest, UpdatePasswordRequest,
  ForgotPasswordRequest, ResetPasswordRequest
} from "./schemas"

class CustomerAuthGroup extends HttpApiGroup.make("customer-auth")
  .add(
    HttpApiEndpoint.post("register")`/auth/customer/register`
      .setPayload(RegisterRequest)
      .addSuccess(AuthResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("registerAfterCheckout")`/auth/customer/register-after-checkout`
      .setPayload(RegisterAfterCheckoutRequest)
      .addSuccess(AuthResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("login")`/auth/customer/login`
      .setPayload(LoginRequest)
      .addSuccess(AuthResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("logout")`/auth/customer/logout`
      .addSuccess(Schema.Void)
  )
  .add(
    HttpApiEndpoint.post("refresh")`/auth/customer/refresh`
      .setPayload(Schema.Struct({ refreshToken: Schema.String }))
      .addSuccess(AuthResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("forgotPassword")`/auth/customer/forgot-password`
      .setPayload(ForgotPasswordRequest)
      .addSuccess(Schema.Void)
  )
  .add(
    HttpApiEndpoint.post("resetPassword")`/auth/customer/reset-password`
      .setPayload(ResetPasswordRequest)
      .addSuccess(Schema.Void)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.post("verifyEmail")`/auth/customer/verify-email/${Schema.String("token")}`
      .addSuccess(Schema.Void)
      .addError(Schema.String)
  ) {}

class CustomerProfileGroup extends HttpApiGroup.make("customer-profile")
  .add(
    HttpApiEndpoint.get("getProfile")`/customers/me`
      .addSuccess(CustomerProfile)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.put("updateProfile")`/customers/me`
      .setPayload(UpdateProfileRequest)
      .addSuccess(Customer)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.put("updatePassword")`/customers/me/password`
      .setPayload(UpdatePasswordRequest)
      .addSuccess(Schema.Void)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getAddresses")`/customers/me/addresses`
      .addSuccess(Schema.Array(CustomerAddress))
  )
  .add(
    HttpApiEndpoint.post("addAddress")`/customers/me/addresses`
      .setPayload(AddAddressRequest)
      .addSuccess(CustomerAddress)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.put("updateAddress")`/customers/me/addresses/${Schema.String("addressId")}`
      .setPayload(Schema.partial(AddAddressRequest))
      .addSuccess(CustomerAddress)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.delete("deleteAddress")`/customers/me/addresses/${Schema.String("addressId")}`
      .addSuccess(Schema.Void)
      .addError(Schema.String)
  ) {}

export class CustomerApi extends HttpApi.make("customer-api")
  .add(CustomerAuthGroup)
  .add(CustomerProfileGroup) {}
```

### File: `apps/backend/src/http/api/customer.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { CustomerApi } from "@turbobun/api/customer/api"
import { CustomerService } from "../../services/CustomerService"
import { AuthService } from "../../services/AuthService"
import { CartService } from "../../services/CartService"
import { SessionContext } from "../middleware/session"
import { CustomerAuthContext } from "../middleware/auth"
import { successResponse, errorResponse } from "../response"

export const CustomerAuthApiLive = HttpApiBuilder.group(
  CustomerApi,
  "customer-auth",
  (handlers) =>
    handlers
      .handle("register", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const customerService = yield* CustomerService
          const authService = yield* AuthService
          
          const customer = yield* customerService.register(payload).pipe(
            Effect.catchTag("ConflictError", errorResponse)
          )
          
          const tokens = yield* authService.generateTokens(customer.id)
          
          // Merge guest data
          const merged = yield* customerService.mergeGuestData(
            customer.id,
            session.id
          )
          
          return yield* successResponse({
            customer,
            tokens,
            cartMerged: merged.cartMerged ? {
              itemsAdded: 0, // TODO: Get actual count
              cartId: ""
            } : undefined
          })
        })
      )
      .handle("registerAfterCheckout", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const customerService = yield* CustomerService
          const authService = yield* AuthService
          
          const customer = yield* customerService.registerAfterCheckout(
            payload.token,
            payload.password,
            {
              firstName: payload.firstName,
              lastName: payload.lastName
            }
          )
          
          const tokens = yield* authService.generateTokens(customer.id)
          
          return yield* successResponse({
            customer,
            tokens
          })
        })
      )
      .handle("login", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* SessionContext
          const customerService = yield* CustomerService
          const authService = yield* AuthService
          
          const customer = yield* customerService.login(
            payload.email,
            payload.password
          ).pipe(
            Effect.catchTag("UnauthorizedError", errorResponse)
          )
          
          const tokens = yield* authService.generateTokens(
            customer.id,
            payload.rememberMe
          )
          
          // Merge guest data
          const merged = yield* customerService.mergeGuestData(
            customer.id,
            session.id
          )
          
          return yield* successResponse({
            customer,
            tokens,
            cartMerged: merged.cartMerged ? {
              itemsAdded: 0,
              cartId: ""
            } : undefined
          })
        })
      )
      .handle("logout", () =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const authService = yield* AuthService
          
          if (auth) {
            yield* authService.revokeTokens(auth.customerId)
          }
          
          return yield* successResponse(undefined)
        })
      )
      .handle("refresh", ({ payload }) =>
        Effect.gen(function* () {
          const authService = yield* AuthService
          
          const result = yield* authService.refreshTokens(payload.refreshToken).pipe(
            Effect.catchTag("UnauthorizedError", errorResponse)
          )
          
          return yield* successResponse(result)
        })
      )
      .handle("forgotPassword", ({ payload }) =>
        Effect.gen(function* () {
          const customerService = yield* CustomerService
          
          yield* customerService.requestPasswordReset(payload.email)
          
          return yield* successResponse(undefined)
        })
      )
      .handle("resetPassword", ({ payload }) =>
        Effect.gen(function* () {
          const customerService = yield* CustomerService
          
          yield* customerService.resetPassword(
            payload.token,
            payload.newPassword
          ).pipe(
            Effect.catchAll(errorResponse)
          )
          
          return yield* successResponse(undefined)
        })
      )
      .handle("verifyEmail", ({ path }) =>
        Effect.gen(function* () {
          const customerService = yield* CustomerService
          
          yield* customerService.verifyEmail(path.token).pipe(
            Effect.catchAll(errorResponse)
          )
          
          return yield* successResponse(undefined)
        })
      )
)

export const CustomerProfileApiLive = HttpApiBuilder.group(
  CustomerApi,
  "customer-profile",
  (handlers) =>
    handlers
      .handle("getProfile", () =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          const profile = yield* customerService.getProfile(auth.customerId)
          
          return yield* successResponse(profile)
        })
      )
      .handle("updateProfile", ({ payload }) =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          const customer = yield* customerService.updateProfile(
            auth.customerId,
            payload
          )
          
          return yield* successResponse(customer)
        })
      )
      .handle("updatePassword", ({ payload }) =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          yield* customerService.updatePassword(
            auth.customerId,
            payload.currentPassword,
            payload.newPassword
          ).pipe(
            Effect.catchTag("UnauthorizedError", errorResponse)
          )
          
          return yield* successResponse(undefined)
        })
      )
      .handle("getAddresses", () =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          const profile = yield* customerService.getProfile(auth.customerId)
          
          return yield* successResponse(profile.addresses)
        })
      )
      .handle("addAddress", ({ payload }) =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          const address = yield* customerService.addAddress(
            auth.customerId,
            {
              type: payload.type,
              isDefault: payload.isDefault,
              address: payload.address
            }
          )
          
          return yield* successResponse(address)
        })
      )
      .handle("updateAddress", ({ path, payload }) =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          const address = yield* customerService.updateAddress(
            auth.customerId,
            path.addressId,
            payload as any
          ).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(address)
        })
      )
      .handle("deleteAddress", ({ path }) =>
        Effect.gen(function* () {
          const auth = yield* CustomerAuthContext
          const customerService = yield* CustomerService
          
          if (!auth) {
            return yield* errorResponse(new UnauthorizedError({
              message: "Authentication required"
            }))
          }
          
          yield* customerService.deleteAddress(
            auth.customerId,
            path.addressId
          ).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(undefined)
        })
      )
)
```

## Migration

### File: `apps/backend/src/migrations/0007_customer_accounts.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email_verified BOOLEAN DEFAULT false,
      email_verification_token TEXT,
      email_verified_at DATETIME,
      is_active BOOLEAN DEFAULT true,
      is_guest_converted BOOLEAN DEFAULT false,
      password_reset_token TEXT,
      password_reset_expires DATETIME,
      preferences TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT DEFAULT 'shipping',
      is_default BOOLEAN DEFAULT false,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      line1 TEXT NOT NULL,
      line2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS customer_sessions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      refresh_token TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS guest_conversion_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      order_ids TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  
  // Create indexes
  const indexes = [
    "CREATE INDEX idx_customers_email ON customers(email)",
    "CREATE INDEX idx_customers_email_verification_token ON customers(email_verification_token)",
    "CREATE INDEX idx_customers_password_reset_token ON customers(password_reset_token)",
    "CREATE INDEX idx_customer_addresses_customer_id ON customer_addresses(customer_id)",
    "CREATE INDEX idx_customer_sessions_customer_id ON customer_sessions(customer_id)",
    "CREATE INDEX idx_customer_sessions_refresh_token ON customer_sessions(refresh_token)",
    "CREATE INDEX idx_guest_conversion_tokens_email ON guest_conversion_tokens(email)"
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
1. Test registration and login flow
2. Test guest cart merging on login
3. Test post-checkout registration
4. Test password reset flow
5. Move to Task 08: Authentication System