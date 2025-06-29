import { BunFileSystem } from "@effect/platform-bun";
import { SqlClient } from "@effect/sql";
import { SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect, Layer } from "effect";
import * as path from "node:path";
import { DatabaseLive } from "./database";

const migrationDirectory = path.join(import.meta.dir, "migrations");

export const MigratorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* SqliteMigrator.run({
      loader: SqliteMigrator.fromBabelGlob({
        directory: migrationDirectory,
        include: /^.*\.ts$/,
      }),
      schemaDirectory: "product",
    });
  }).pipe(
    Effect.provide(DatabaseLive),
    Effect.provide(BunFileSystem.layer)
  )
);