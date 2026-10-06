import { createServer } from 'node:net'

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, host, () => srv.close(() => resolve(true)))
  })
}

export function randomFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, host, () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

/** Берёт желаемый порт, а если он занят — любой свободный. */
export async function pickPort(preferred: number): Promise<number> {
  if (preferred >= 1024 && preferred <= 65535 && (await isPortFree(preferred))) return preferred
  return randomFreePort()
}
