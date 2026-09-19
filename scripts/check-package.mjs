import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { name } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
);
assert.equal(typeof (await import(name)).default, 'function');
assert.equal(typeof createRequire(import.meta.url)(name), 'function');
console.log('Package ESM and CommonJS exports: OK');
