# Task 09: Admin Foundation

## Overview
Build the admin system foundation including role-based permissions, audit logging, admin-specific middleware, and core admin services. This provides the infrastructure for all admin operations.

## Database Schema

```sql
-- Admin roles table
CREATE TABLE IF NOT EXISTS admin_roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL, -- JSON array
  is_system BOOLEAN DEFAULT false, -- Cannot be deleted
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin role assignments
CREATE TABLE IF NOT EXISTS admin_role_assignments (
  admin_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (admin_id, role_id),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES admin_users(id)
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL, -- admin, customer, system
  action TEXT NOT NULL, -- create, update, delete, view, login, logout, etc.
  resource_type TEXT NOT NULL, -- product, order, customer, etc.
  resource_id TEXT,
  changes TEXT, -- JSON diff of changes
  metadata TEXT, -- JSON additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin activity logs
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Admin notifications
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  type TEXT NOT NULL, -- order_placed, low_inventory, customer_registered, etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT, -- JSON
  priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
  is_read BOOLEAN DEFAULT false,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Admin settings
CREATE TABLE IF NOT EXISTS admin_settings (
  admin_id TEXT PRIMARY KEY,
  theme TEXT DEFAULT 'light',
  language TEXT DEFAULT 'en',
  timezone TEXT DEFAULT 'UTC',
  notifications TEXT, -- JSON notification preferences
  dashboard_layout TEXT, -- JSON dashboard widget configuration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, user_type);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);
CREATE INDEX idx_admin_notifications_admin_id ON admin_notifications(admin_id, is_read);
```

## Effect Schemas

### File: `packages/api/src/admin/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { AdminUser, Permission } from "../auth/schemas"

// Admin role
export class AdminRole extends Schema.Class<AdminRole>("AdminRole")({
  id: Schema.String,
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  permissions: Schema.Array(Permission),
  isSystem: Schema.Boolean,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString
}) {}

// Audit log entry
export class AuditLog extends Schema.Class<AuditLog>("AuditLog")({
  id: Schema.String,
  userId: Schema.String,
  userType: Schema.Literal("admin", "customer", "system"),
  action: Schema.String,
  resourceType: Schema.String,
  resourceId: Schema.optional(Schema.String),
  changes: Schema.optional(Schema.Unknown), // JSON diff
  metadata: Schema.optional(Schema.Unknown),
  ipAddress: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
  createdAt: Schema.DateFromString
}) {}

// Admin notification
export class AdminNotification extends Schema.Class<AdminNotification>("AdminNotification")({
  id: Schema.String,
  adminId: Schema.optional(Schema.String), // null for broadcast
  type: Schema.String,
  title: Schema.String,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
  priority: Schema.Literal("low", "normal", "high", "urgent"),
  isRead: Schema.Boolean,
  readAt: Schema.optional(Schema.DateFromString),
  createdAt: Schema.DateFromString
}) {}

// Admin settings
export class AdminSettings extends Schema.Class<AdminSettings>("AdminSettings")({
  adminId: Schema.String,
  theme: Schema.Literal("light", "dark", "auto"),
  language: Schema.String,
  timezone: Schema.String,
  notifications: Schema.Struct({
    email: Schema.Boolean,
    push: Schema.Boolean,
    types: Schema.Record(Schema.String, Schema.Boolean)
  }),
  dashboardLayout: Schema.optional(Schema.Array(
    Schema.Struct({
      widget: Schema.String,
      position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
      size: Schema.Struct({ w: Schema.Number, h: Schema.Number })
    })
  ))
}) {}

// Admin with roles
export class AdminWithRoles extends Schema.Class<AdminWithRoles>("AdminWithRoles")({
  admin: AdminUser,
  roles: Schema.Array(AdminRole),
  effectivePermissions: Schema.Array(Permission)
}) {}

// Dashboard stats
export class DashboardStats extends Schema.Class<DashboardStats>("DashboardStats")({
  orders: Schema.Struct({
    today: Schema.Number,
    thisWeek: Schema.Number,
    thisMonth: Schema.Number,
    total: Schema.Number
  }),
  revenue: Schema.Struct({
    today: Schema.Number,
    thisWeek: Schema.Number,
    thisMonth: Schema.Number,
    total: Schema.Number
  }),
  customers: Schema.Struct({
    new: Schema.Number,
    returning: Schema.Number,
    total: Schema.Number
  }),
  products: Schema.Struct({
    active: Schema.Number,
    outOfStock: Schema.Number,
    total: Schema.Number
  })
}) {}
```

## Service Implementation

### File: `apps/backend/src/services/admin.ts`
```typescript
import { Context, Effect, Layer, Option, pipe } from "effect"
import { Database } from "./database"
import { IdService } from "./id"
import { AuthContext } from "./auth"
import { 
  AdminUser, 
  AdminRole, 
  AdminWithRoles,
  AuditLog,
  AdminNotification,
  AdminSettings,
  DashboardStats,
  Permission
} from "@/packages/api/src/admin/schemas"

// Errors
export class AdminNotFoundError extends Schema.TaggedError<AdminNotFoundError>()(
  "AdminNotFoundError",
  {
    adminId: Schema.String
  }
) {}

export class RoleNotFoundError extends Schema.TaggedError<RoleNotFoundError>()(
  "RoleNotFoundError",
  {
    roleId: Schema.String
  }
) {}

// Service
export class AdminService extends Context.Tag("AdminService")<
  AdminService,
  {
    readonly get: (adminId: string) => Effect.Effect<AdminWithRoles, AdminNotFoundError>
    readonly list: (filters?: { role?: string; active?: boolean }) => Effect.Effect<AdminWithRoles[]>
    readonly create: (data: CreateAdminRequest) => Effect.Effect<AdminUser>
    readonly update: (adminId: string, data: UpdateAdminRequest) => Effect.Effect<AdminUser>
    readonly delete: (adminId: string) => Effect.Effect<void>
    readonly assignRole: (adminId: string, roleId: string) => Effect.Effect<void>
    readonly removeRole: (adminId: string, roleId: string) => Effect.Effect<void>
    readonly getEffectivePermissions: (adminId: string) => Effect.Effect<Permission[]>
  }
>() {}

export class RoleService extends Context.Tag("RoleService")<
  RoleService,
  {
    readonly get: (roleId: string) => Effect.Effect<AdminRole, RoleNotFoundError>
    readonly list: () => Effect.Effect<AdminRole[]>
    readonly create: (data: CreateRoleRequest) => Effect.Effect<AdminRole>
    readonly update: (roleId: string, data: UpdateRoleRequest) => Effect.Effect<AdminRole>
    readonly delete: (roleId: string) => Effect.Effect<void>
  }
>() {}

export class AuditService extends Context.Tag("AuditService")<
  AuditService,
  {
    readonly log: (entry: CreateAuditLogRequest) => Effect.Effect<void>
    readonly query: (filters: AuditLogFilters) => Effect.Effect<AuditLog[]>
    readonly getResourceHistory: (resourceType: string, resourceId: string) => Effect.Effect<AuditLog[]>
  }
>() {}

export class NotificationService extends Context.Tag("NotificationService")<
  NotificationService,
  {
    readonly send: (notification: CreateNotificationRequest) => Effect.Effect<void>
    readonly getUnread: (adminId: string) => Effect.Effect<AdminNotification[]>
    readonly markAsRead: (notificationId: string) => Effect.Effect<void>
    readonly markAllAsRead: (adminId: string) => Effect.Effect<void>
  }
>() {}

export const AdminServiceLive = Layer.effect(
  AdminService,
  Effect.gen(function* () {
    const db = yield* Database
    const ids = yield* IdService
    const audit = yield* AuditService
    
    const get = (adminId: string) =>
      Effect.gen(function* () {
        const admin = yield* db.get(
          `SELECT * FROM admin_users WHERE id = ?`,
          [adminId]
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new AdminNotFoundError({ adminId })),
            onSome: Effect.succeed
          }))
        )
        
        const roles = yield* db.all(
          `SELECT r.* FROM admin_roles r
           JOIN admin_role_assignments ra ON r.id = ra.role_id
           WHERE ra.admin_id = ?`,
          [adminId]
        )
        
        const effectivePermissions = [
          ...JSON.parse(admin.permissions),
          ...roles.flatMap(r => JSON.parse(r.permissions))
        ].filter((p, i, arr) => arr.indexOf(p) === i) // unique
        
        return new AdminWithRoles({
          admin: new AdminUser({
            id: admin.id,
            email: admin.email,
            firstName: admin.first_name,
            lastName: admin.last_name,
            role: admin.role,
            permissions: JSON.parse(admin.permissions),
            isActive: admin.is_active,
            twoFactorEnabled: admin.two_factor_enabled,
            lastLoginAt: admin.last_login_at ? new Date(admin.last_login_at) : undefined,
            createdAt: new Date(admin.created_at),
            updatedAt: new Date(admin.updated_at)
          }),
          roles: roles.map(r => new AdminRole({
            id: r.id,
            name: r.name,
            description: r.description,
            permissions: JSON.parse(r.permissions),
            isSystem: r.is_system,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at)
          })),
          effectivePermissions
        })
      })
    
    const assignRole = (adminId: string, roleId: string) =>
      Effect.gen(function* () {
        const context = yield* AuthContext
        
        yield* db.run(
          `INSERT OR IGNORE INTO admin_role_assignments (admin_id, role_id, assigned_by)
           VALUES (?, ?, ?)`,
          [adminId, roleId, context.userId]
        )
        
        yield* audit.log({
          action: "assign_role",
          resourceType: "admin",
          resourceId: adminId,
          metadata: { roleId }
        })
      })
    
    return {
      get,
      list: (filters) =>
        Effect.gen(function* () {
          let query = `
            SELECT DISTINCT a.* FROM admin_users a
            LEFT JOIN admin_role_assignments ra ON a.id = ra.admin_id
            WHERE 1=1
          `
          const params: any[] = []
          
          if (filters?.role) {
            query += ` AND (a.role = ? OR ra.role_id = ?)`
            params.push(filters.role, filters.role)
          }
          
          if (filters?.active !== undefined) {
            query += ` AND a.is_active = ?`
            params.push(filters.active ? 1 : 0)
          }
          
          const admins = yield* db.all(query, params)
          return yield* Effect.all(admins.map(a => get(a.id)))
        }),
      create: (data) =>
        Effect.gen(function* () {
          const id = yield* ids.generate("admin")
          const passwordHash = yield* hashPassword(data.password)
          
          yield* db.run(
            `INSERT INTO admin_users (
              id, email, password_hash, first_name, last_name, 
              role, permissions
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              id, data.email, passwordHash, data.firstName, 
              data.lastName, data.role, JSON.stringify(data.permissions || [])
            ]
          )
          
          yield* audit.log({
            action: "create",
            resourceType: "admin",
            resourceId: id,
            changes: data
          })
          
          const result = yield* get(id)
          return result.admin
        }),
      update: (adminId, data) =>
        Effect.gen(function* () {
          const current = yield* get(adminId)
          
          const updates: string[] = []
          const params: any[] = []
          
          if (data.firstName !== undefined) {
            updates.push("first_name = ?")
            params.push(data.firstName)
          }
          
          if (data.lastName !== undefined) {
            updates.push("last_name = ?")
            params.push(data.lastName)
          }
          
          if (data.role !== undefined) {
            updates.push("role = ?")
            params.push(data.role)
          }
          
          if (data.permissions !== undefined) {
            updates.push("permissions = ?")
            params.push(JSON.stringify(data.permissions))
          }
          
          if (data.isActive !== undefined) {
            updates.push("is_active = ?")
            params.push(data.isActive ? 1 : 0)
          }
          
          if (updates.length > 0) {
            updates.push("updated_at = CURRENT_TIMESTAMP")
            params.push(adminId)
            
            yield* db.run(
              `UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`,
              params
            )
            
            yield* audit.log({
              action: "update",
              resourceType: "admin",
              resourceId: adminId,
              changes: data
            })
          }
          
          const result = yield* get(adminId)
          return result.admin
        }),
      delete: (adminId) =>
        Effect.gen(function* () {
          yield* db.run(
            `UPDATE admin_users SET is_active = 0 WHERE id = ?`,
            [adminId]
          )
          
          yield* audit.log({
            action: "delete",
            resourceType: "admin",
            resourceId: adminId
          })
        }),
      assignRole,
      removeRole: (adminId, roleId) =>
        Effect.gen(function* () {
          yield* db.run(
            `DELETE FROM admin_role_assignments WHERE admin_id = ? AND role_id = ?`,
            [adminId, roleId]
          )
          
          yield* audit.log({
            action: "remove_role",
            resourceType: "admin",
            resourceId: adminId,
            metadata: { roleId }
          })
        }),
      getEffectivePermissions: (adminId) =>
        pipe(
          get(adminId),
          Effect.map(result => result.effectivePermissions)
        )
    }
  })
)

export const AuditServiceLive = Layer.effect(
  AuditService,
  Effect.gen(function* () {
    const db = yield* Database
    const ids = yield* IdService
    
    const log = (entry: CreateAuditLogRequest) =>
      Effect.gen(function* () {
        const context = yield* Effect.either(AuthContext)
        
        const userId = Option.match(context, {
          onNone: () => "system",
          onSome: ctx => ctx.value.userId
        })
        
        const userType = Option.match(context, {
          onNone: () => "system" as const,
          onSome: ctx => ctx.value.userType
        })
        
        yield* db.run(
          `INSERT INTO audit_logs (
            id, user_id, user_type, action, resource_type, 
            resource_id, changes, metadata, ip_address, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            yield* ids.generate("audit"),
            userId,
            userType,
            entry.action,
            entry.resourceType,
            entry.resourceId || null,
            entry.changes ? JSON.stringify(entry.changes) : null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.ipAddress || null,
            entry.userAgent || null
          ]
        )
      })
    
    const query = (filters: AuditLogFilters) =>
      Effect.gen(function* () {
        let sql = `SELECT * FROM audit_logs WHERE 1=1`
        const params: any[] = []
        
        if (filters.userId) {
          sql += ` AND user_id = ?`
          params.push(filters.userId)
        }
        
        if (filters.userType) {
          sql += ` AND user_type = ?`
          params.push(filters.userType)
        }
        
        if (filters.action) {
          sql += ` AND action = ?`
          params.push(filters.action)
        }
        
        if (filters.resourceType) {
          sql += ` AND resource_type = ?`
          params.push(filters.resourceType)
        }
        
        if (filters.resourceId) {
          sql += ` AND resource_id = ?`
          params.push(filters.resourceId)
        }
        
        if (filters.startDate) {
          sql += ` AND created_at >= ?`
          params.push(filters.startDate.toISOString())
        }
        
        if (filters.endDate) {
          sql += ` AND created_at <= ?`
          params.push(filters.endDate.toISOString())
        }
        
        sql += ` ORDER BY created_at DESC`
        
        if (filters.limit) {
          sql += ` LIMIT ?`
          params.push(filters.limit)
        }
        
        if (filters.offset) {
          sql += ` OFFSET ?`
          params.push(filters.offset)
        }
        
        const rows = yield* db.all(sql, params)
        
        return rows.map(row => new AuditLog({
          id: row.id,
          userId: row.user_id,
          userType: row.user_type,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          changes: row.changes ? JSON.parse(row.changes) : undefined,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: new Date(row.created_at)
        }))
      })
    
    return {
      log,
      query,
      getResourceHistory: (resourceType, resourceId) =>
        query({ resourceType, resourceId })
    }
  })
)

// Dashboard service
export class DashboardService extends Context.Tag("DashboardService")<
  DashboardService,
  {
    readonly getStats: () => Effect.Effect<DashboardStats>
    readonly getRecentOrders: (limit?: number) => Effect.Effect<Order[]>
    readonly getRecentCustomers: (limit?: number) => Effect.Effect<Customer[]>
    readonly getLowStockProducts: (threshold?: number) => Effect.Effect<Product[]>
  }
>() {}

export const DashboardServiceLive = Layer.effect(
  DashboardService,
  Effect.gen(function* () {
    const db = yield* Database
    
    const getStats = () =>
      Effect.gen(function* () {
        // Order stats
        const orderStats = yield* db.get(`
          SELECT 
            COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as today,
            COUNT(CASE WHEN date(created_at) >= date('now', '-7 days') THEN 1 END) as this_week,
            COUNT(CASE WHEN date(created_at) >= date('now', 'start of month') THEN 1 END) as this_month,
            COUNT(*) as total
          FROM orders
        `).pipe(Effect.map(Option.getOrElse(() => ({
          today: 0, this_week: 0, this_month: 0, total: 0
        }))))
        
        // Revenue stats
        const revenueStats = yield* db.get(`
          SELECT 
            COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN total_amount END), 0) as today,
            COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-7 days') THEN total_amount END), 0) as this_week,
            COALESCE(SUM(CASE WHEN date(created_at) >= date('now', 'start of month') THEN total_amount END), 0) as this_month,
            COALESCE(SUM(total_amount), 0) as total
          FROM orders
          WHERE payment_status = 'paid'
        `).pipe(Effect.map(Option.getOrElse(() => ({
          today: 0, this_week: 0, this_month: 0, total: 0
        }))))
        
        // Customer stats
        const customerStats = yield* db.get(`
          SELECT 
            COUNT(CASE WHEN date(created_at) >= date('now', '-30 days') THEN 1 END) as new,
            COUNT(CASE WHEN id IN (SELECT DISTINCT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) > 1) THEN 1 END) as returning,
            COUNT(*) as total
          FROM customers
        `).pipe(Effect.map(Option.getOrElse(() => ({
          new: 0, returning: 0, total: 0
        }))))
        
        // Product stats
        const productStats = yield* db.get(`
          SELECT 
            COUNT(CASE WHEN is_active = 1 THEN 1 END) as active,
            COUNT(CASE WHEN id IN (SELECT product_id FROM inventory WHERE quantity = 0) THEN 1 END) as out_of_stock,
            COUNT(*) as total
          FROM products
        `).pipe(Effect.map(Option.getOrElse(() => ({
          active: 0, out_of_stock: 0, total: 0
        }))))
        
        return new DashboardStats({
          orders: orderStats,
          revenue: revenueStats,
          customers: customerStats,
          products: productStats
        })
      })
    
    return {
      getStats,
      getRecentOrders: (limit = 10) =>
        Effect.gen(function* () {
          const orders = yield* db.all(
            `SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`,
            [limit]
          )
          return yield* Effect.all(orders.map(o => OrderService.get(OrderId(o.id))))
        }),
      getRecentCustomers: (limit = 10) =>
        Effect.gen(function* () {
          const customers = yield* db.all(
            `SELECT * FROM customers ORDER BY created_at DESC LIMIT ?`,
            [limit]
          )
          return yield* Effect.all(customers.map(c => CustomerService.get(CustomerId(c.id))))
        }),
      getLowStockProducts: (threshold = 10) =>
        Effect.gen(function* () {
          const products = yield* db.all(
            `SELECT p.* FROM products p
             JOIN inventory i ON p.id = i.product_id
             WHERE i.quantity <= ?
             ORDER BY i.quantity ASC`,
            [threshold]
          )
          return yield* Effect.all(products.map(p => ProductService.get(ProductId(p.id))))
        })
    }
  })
)

// Admin middleware
export const requireAdmin = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const context = yield* AuthContext
    
    if (context.userType !== "admin") {
      yield* Effect.fail(new InsufficientPermissionsError({
        required: ["admin:read"],
        actual: context.permissions
      }))
    }
    
    return yield* self
  })

export const requireSuperAdmin = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const context = yield* AuthContext
    const admin = yield* AdminService
    const adminData = yield* admin.get(context.userId)
    
    if (adminData.admin.role !== "super_admin") {
      yield* Effect.fail(new InsufficientPermissionsError({
        required: ["admin:write"],
        actual: context.permissions
      }))
    }
    
    return yield* self
  })

// Audit decorator
export const withAudit = (
  action: string,
  resourceType: string,
  getResourceId?: (input: any) => string
) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const audit = yield* AuditService
    const startTime = Date.now()
    
    const result = yield* Effect.either(self)
    
    if (result._tag === "Right") {
      yield* audit.log({
        action,
        resourceType,
        resourceId: getResourceId?.(result.right),
        metadata: {
          duration: Date.now() - startTime,
          success: true
        }
      })
    } else {
      yield* audit.log({
        action: `${action}_failed`,
        resourceType,
        metadata: {
          duration: Date.now() - startTime,
          success: false,
          error: result.left
        }
      })
    }
    
    return yield* Effect.fromEither(result)
  })
```

## API Definition

### File: `apps/backend/src/api/admin.ts`
```typescript
import { Schema } from "@effect/schema"
import { Effect, pipe } from "effect"
import { Api, ApiGroup, Handler } from "effect-http"
import { 
  AdminUser,
  AdminRole,
  AdminWithRoles,
  AuditLog,
  AdminNotification,
  DashboardStats
} from "@/packages/api/src/admin/schemas"

export const adminApi = pipe(
  ApiGroup.make("admin", {
    description: "Admin management endpoints"
  }),
  ApiGroup.addEndpoint(
    Api.get("dashboard", "/admin/dashboard").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setResponseBody(DashboardStats)
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("admins", "/admin/admins").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        role: Schema.optional(Schema.String),
        active: Schema.optional(Schema.BooleanFromString)
      })),
      Api.setResponseBody(Schema.Array(AdminWithRoles))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("admin", "/admin/admins/:id").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setResponseBody(AdminWithRoles)
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("createAdmin", "/admin/admins").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        email: Schema.String,
        password: Schema.String,
        firstName: Schema.String,
        lastName: Schema.String,
        role: Schema.Literal("admin", "support"),
        permissions: Schema.optional(Schema.Array(Permission))
      })),
      Api.setResponseBody(AdminUser)
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("roles", "/admin/roles").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setResponseBody(Schema.Array(AdminRole))
    )
  ),
  ApiGroup.addEndpoint(
    Api.post("assignRole", "/admin/admins/:id/roles").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestPath(Schema.Struct({
        id: Schema.String
      })),
      Api.setRequestBody(Schema.Struct({
        roleId: Schema.String
      }))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("auditLogs", "/admin/audit-logs").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setRequestQuery(Schema.Struct({
        userId: Schema.optional(Schema.String),
        action: Schema.optional(Schema.String),
        resourceType: Schema.optional(Schema.String),
        startDate: Schema.optional(Schema.DateFromString),
        endDate: Schema.optional(Schema.DateFromString),
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString)
      })),
      Api.setResponseBody(Schema.Array(AuditLog))
    )
  ),
  ApiGroup.addEndpoint(
    Api.get("notifications", "/admin/notifications").pipe(
      Api.setRequestHeaders(Schema.Struct({
        authorization: Schema.String
      })),
      Api.setResponseBody(Schema.Array(AdminNotification))
    )
  )
)
```

## Tests

### File: `apps/backend/src/services/admin.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "bun:test"
import { 
  AdminService, 
  AdminServiceLive,
  AuditService,
  AuditServiceLive,
  DashboardService,
  DashboardServiceLive
} from "./admin"
import { TestDatabase } from "../../test/helpers"

const testLayer = Layer.mergeAll(
  TestDatabase,
  AuditServiceLive,
  AdminServiceLive,
  DashboardServiceLive
)

describe("AdminService", () => {
  it("should create admin with roles", () =>
    Effect.gen(function* () {
      const admin = yield* AdminService
      
      // Create admin
      const newAdmin = yield* admin.create({
        email: "admin@test.com",
        password: "password123",
        firstName: "Test",
        lastName: "Admin",
        role: "admin",
        permissions: ["products:read", "products:write"]
      })
      
      expect(newAdmin.email).toBe("admin@test.com")
      expect(newAdmin.role).toBe("admin")
      
      // Get with roles
      const adminWithRoles = yield* admin.get(newAdmin.id)
      expect(adminWithRoles.effectivePermissions).toContain("products:read")
      expect(adminWithRoles.effectivePermissions).toContain("products:write")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should track audit logs", () =>
    Effect.gen(function* () {
      const audit = yield* AuditService
      
      // Log action
      yield* audit.log({
        action: "create",
        resourceType: "product",
        resourceId: "p123",
        changes: { name: "New Product" }
      })
      
      // Query logs
      const logs = yield* audit.query({
        resourceType: "product",
        resourceId: "p123"
      })
      
      expect(logs.length).toBe(1)
      expect(logs[0].action).toBe("create")
      expect(logs[0].resourceId).toBe("p123")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/db/migrations/009_admin_foundation.sql`
```sql
-- Admin roles table
CREATE TABLE IF NOT EXISTS admin_roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin role assignments
CREATE TABLE IF NOT EXISTS admin_role_assignments (
  admin_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (admin_id, role_id),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES admin_users(id)
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  changes TEXT,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin activity logs
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Admin notifications
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  priority TEXT DEFAULT 'normal',
  is_read BOOLEAN DEFAULT false,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Admin settings
CREATE TABLE IF NOT EXISTS admin_settings (
  admin_id TEXT PRIMARY KEY,
  theme TEXT DEFAULT 'light',
  language TEXT DEFAULT 'en',
  timezone TEXT DEFAULT 'UTC',
  notifications TEXT,
  dashboard_layout TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, user_type);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);
CREATE INDEX idx_admin_notifications_admin_id ON admin_notifications(admin_id, is_read);

-- Seed system roles
INSERT INTO admin_roles (id, name, description, permissions, is_system) VALUES
(
  'role_super_admin',
  'Super Admin',
  'Full system access',
  '["admin:read","admin:write","products:read","products:write","customers:read","customers:write","orders:manage","settings:read","settings:write"]',
  1
),
(
  'role_admin',
  'Admin',
  'General admin access',
  '["products:read","products:write","customers:read","orders:manage"]',
  1
),
(
  'role_support',
  'Support',
  'Customer support access',
  '["customers:read","orders:manage"]',
  1
);
```

## Next Steps

1. Implement admin activity tracking
2. Add real-time notifications
3. Create admin session management
4. Add IP whitelisting
5. Implement admin 2FA enforcement
6. Add admin action approval workflow
7. Create admin dashboard widgets
8. Implement export functionality for audit logs

This admin foundation provides:
- Role-based access control
- Comprehensive audit logging
- Admin user management
- Dashboard statistics
- Notification system
- Settings management
- Middleware for admin routes
- Activity tracking