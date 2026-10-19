import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export function createStore(path) {
  let queue = Promise.resolve()
  const read = async () => JSON.parse(await readFile(path, 'utf8'))
  function update(change) {
    const operation = queue.then(async () => {
      const db = await read()
      const result = await change(db)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(`${path}.tmp`, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 })
      await rename(`${path}.tmp`, path)
      return result
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { read, update }
}
