import { Module } from '@dunx/core'
import { Controller, Get, HttpFactory, Post, type Input } from '@dunx/http'

interface EchoDto {
  name?: string
  data?: Record<string, unknown>
}

@Controller()
export class AppController {
  @Get('/')
  public index() {
    return {
      msg: 'Hello, world!',
    }
  }

  @Post('/echo')
  public async echo(input: Input<any>) {
    const body = (await input.req.json()) as EchoDto
    return {
      msg: `Hello, ${body.name ?? 'world'}!`,
      echo: body.data ?? {},
      timestamp: Date.now(),
    }
  }
}

@Module({
  controllers: [AppController],
})
export class AppModule {}

async function main() {
  const app = await HttpFactory.create(AppModule, {
    requestLogging: false,
    bootLogging: false,
  })
  await app.listen(3000)
  console.log('Server started on http://127.0.0.1:3000')
}

await main()
