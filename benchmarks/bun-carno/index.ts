import 'reflect-metadata';
import { Carno, Controller, Get, Post, Body } from '@carno.js/core';

@Controller('/')
class AppController {
  @Get('/')
  index() {
    return { msg: 'Hello, world!' };
  }

  @Post('/echo')
  echo(@Body() body: any) {
    return {
      msg: `Hello, ${body?.name ?? 'world'}!`,
      echo: body?.data ?? {},
      timestamp: Date.now(),
    };
  }
}

async function main() {
  const app = new Carno();
  app.controllers([AppController]);
  await app.listen(3000);
  console.log('Server started on http://127.0.0.1:3000');
}

await main();
