# Task 03: Product Catalog

## Overview
Implement the product catalog system with categories, variants, and inventory tracking. This provides the foundation for the e-commerce store.

## Database Schema

```sql
-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT,
  status TEXT DEFAULT 'draft', -- draft, published, archived
  base_price DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  weight INTEGER, -- in grams
  metadata TEXT, -- JSON for custom fields
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Product variants table
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price DECIMAL(10, 2), -- NULL means use product base_price
  attributes TEXT NOT NULL, -- JSON (size, color, etc.)
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Product images table
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  variant_id TEXT, -- NULL means applies to all variants
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id TEXT UNIQUE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  track_inventory BOOLEAN DEFAULT true,
  allow_backorder BOOLEAN DEFAULT false,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_categories_slug ON categories(slug);
CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_product_variants_sku ON product_variants(sku);
CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_inventory_variant_id ON inventory(variant_id);
```

## Effect Schemas

### File: `packages/api/src/product/schemas.ts`
```typescript
import { Schema } from "@effect/schema"
import { ProductId, ProductIdSchema, CategoryId, CategoryIdSchema, VariantId, VariantIdSchema } from "../common/id"

// Category schemas
export class Category extends Schema.Class<Category>("Category")({
  id: CategoryIdSchema,
  slug: Schema.String.pipe(Schema.pattern(/^[a-z0-9-]+$/)),
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  parentId: Schema.optional(CategoryIdSchema),
  sortOrder: Schema.Number.pipe(Schema.int()),
  isActive: Schema.Boolean,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Product status enum
export const ProductStatus = Schema.Literal("draft", "published", "archived")
export type ProductStatus = Schema.Schema.Type<typeof ProductStatus>

// Product schemas
export class Product extends Schema.Class<Product>("Product")({
  id: ProductIdSchema,
  slug: Schema.String.pipe(Schema.pattern(/^[a-z0-9-]+$/)),
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  categoryId: Schema.optional(CategoryIdSchema),
  status: ProductStatus,
  basePrice: Schema.Number.pipe(Schema.positive()),
  currency: Schema.String.pipe(Schema.length(3)),
  weight: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

// Variant attributes (flexible schema for different product types)
export const VariantAttributes = Schema.Record(Schema.String, Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean
))

export class ProductVariant extends Schema.Class<ProductVariant>("ProductVariant")({
  id: VariantIdSchema,
  productId: ProductIdSchema,
  sku: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String,
  price: Schema.optional(Schema.Number.pipe(Schema.positive())),
  attributes: VariantAttributes,
  sortOrder: Schema.Number.pipe(Schema.int()),
  isActive: Schema.Boolean,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
}) {}

export class ProductImage extends Schema.Class<ProductImage>("ProductImage")({
  id: Schema.Number,
  productId: ProductIdSchema,
  variantId: Schema.optional(VariantIdSchema),
  url: Schema.String.pipe(Schema.startsWith("http")),
  altText: Schema.optional(Schema.String),
  sortOrder: Schema.Number.pipe(Schema.int()),
  isPrimary: Schema.Boolean,
  createdAt: Schema.DateFromSelf
}) {}

export class Inventory extends Schema.Class<Inventory>("Inventory")({
  id: Schema.Number,
  variantId: VariantIdSchema,
  quantity: Schema.Number.pipe(Schema.int()),
  reservedQuantity: Schema.Number.pipe(Schema.int()),
  lowStockThreshold: Schema.Number.pipe(Schema.int()),
  trackInventory: Schema.Boolean,
  allowBackorder: Schema.Boolean,
  updatedAt: Schema.DateFromSelf
}) {
  get availableQuantity(): number {
    return this.trackInventory 
      ? Math.max(0, this.quantity - this.reservedQuantity)
      : Number.MAX_SAFE_INTEGER
  }
  
  get isInStock(): boolean {
    return this.allowBackorder || this.availableQuantity > 0
  }
  
  get isLowStock(): boolean {
    return this.trackInventory && this.availableQuantity <= this.lowStockThreshold
  }
}

// Complete product with all related data
export class ProductWithDetails extends Schema.Class<ProductWithDetails>("ProductWithDetails")({
  product: Product,
  category: Schema.optional(Category),
  variants: Schema.Array(ProductVariant),
  images: Schema.Array(ProductImage),
  inventory: Schema.Array(Inventory)
}) {}

// Request/Response schemas
export class ProductListRequest extends Schema.Class<ProductListRequest>("ProductListRequest")({
  page: Schema.Number.pipe(Schema.int(), Schema.positive()).pipe(Schema.optional),
  pageSize: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(100)).pipe(Schema.optional),
  category: Schema.optional(Schema.String),
  status: Schema.optional(ProductStatus),
  search: Schema.optional(Schema.String),
  minPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  maxPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  inStock: Schema.optional(Schema.Boolean),
  sortBy: Schema.optional(Schema.Literal("name", "price", "createdAt")),
  sortOrder: Schema.optional(Schema.Literal("asc", "desc"))
}) {
  static readonly defaults = {
    page: 1,
    pageSize: 20,
    sortBy: "createdAt" as const,
    sortOrder: "desc" as const
  }
}

// Simplified product for listings
export class ProductSummary extends Schema.Class<ProductSummary>("ProductSummary")({
  id: ProductIdSchema,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  price: Schema.Number,
  currency: Schema.String,
  primaryImage: Schema.optional(ProductImage),
  category: Schema.optional(Category),
  inStock: Schema.Boolean,
  variantCount: Schema.Number
}) {}
```

## Product Service

### File: `apps/backend/src/services/ProductService.ts`
```typescript
import { Context, Effect, Layer, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema/Schema"
import { 
  Product, ProductWithDetails, ProductSummary, ProductListRequest,
  Category, ProductVariant, ProductImage, Inventory, ProductStatus
} from "@turbobun/api/product/schemas"
import { ProductId, CategoryId, VariantId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { NotFoundError, ValidationError } from "@turbobun/api/common/errors"

export class ProductService extends Context.Tag("ProductService")<
  ProductService,
  {
    readonly createProduct: (data: {
      name: string
      slug: string
      description?: string
      categoryId?: CategoryId
      basePrice: number
      variants: Array<{
        sku: string
        name: string
        price?: number
        attributes: Record<string, unknown>
        stock: number
      }>
      images?: Array<{
        url: string
        altText?: string
        isPrimary?: boolean
      }>
    }) => Effect.Effect<ProductWithDetails>
    
    readonly getProduct: (id: ProductId) => Effect.Effect<ProductWithDetails, NotFoundError>
    readonly getProductBySlug: (slug: string) => Effect.Effect<ProductWithDetails, NotFoundError>
    
    readonly listProducts: (request: ProductListRequest) => Effect.Effect<{
      data: ProductSummary[]
      total: number
    }>
    
    readonly updateInventory: (
      variantId: VariantId,
      quantity: number
    ) => Effect.Effect<void>
    
    readonly reserveInventory: (
      items: Array<{ variantId: VariantId; quantity: number }>
    ) => Effect.Effect<void, ValidationError>
    
    readonly releaseInventory: (
      items: Array<{ variantId: VariantId; quantity: number }>
    ) => Effect.Effect<void>
  }
>() {}

export const ProductServiceLive = Layer.effect(
  ProductService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    
    const createProduct = (data: Parameters<ProductService["createProduct"]>[0]) =>
      Effect.gen(function* () {
        const productId = yield* idService.generateProductId
        const now = new Date()
        
        // Validate slug uniqueness
        const existing = yield* sql`
          SELECT id FROM products WHERE slug = ${data.slug}
        `
        if (existing.length > 0) {
          return yield* Effect.fail(new ValidationError({
            field: "slug",
            message: "Slug already exists",
            value: data.slug
          }))
        }
        
        // Create product
        yield* sql`
          INSERT INTO products (
            id, slug, name, description, category_id,
            status, base_price, currency, metadata,
            created_at, updated_at
          ) VALUES (
            ${productId}, ${data.slug}, ${data.name}, ${data.description || null},
            ${data.categoryId || null}, 'draft', ${data.basePrice}, 'USD',
            '{}', ${now}, ${now}
          )
        `
        
        // Create variants and inventory
        const variantIds = yield* Effect.forEach(
          data.variants,
          (variant, index) =>
            Effect.gen(function* () {
              const variantId = yield* idService.generateVariantId
              
              yield* sql`
                INSERT INTO product_variants (
                  id, product_id, sku, name, price, attributes,
                  sort_order, is_active, created_at, updated_at
                ) VALUES (
                  ${variantId}, ${productId}, ${variant.sku}, ${variant.name},
                  ${variant.price || null}, ${JSON.stringify(variant.attributes)},
                  ${index}, true, ${now}, ${now}
                )
              `
              
              yield* sql`
                INSERT INTO inventory (
                  variant_id, quantity, reserved_quantity,
                  low_stock_threshold, track_inventory, allow_backorder
                ) VALUES (
                  ${variantId}, ${variant.stock}, 0, 10, true, false
                )
              `
              
              return variantId
            }),
          { concurrency: "unbounded" }
        )
        
        // Create images
        if (data.images) {
          yield* Effect.forEach(
            data.images,
            (image, index) =>
              sql`
                INSERT INTO product_images (
                  product_id, url, alt_text, sort_order, is_primary
                ) VALUES (
                  ${productId}, ${image.url}, ${image.altText || null},
                  ${index}, ${image.isPrimary || index === 0}
                )
              `,
            { concurrency: "unbounded" }
          )
        }
        
        return yield* getProduct(productId)
      })
    
    const getProduct = (id: ProductId) =>
      Effect.gen(function* () {
        // Get product
        const products = yield* sql`
          SELECT p.*, c.* 
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.id = ${id}
        `
        
        if (products.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Product",
            id
          }))
        }
        
        const productRow = products[0]
        
        // Get variants
        const variants = yield* sql`
          SELECT * FROM product_variants
          WHERE product_id = ${id}
          ORDER BY sort_order
        `
        
        // Get images
        const images = yield* sql`
          SELECT * FROM product_images
          WHERE product_id = ${id}
          ORDER BY sort_order
        `
        
        // Get inventory
        const inventory = yield* sql`
          SELECT i.* FROM inventory i
          JOIN product_variants v ON i.variant_id = v.id
          WHERE v.product_id = ${id}
        `
        
        return new ProductWithDetails({
          product: new Product({
            id,
            slug: productRow.slug,
            name: productRow.name,
            description: productRow.description,
            categoryId: productRow.category_id,
            status: productRow.status as ProductStatus,
            basePrice: Number(productRow.base_price),
            currency: productRow.currency,
            weight: productRow.weight,
            metadata: JSON.parse(productRow.metadata || "{}"),
            createdAt: new Date(productRow.created_at),
            updatedAt: new Date(productRow.updated_at)
          }),
          category: productRow.category_id ? new Category({
            id: productRow.category_id,
            slug: productRow.c_slug,
            name: productRow.c_name,
            description: productRow.c_description,
            parentId: productRow.c_parent_id,
            sortOrder: productRow.c_sort_order,
            isActive: Boolean(productRow.c_is_active),
            metadata: JSON.parse(productRow.c_metadata || "{}"),
            createdAt: new Date(productRow.c_created_at),
            updatedAt: new Date(productRow.c_updated_at)
          }) : undefined,
          variants: variants.map(v => new ProductVariant({
            id: v.id,
            productId: v.product_id,
            sku: v.sku,
            name: v.name,
            price: v.price ? Number(v.price) : undefined,
            attributes: JSON.parse(v.attributes),
            sortOrder: v.sort_order,
            isActive: Boolean(v.is_active),
            createdAt: new Date(v.created_at),
            updatedAt: new Date(v.updated_at)
          })),
          images: images.map(i => new ProductImage({
            id: i.id,
            productId: i.product_id,
            variantId: i.variant_id,
            url: i.url,
            altText: i.alt_text,
            sortOrder: i.sort_order,
            isPrimary: Boolean(i.is_primary),
            createdAt: new Date(i.created_at)
          })),
          inventory: inventory.map(i => new Inventory({
            id: i.id,
            variantId: i.variant_id,
            quantity: i.quantity,
            reservedQuantity: i.reserved_quantity,
            lowStockThreshold: i.low_stock_threshold,
            trackInventory: Boolean(i.track_inventory),
            allowBackorder: Boolean(i.allow_backorder),
            updatedAt: new Date(i.updated_at)
          }))
        })
      })
    
    const getProductBySlug = (slug: string) =>
      Effect.gen(function* () {
        const products = yield* sql`
          SELECT id FROM products WHERE slug = ${slug}
        `
        
        if (products.length === 0) {
          return yield* Effect.fail(new NotFoundError({
            resource: "Product",
            id: slug
          }))
        }
        
        return yield* getProduct(products[0].id as ProductId)
      })
    
    const listProducts = (request: ProductListRequest) =>
      Effect.gen(function* () {
        const params = { ...ProductListRequest.defaults, ...request }
        const offset = (params.page - 1) * params.pageSize
        
        // Build query conditions
        const conditions: string[] = ["p.status = 'published'"]
        const values: unknown[] = []
        
        if (params.category) {
          conditions.push("c.slug = ?")
          values.push(params.category)
        }
        
        if (params.search) {
          conditions.push("(p.name LIKE ? OR p.description LIKE ?)")
          const searchTerm = `%${params.search}%`
          values.push(searchTerm, searchTerm)
        }
        
        if (params.minPrice !== undefined) {
          conditions.push("p.base_price >= ?")
          values.push(params.minPrice)
        }
        
        if (params.maxPrice !== undefined) {
          conditions.push("p.base_price <= ?")
          values.push(params.maxPrice)
        }
        
        const whereClause = conditions.length > 0 
          ? `WHERE ${conditions.join(" AND ")}`
          : ""
        
        // Count total
        const countQuery = `
          SELECT COUNT(DISTINCT p.id) as total
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ${whereClause}
        `
        
        const countResult = yield* Effect.tryPromise(() =>
          sql.unsafe(countQuery, values)
        )
        const total = countResult[0].total
        
        // Get products
        const orderBy = params.sortBy === "price" ? "p.base_price" : `p.${params.sortBy}`
        const productsQuery = `
          SELECT 
            p.*,
            c.id as category_id, c.slug as category_slug, c.name as category_name,
            pi.url as image_url, pi.alt_text as image_alt,
            COUNT(DISTINCT v.id) as variant_count,
            MIN(CASE 
              WHEN i.track_inventory = 0 OR i.allow_backorder = 1 THEN 1
              WHEN i.quantity - i.reserved_quantity > 0 THEN 1
              ELSE 0
            END) as in_stock
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN product_variants v ON p.id = v.product_id
          LEFT JOIN inventory i ON v.id = i.variant_id
          LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
          ${whereClause}
          GROUP BY p.id
          ORDER BY ${orderBy} ${params.sortOrder}
          LIMIT ? OFFSET ?
        `
        
        values.push(params.pageSize, offset)
        
        const products = yield* Effect.tryPromise(() =>
          sql.unsafe(productsQuery, values)
        )
        
        const data = products.map(p => new ProductSummary({
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          price: Number(p.base_price),
          currency: p.currency,
          primaryImage: p.image_url ? new ProductImage({
            id: 0,
            productId: p.id,
            url: p.image_url,
            altText: p.image_alt,
            sortOrder: 0,
            isPrimary: true,
            createdAt: new Date()
          }) : undefined,
          category: p.category_id ? new Category({
            id: p.category_id,
            slug: p.category_slug,
            name: p.category_name,
            sortOrder: 0,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }) : undefined,
          inStock: Boolean(p.in_stock),
          variantCount: p.variant_count
        }))
        
        return { data, total }
      })
    
    const updateInventory = (variantId: VariantId, quantity: number) =>
      sql`
        UPDATE inventory 
        SET quantity = ${quantity}, updated_at = CURRENT_TIMESTAMP
        WHERE variant_id = ${variantId}
      `.pipe(Effect.asUnit)
    
    const reserveInventory = (items: Array<{ variantId: VariantId; quantity: number }>) =>
      Effect.gen(function* () {
        // Check availability first
        for (const item of items) {
          const inventory = yield* sql`
            SELECT * FROM inventory WHERE variant_id = ${item.variantId}
          `
          
          if (inventory.length === 0) {
            return yield* Effect.fail(new ValidationError({
              field: "variantId",
              message: "Variant not found",
              value: item.variantId
            }))
          }
          
          const inv = inventory[0]
          const available = inv.quantity - inv.reserved_quantity
          
          if (inv.track_inventory && !inv.allow_backorder && available < item.quantity) {
            return yield* Effect.fail(new ValidationError({
              field: "quantity",
              message: `Insufficient stock. Available: ${available}`,
              value: item.quantity
            }))
          }
        }
        
        // Reserve items
        yield* Effect.forEach(
          items,
          (item) =>
            sql`
              UPDATE inventory 
              SET 
                reserved_quantity = reserved_quantity + ${item.quantity},
                updated_at = CURRENT_TIMESTAMP
              WHERE variant_id = ${item.variantId}
            `,
          { concurrency: "unbounded" }
        )
      })
    
    const releaseInventory = (items: Array<{ variantId: VariantId; quantity: number }>) =>
      Effect.forEach(
        items,
        (item) =>
          sql`
            UPDATE inventory 
            SET 
              reserved_quantity = MAX(0, reserved_quantity - ${item.quantity}),
              updated_at = CURRENT_TIMESTAMP
            WHERE variant_id = ${item.variantId}
          `,
        { concurrency: "unbounded" }
      ).pipe(Effect.asUnit)
    
    return ProductService.of({
      createProduct,
      getProduct,
      getProductBySlug,
      listProducts,
      updateInventory,
      reserveInventory,
      releaseInventory
    })
  })
)
```

## Category Service

### File: `apps/backend/src/services/CategoryService.ts`
```typescript
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { Category } from "@turbobun/api/product/schemas"
import { CategoryId } from "@turbobun/api/common/id"
import { IdService } from "./IdService"
import { NotFoundError } from "@turbobun/api/common/errors"

export class CategoryService extends Context.Tag("CategoryService")<
  CategoryService,
  {
    readonly createCategory: (data: {
      slug: string
      name: string
      description?: string
      parentId?: CategoryId
    }) => Effect.Effect<Category>
    
    readonly getCategory: (id: CategoryId) => Effect.Effect<Category, NotFoundError>
    readonly getCategoryBySlug: (slug: string) => Effect.Effect<Category, NotFoundError>
    
    readonly listCategories: (options?: {
      parentId?: CategoryId | null
      isActive?: boolean
    }) => Effect.Effect<Category[]>
    
    readonly getCategoryTree: () => Effect.Effect<CategoryTree[]>
  }
>() {}

interface CategoryTree extends Category {
  children: CategoryTree[]
}

export const CategoryServiceLive = Layer.effect(
  CategoryService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const idService = yield* IdService
    
    const createCategory = (data: Parameters<CategoryService["createCategory"]>[0]) =>
      Effect.gen(function* () {
        const id = yield* idService.generateCategoryId
        const now = new Date()
        
        yield* sql`
          INSERT INTO categories (
            id, slug, name, description, parent_id,
            sort_order, is_active, metadata,
            created_at, updated_at
          ) VALUES (
            ${id}, ${data.slug}, ${data.name}, ${data.description || null},
            ${data.parentId || null}, 0, true, '{}', ${now}, ${now}
          )
        `
        
        return yield* getCategory(id)
      })
    
    const getCategory = (id: CategoryId) =>
      sql`SELECT * FROM categories WHERE id = ${id}`.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Category({
                ...rows[0],
                metadata: JSON.parse(rows[0].metadata || "{}"),
                isActive: Boolean(rows[0].is_active),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at)
              }))
            : Effect.fail(new NotFoundError({ resource: "Category", id }))
        )
      )
    
    const getCategoryBySlug = (slug: string) =>
      sql`SELECT * FROM categories WHERE slug = ${slug}`.pipe(
        Effect.flatMap(rows =>
          rows.length > 0
            ? Effect.succeed(new Category({
                ...rows[0],
                metadata: JSON.parse(rows[0].metadata || "{}"),
                isActive: Boolean(rows[0].is_active),
                createdAt: new Date(rows[0].created_at),
                updatedAt: new Date(rows[0].updated_at)
              }))
            : Effect.fail(new NotFoundError({ resource: "Category", id: slug }))
        )
      )
    
    const listCategories = (options?: Parameters<CategoryService["listCategories"]>[0]) =>
      Effect.gen(function* () {
        let query = "SELECT * FROM categories WHERE 1=1"
        const params: unknown[] = []
        
        if (options?.parentId !== undefined) {
          query += " AND parent_id " + (options.parentId === null ? "IS NULL" : "= ?")
          if (options.parentId !== null) params.push(options.parentId)
        }
        
        if (options?.isActive !== undefined) {
          query += " AND is_active = ?"
          params.push(options.isActive ? 1 : 0)
        }
        
        query += " ORDER BY sort_order, name"
        
        const rows = yield* Effect.tryPromise(() =>
          sql.unsafe(query, params)
        )
        
        return rows.map(row => new Category({
          ...row,
          metadata: JSON.parse(row.metadata || "{}"),
          isActive: Boolean(row.is_active),
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        }))
      })
    
    const getCategoryTree = () =>
      Effect.gen(function* () {
        const allCategories = yield* listCategories({ isActive: true })
        
        const buildTree = (parentId: CategoryId | null = null): CategoryTree[] => {
          return allCategories
            .filter(cat => cat.parentId === parentId)
            .map(cat => ({
              ...cat,
              children: buildTree(cat.id)
            }))
        }
        
        return buildTree(null)
      })
    
    return CategoryService.of({
      createCategory,
      getCategory,
      getCategoryBySlug,
      listCategories,
      getCategoryTree
    })
  })
)
```

## Product API

### File: `packages/api/src/product/api.ts`
```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import { 
  ProductWithDetails, ProductSummary, ProductListRequest,
  Category, ProductIdSchema 
} from "./schemas"
import { PaginatedResponse } from "../common/response"

class ProductGroup extends HttpApiGroup.make("product")
  .add(
    HttpApiEndpoint.get("listProducts")`/products`
      .setUrlParams(ProductListRequest)
      .addSuccess(PaginatedResponse(ProductSummary))
  )
  .add(
    HttpApiEndpoint.get("getProduct")`/products/${ProductIdSchema("id")}`
      .addSuccess(ProductWithDetails)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getProductBySlug")`/products/slug/${Schema.String("slug")}`
      .addSuccess(ProductWithDetails)
      .addError(Schema.String)
  ) {}

class CategoryGroup extends HttpApiGroup.make("category")
  .add(
    HttpApiEndpoint.get("listCategories")`/categories`
      .addSuccess(Schema.Array(Category))
  )
  .add(
    HttpApiEndpoint.get("getCategoryTree")`/categories/tree`
      .addSuccess(Schema.Unknown) // CategoryTree is recursive
  ) {}

export class ProductApi extends HttpApi.make("product-api")
  .add(ProductGroup)
  .add(CategoryGroup) {}
```

### File: `apps/backend/src/http/api/product.ts`
```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { ProductApi } from "@turbobun/api/product/api"
import { ProductService } from "../../services/ProductService"
import { CategoryService } from "../../services/CategoryService"
import { successResponse, paginatedResponse, errorResponse } from "../response"
import { ProductIdSchema } from "@turbobun/api/common/id"

export const ProductApiLive = HttpApiBuilder.group(
  ProductApi,
  "product",
  (handlers) =>
    handlers
      .handle("listProducts", ({ urlParams }) =>
        Effect.gen(function* () {
          const productService = yield* ProductService
          const result = yield* productService.listProducts(urlParams)
          
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
      .handle("getProduct", ({ path }) =>
        Effect.gen(function* () {
          const productService = yield* ProductService
          const product = yield* productService.getProduct(path.id).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(product)
        })
      )
      .handle("getProductBySlug", ({ path }) =>
        Effect.gen(function* () {
          const productService = yield* ProductService
          const product = yield* productService.getProductBySlug(path.slug).pipe(
            Effect.catchTag("NotFoundError", errorResponse)
          )
          
          return yield* successResponse(product)
        })
      )
)

export const CategoryApiLive = HttpApiBuilder.group(
  ProductApi,
  "category",
  (handlers) =>
    handlers
      .handle("listCategories", () =>
        Effect.gen(function* () {
          const categoryService = yield* CategoryService
          const categories = yield* categoryService.listCategories({ isActive: true })
          
          return yield* successResponse(categories)
        })
      )
      .handle("getCategoryTree", () =>
        Effect.gen(function* () {
          const categoryService = yield* CategoryService
          const tree = yield* categoryService.getCategoryTree()
          
          return yield* successResponse(tree)
        })
      )
)
```

## Tests

### File: `apps/backend/src/services/__tests__/ProductService.test.ts`
```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it, beforeEach } from "bun:test"
import { ProductService, ProductServiceLive } from "../ProductService"
import { CategoryService, CategoryServiceLive } from "../CategoryService"
import { IdServiceLive } from "../IdService"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { ProductStatus } from "@turbobun/api/product/schemas"

const TestDatabaseLive = SqliteClient.layer({
  filename: ":memory:"
})

const testLayer = Layer.mergeAll(
  TestDatabaseLive,
  IdServiceLive,
  ProductServiceLive,
  CategoryServiceLive
)

describe("ProductService", () => {
  beforeEach(() =>
    Effect.gen(function* () {
      // Run migrations
      // ... (migration SQL)
    }).pipe(
      Effect.provide(TestDatabaseLive),
      Effect.runPromise
    )
  )
  
  it("should create a product with variants", () =>
    Effect.gen(function* () {
      const productService = yield* ProductService
      
      const product = yield* productService.createProduct({
        name: "Test Product",
        slug: "test-product",
        description: "A test product",
        basePrice: 99.99,
        variants: [
          {
            sku: "TEST-001",
            name: "Small",
            attributes: { size: "S" },
            stock: 10
          },
          {
            sku: "TEST-002",
            name: "Large",
            price: 109.99,
            attributes: { size: "L" },
            stock: 5
          }
        ],
        images: [
          {
            url: "https://example.com/image.jpg",
            altText: "Test product",
            isPrimary: true
          }
        ]
      })
      
      expect(product.product.name).toBe("Test Product")
      expect(product.variants).toHaveLength(2)
      expect(product.images).toHaveLength(1)
      expect(product.inventory).toHaveLength(2)
      
      // Check variant prices
      const smallVariant = product.variants.find(v => v.name === "Small")
      expect(smallVariant?.price).toBeUndefined() // Uses base price
      
      const largeVariant = product.variants.find(v => v.name === "Large")
      expect(largeVariant?.price).toBe(109.99)
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should handle inventory reservation", () =>
    Effect.gen(function* () {
      const productService = yield* ProductService
      
      const product = yield* productService.createProduct({
        name: "Stock Test",
        slug: "stock-test",
        basePrice: 50,
        variants: [{
          sku: "STOCK-001",
          name: "Default",
          attributes: {},
          stock: 10
        }]
      })
      
      const variantId = product.variants[0].id
      
      // Reserve 5 items
      yield* productService.reserveInventory([
        { variantId, quantity: 5 }
      ])
      
      // Check available quantity
      const updated = yield* productService.getProduct(product.product.id)
      const inventory = updated.inventory[0]
      
      expect(inventory.quantity).toBe(10)
      expect(inventory.reservedQuantity).toBe(5)
      expect(inventory.availableQuantity).toBe(5)
      
      // Try to reserve more than available
      const result = yield* productService.reserveInventory([
        { variantId, quantity: 6 }
      ]).pipe(Effect.either)
      
      expect(result._tag).toBe("Left")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
  
  it("should filter products by criteria", () =>
    Effect.gen(function* () {
      const productService = yield* ProductService
      const categoryService = yield* CategoryService
      
      // Create category
      const category = yield* categoryService.createCategory({
        slug: "electronics",
        name: "Electronics"
      })
      
      // Create products
      yield* productService.createProduct({
        name: "Laptop",
        slug: "laptop",
        categoryId: category.id,
        basePrice: 999,
        variants: [{ sku: "LAP-001", name: "Default", attributes: {}, stock: 5 }]
      })
      
      yield* productService.createProduct({
        name: "Phone",
        slug: "phone",
        categoryId: category.id,
        basePrice: 599,
        variants: [{ sku: "PHN-001", name: "Default", attributes: {}, stock: 0 }]
      })
      
      // Search by category
      const byCategory = yield* productService.listProducts({
        category: "electronics"
      })
      
      expect(byCategory.data).toHaveLength(2)
      
      // Filter by price
      const byPrice = yield* productService.listProducts({
        minPrice: 600,
        maxPrice: 1000
      })
      
      expect(byPrice.data).toHaveLength(1)
      expect(byPrice.data[0].name).toBe("Laptop")
      
      // Filter by stock
      const inStock = yield* productService.listProducts({
        inStock: true
      })
      
      expect(inStock.data).toHaveLength(1)
      expect(inStock.data[0].name).toBe("Laptop")
    }).pipe(
      Effect.provide(testLayer),
      Effect.runPromise
    )
  )
})
```

## Migration

### File: `apps/backend/src/migrations/0003_product_catalog.ts`
```typescript
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  
  // Create all tables
  yield* sql`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category_id TEXT,
      status TEXT DEFAULT 'draft',
      base_price DECIMAL(10, 2) NOT NULL,
      currency TEXT DEFAULT 'USD',
      weight INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price DECIMAL(10, 2),
      attributes TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER DEFAULT 0,
      is_primary BOOLEAN DEFAULT false,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )
  `
  
  yield* sql`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id TEXT UNIQUE NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      reserved_quantity INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER DEFAULT 10,
      track_inventory BOOLEAN DEFAULT true,
      allow_backorder BOOLEAN DEFAULT false,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )
  `
  
  // Create indexes
  const indexes = [
    "CREATE INDEX idx_categories_slug ON categories(slug)",
    "CREATE INDEX idx_categories_parent_id ON categories(parent_id)",
    "CREATE INDEX idx_products_slug ON products(slug)",
    "CREATE INDEX idx_products_category_id ON products(category_id)",
    "CREATE INDEX idx_products_status ON products(status)",
    "CREATE INDEX idx_product_variants_product_id ON product_variants(product_id)",
    "CREATE INDEX idx_product_variants_sku ON product_variants(sku)",
    "CREATE INDEX idx_product_images_product_id ON product_images(product_id)",
    "CREATE INDEX idx_inventory_variant_id ON inventory(variant_id)"
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
1. Create sample categories and products
2. Test inventory management
3. Verify product search and filtering
4. Move to Task 04: Cart System