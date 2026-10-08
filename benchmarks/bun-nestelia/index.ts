import 'reflect-metadata';
import { Controller, Get, Post, Body, Module, createElysiaApplication } from 'nestelia';
import { t } from 'elysia';

@Controller()
class AppController {
  @Get('/')
  index() {
    return { msg: 'Hello, world!' };
  }

  @Post('/echo')
  echo(@Body(t.Any()) body: any) {
    return {
      msg: `Hello, ${body?.name ?? 'world'}!`,
      echo: body?.data ?? {},
      timestamp: Date.now(),
    };
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

async function main() {
  const app = await createElysiaApplication(AppModule);
  app.listen(3000);
  console.log('Server started on http://127.0.0.1:3000');
}

await main();
