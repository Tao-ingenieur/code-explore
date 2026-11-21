import fs from 'node:fs'
import path from 'node:path'
import { BUILD } from './lib.mjs'

// Keep content-addressed raw source/data between builds. prepare-dist mirrors
// them incrementally and removes stale entries; only frontend assets are cleaned.
const dist = BUILD
for (const name of ['assets', 'index.html', '404.html', 'static-deploy.json', 'report']) {
  fs.rmSync(path.join(dist, name), { recursive: true, force: true })
}
