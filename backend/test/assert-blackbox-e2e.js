// 防回退守卫:任何 E2E/冒烟测试都只能从公共 HTTP/WS 接口观察系统。
const fileSystem = require('node:fs');
const path = require('node:path');

const TEST_DIR = __dirname;
const forbidden = [
  ['drizzle-orm', /(?:from|require\()\s*['"]drizzle-orm/],
  ['node-postgres/pg', /(?:from\s*['"]pg['"]|require\(['"]pg['"]\))/],
  ['ioredis', /(?:from|require\()\s*['"]ioredis/],
  ['DbService', /\bDbService\b/],
  ['RedisService', /\bRedisService\b/],
  ['应用 src 导入', /(?:from|require\()\s*['"]\.\.\/src\//],
];

const files = fileSystem
  .readdirSync(TEST_DIR, { withFileTypes: true, recursive: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      /\.(?:js|ts)$/.test(entry.name) &&
      (entry.name.includes('e2e') || entry.name.includes('smoke')),
  )
  .map((entry) => path.join(entry.parentPath, entry.name))
  .filter((file) => path.basename(file) !== path.basename(__filename));

const violations = [];
for (const file of files) {
  const source = fileSystem.readFileSync(file, 'utf8');
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) violations.push(`${file}: ${label}`);
  }
}

if (violations.length) {
  console.error('E2E 黑盒边界检查失败:\n' + violations.join('\n'));
  process.exit(1);
}

console.log(`E2E 黑盒边界检查通过: ${files.length} 个测试文件仅使用公共接口`);
