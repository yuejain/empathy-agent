const { mkdirSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
mkdirSync(resolve(root, 'dist/public'), { recursive: true });
for (const file of ['index.html', 'app.js', 'sse.js', 'styles.css']) copyFileSync(resolve(root, 'src', file), resolve(root, 'dist/public', file));
