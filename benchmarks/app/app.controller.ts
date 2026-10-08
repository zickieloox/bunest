import { Body, Controller, Get, Post } from '@nestjs/common'

interface EchoDto {
  name: string
  data?: Record<string, unknown>
}

@Controller()
export class AppController {
  @Get()
  public index() {
    return {
      msg: 'Hello, world!',
    }
  }

  @Post('echo')
  public echo(@Body() body: EchoDto) {
    return {
      msg: `Hello, ${body.name ?? 'world'}!`,
      echo: body.data ?? {},
      timestamp: Date.now(),
    }
  }
}
