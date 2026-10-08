import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Logger } from '@nestjs/common'

import { AppModule } from 'benchmarks/app/app.module.js'

async function main() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  )
  await app.listen(3000, '0.0.0.0')
  Logger.log('Server started on http://127.0.0.1:3000', 'NestApplication')
}

await main()
