import { spawnSync } from 'node:child_process'
import { PYTHON } from './lib.mjs'

const result = spawnSync(PYTHON, process.argv.slice(2), { stdio: 'inherit' })
if (result.error) {
  console.error(`无法启动 Python：${result.error.message}。请安装 Python 3，或设置 PYTHON 为解释器路径。`)
}
process.exit(result.status ?? 1)
