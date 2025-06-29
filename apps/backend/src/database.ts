import { SqliteClient } from '@effect/sql-sqlite-bun'

export const DatabaseLive = SqliteClient.layer({
  filename: './database.db',
})
