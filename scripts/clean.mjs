import { rm } from 'node:fs/promises';

const targets = ['dist', 'coverage'];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
