import 'reflect-metadata';
import {
  BaseController, Controller, Get, Module, OneBunApplication, Post, Body, type,
} from '@onebun/core';

// We can define type for ArkType validation
const EchoDto = type({
  'name?': 'string',
  'data?': 'unknown',
});
type EchoBody = typeof EchoDto.infer;

@Controller('/')
class AppController extends BaseController {
  @Get('/')
  index() {
    return Response.json({ msg: 'Hello, world!' });
  }

  @Post('/echo')
  echo(@Body(EchoDto) body: EchoBody) {
    return Response.json({
      msg: `Hello, ${body?.name ?? 'world'}!`,
      echo: body?.data ?? {},
      timestamp: Date.now(),
    });
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

async function main() {
  const app = new OneBunApplication(AppModule, {
    port: 3000,
    metrics: { enabled: false },
    tracing: { enabled: false },
  });

  await app.start();
  console.log('Server started on http://127.0.0.1:3000');
}

await main();
