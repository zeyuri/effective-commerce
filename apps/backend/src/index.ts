import { HttpApiBuilder, HttpMiddleware, HttpServer } from '@effect/platform'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { ServerApi } from '@turbobun/api'
import { Layer } from 'effect'
import { MigratorLive } from './migrator'
import { ProductGroupLive } from './product'

const MainApiLive = HttpApiBuilder.api(ServerApi).pipe(
  Layer.provide([MigratorLive, ProductGroupLive]),
)

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiBuilder.middlewareCors()),
  Layer.provide(MainApiLive),
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 3000 })),
)

BunRuntime.runMain(Layer.launch(HttpLive))
