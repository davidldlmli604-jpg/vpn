// Хранилище данных на Windows: файл на диске. Сама логика — в shared/dataStore.ts (общая с Android).
// Ключи (ссылки и параметры подключения) лежат в файле только в зашифрованном виде:
// шифрование делает система (в Windows — DPAPI, привязка к вашей учётной записи).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { maskKey } from '../core'
import { DataStore as SharedDataStore, type Sealer, type StoreBackend } from '../shared/dataStore'

export * from '../shared/dataStore'

export function fileBackend(file: string): StoreBackend {
  return {
    read: () => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    write: (text) => {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, text, { mode: 0o600 })
      renameSync(tmp, file)
    },
    quarantine: () => renameSync(file, `${file}.broken-${Date.now()}`)
  }
}

export class DataStore extends SharedDataStore {
  constructor(file: string, sealer: Sealer) {
    super(fileBackend(file), sealer)
  }
}

export { maskKey }
