Bun.serve({
  port: 3000,
  routes: {
    '/': {
      // Non-static, avoid cheating :)
      GET: () => Response.json({ msg: 'Hello, world!' }),
    },
    '/echo': {
      POST: async (req) => {
        const body = await req.json() as { name?: string; data?: Record<string, unknown> }
        return Response.json({
          msg: `Hello, ${body.name ?? 'world'}!`,
          echo: body.data ?? {},
          timestamp: Date.now(),
        })
      },
    },
  },
})
console.log('Server started on http://localhost:3000')
