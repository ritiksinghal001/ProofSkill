// Builds the sample ZIPs used by the demo and tests. Run: npm run fixtures
import { zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
function walk(dir: string, base = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, walk(path.join(dir, e.name), rel));
    else out[rel] = fs.readFileSync(path.join(dir, e.name));
  }
  return out;
}
for (const name of ['shopping-cart', 'mini-api']) {
  const files = Object.fromEntries(Object.entries(walk(path.join(here, name))).map(([k, v]) => [`${name}/${k}`, v]));
  fs.writeFileSync(path.join(here, `${name}.zip`), zipSync(files));
  console.log(`built tests/fixtures/${name}.zip`);
}
