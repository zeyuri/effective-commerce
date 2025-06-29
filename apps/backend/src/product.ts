import { HttpApiBuilder } from "@effect/platform";
import { SqlClient, SqlResolver } from "@effect/sql";
import { Product, ServerApi } from "@turbobun/api";
import { Effect, flow, Function, Layer, Schema } from "effect";
import { DatabaseLive } from "./database";

export const ProductGroupLive = HttpApiBuilder.group(
  ServerApi,
  "product",
  (handlers) =>
    handlers
      .handle("createProduct", ({ payload }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          const InsertProduct = yield* SqlResolver.ordered("InsertProduct", {
            Request: Product.pipe(Schema.omit("id", "created_at")),
            Result: Product,
            execute: (requests) =>
              sql`INSERT INTO products ${sql.insert(requests)} RETURNING *`,
          });

          return yield* InsertProduct.execute({ name: payload.name, price: payload.price });
        }).pipe(
          Effect.tapError(Effect.logError),
          Effect.mapError((error) => error.message)
        )
      )
      .handle("getProduct", ({ path }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          const GetById = yield* SqlResolver.findById("GetProductById", {
            Id: Schema.Number,
            Result: Product,
            ResultId: (_) => _.id,
            execute: (ids) =>
              sql`SELECT * FROM products WHERE ${sql.in("id", ids)}`,
          });

          const getById = flow(
            GetById.execute,
            Effect.withRequestCaching(true)
          );

          return yield* getById(path.id).pipe(
            Effect.flatMap(Function.identity)
          );
        }).pipe(
          Effect.tapError(Effect.logError),
          Effect.mapError((error) => error.message)
        )
      )
).pipe(Layer.provide(DatabaseLive));