import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Schema } from "effect";

export class Product extends Schema.Class<Product>("Product")({
  id: Schema.Number,
  name: Schema.String,
  price: Schema.Number,
  created_at: Schema.String,
}) {}

class ProductGroup extends HttpApiGroup.make("product")
  .add(
    HttpApiEndpoint.post("createProduct")`/product/create`
      .setPayload(Schema.Struct({ name: Schema.String, price: Schema.Number }))
      .addError(Schema.String)
      .addSuccess(Product)
  )
  .add(
    HttpApiEndpoint.get(
      "getProduct"
    )`/product/get/${HttpApiSchema.param("id", Schema.NumberFromString)}`
      .addError(Schema.String)
      .addSuccess(Product)
  ) {}

export class ServerApi extends HttpApi.make("server-api").add(ProductGroup) {}