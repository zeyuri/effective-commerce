import * as path from 'node:path'
import { BunFileSystem } from '@effect/platform-bun'
import { SqliteMigrator } from '@effect/sql-sqlite-bun'
import { Effect, Layer } from 'effect'
import { DatabaseLive } from './database'

const migrationDirectory = path.join(import.meta.dir, 'migrations')

export const MigratorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    // const sql = yield* SqlClient.SqlClient
    yield* SqliteMigrator.run({
      loader: SqliteMigrator.fromBabelGlob({
        directory: migrationDirectory,
        include: /^.*\.ts$/,
      }),
      schemaDirectory: 'product',
    })
  }).pipe(Effect.provide(DatabaseLive), Effect.provide(BunFileSystem.layer)),
)
