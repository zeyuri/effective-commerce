# CLAUDE.md - API Package

This file provides guidance for defining API schemas and contracts using Effect's HTTP API system.

## Overview

This package contains the API contract definitions that are shared between the backend implementation and any clients. It uses Effect's `@effect/platform` for type-safe API definitions.

## API Definition Pattern

### 1. Define Data Schemas

Use `@effect/schema` to define your data structures:

```typescript
import { Schema } from "@effect/schema"

export class Product extends Schema.Class<Product>("Product")({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Number,
  // ... other fields
}) {}
```

### 2. Define API Groups

Create API groups using `HttpApiGroup`:

```typescript
import { HttpApiGroup, HttpApiEndpoint, HttpApiSchema } from "@effect/platform"

export class ProductsApiGroup extends HttpApiGroup.make("products")
  .add(
    HttpApiEndpoint.get("getAll")`/products`
      .addSuccess(Schema.Array(Product))
  )
  .add(
    HttpApiEndpoint.get("getById")`/products/${HttpApiSchema.param("id", Schema.String)}`
      .addSuccess(Product)
      .addError(Schema.Never)
  )
  .add(
    HttpApiEndpoint.post("create")`/products`
      .setPayload(CreateProductRequest)
      .addSuccess(Product)
  ) {}
```

### 3. Define the Main API

Combine groups into the main API:

```typescript
import { HttpApi } from "@effect/platform"

export class Api extends HttpApi.make("api")
  .add(ProductsApiGroup)
  .add(OtherApiGroup) {}
```

## Key Patterns

1. **Schema Classes**: Always use `Schema.Class` for data structures to get proper TypeScript types
2. **Endpoint Naming**: Use descriptive names for endpoints (e.g., "getAll", "getById")
3. **Path Parameters**: Use `HttpApiSchema.param()` for type-safe path parameters
4. **Error Types**: Define specific error schemas for each endpoint using `addError()`
5. **Request Bodies**: Use `setPayload()` for POST/PUT request bodies

## File Structure

Keep it simple - everything in one file:
```
src/
└── index.ts          # All API definitions in one place
```

## Best Practices

1. Keep this package pure - no implementation logic
2. Export all schemas and API definitions for use by both server and client
3. Use descriptive names for all schemas and endpoints
4. Document complex schemas with JSDoc comments
5. Version your API by creating new endpoints rather than breaking existing ones