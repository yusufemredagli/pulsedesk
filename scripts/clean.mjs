import { rmSync } from 'node:fs';
rmSync('.turbo', { recursive: true, force: true });
