import { Module } from '@dunx/core'
import { Gateway, HttpFactory, OnMessage, OnOpen, type Socket } from '@dunx/http'

@Gateway('/')
class AppGateway {
  @OnOpen()
  public handleConnection(socket: Socket) {
    socket.subscribe('room')
  }

  @OnMessage('peek')
  public findAll(data: string, socket: Socket) {
    socket.publishText('room', JSON.stringify({ event: 'aboo', data }))
  }
}

@Module({
  providers: [AppGateway],
})
export class AppModule {}

async function main() {
  const app = await HttpFactory.create(AppModule, {
    websocket: {
      publishToSelf: true,
      perMessageDeflate: false,
    },
    requestLogging: false,
    bootLogging: false,
  })
  await app.listen(3000)
  console.log('Server started on http://localhost:3000')
}

await main()
