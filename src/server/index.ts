import { buildApp, defaultDirs } from './app.ts'
import { config } from './config.ts'

const app = buildApp(defaultDirs())

app.listen({ port: config.port, host: config.host }).then(
  () => {
    console.log(`discussion-room listening on http://${config.host}:${config.port}`)
  },
  (err: unknown) => {
    console.error('listen failed:', err)
    process.exit(1)
  },
)
