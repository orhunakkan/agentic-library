import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { voicesDirOf } from './src/server/config.ts'
import { headersFor } from './src/server/static-cache.ts'
import { VOICES_PREFIX, voiceResponse } from './src/server/voices-static.ts'
import { engineFile, RUN_CODE_PREFIX } from './src/shared/run-code/engines.ts'

export default defineConfig(({ command }) => {
  if (command === 'build') prerenderEnv()
  return {
    server: { port: 3000 },
    preview: { host: '127.0.0.1' },
    resolve: { tsconfigPaths: true },
    optimizeDeps: { exclude: ['@resvg/resvg-js', 'onnxruntime-web'] },
    worker: { format: 'es' },
    plugins: [
      folioVoices(),
      runCodeEngines(),
      tailwindcss(),
      tanstackStart({
        spa: { enabled: true, maskPath: '/', prerender: { outputPath: '/_shell', crawlLinks: false } },
        prerender: { autoStaticPathsDiscovery: false },
      }),
      viteReact(),
    ],
  }
})

function folioVoices(): Plugin {
  return {
    name: 'folio-voices',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(VOICES_PREFIX)) return next()
        const range = req.headers.range
        const request = new Request(new URL(req.url, 'http://localhost'), {
          method: req.method,
          headers: range ? { range } : {},
        })
        voiceResponse(request, voicesDirOf(process.env)).then((response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers))
          if (response.body) Readable.fromWeb(response.body as never).pipe(res)
          else res.end()
        }, next)
      })
    },
  }
}

function runCodeEngines(): Plugin {
  return {
    name: 'run-code-engines',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? ''
        if (!pathname.startsWith(RUN_CODE_PREFIX)) return next()
        const found = engineFile(pathname)
        if (!found || (req.method !== 'GET' && req.method !== 'HEAD')) {
          res.writeHead(404, { 'content-type': 'text/plain', 'x-content-type-options': 'nosniff' })
          return res.end('Not found')
        }
        const path = fileURLToPath(new URL(`./node_modules/${found.package}/${found.file}`, import.meta.url))
        stat(path).then((info) => {
          const type = engineContentType(pathname)
          res.writeHead(200, {
            ...(type ? { 'content-type': type } : {}),
            ...headersFor(pathname),
            'content-length': info.size,
          })
          if (req.method === 'HEAD') res.end()
          else createReadStream(path).pipe(res)
        }, next)
      })
    },
  }
}

function engineContentType(pathname: string): string {
  if (pathname.endsWith('.json')) return 'application/json'
  if (pathname.endsWith('.zip')) return 'application/zip'
  return ''
}

function prerenderEnv() {
  process.env.DATABASE_URL ||= 'postgres://prerender@127.0.0.1:1/prerender'
  process.env.KEK ||= randomBytes(32).toString('base64')
  process.env.APP_ORIGIN ||= 'http://localhost:3000'
}
