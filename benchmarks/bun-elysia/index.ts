import { Elysia } from 'elysia'

interface EchoDto {
  name?: string
  data?: Record<string, unknown>
}

export const app = new Elysia()
  .get('/', () => {
    return { msg: 'Hello, world!' }
  })
  .post('/echo', ({ body }) => {
    const typedBody = body as EchoDto | undefined
    return {
      msg: `Hello, ${typedBody?.name ?? 'world'}!`,
      echo: typedBody?.data ?? {},
      timestamp: Date.now(),
    }
  })
  .listen(3000)

console.log(`Server started on http://127.0.0.1:3000`)
