/* eslint-disable @typescript-eslint/no-require-imports */
const fileSystem = require('node:fs');
const path = require('node:path');

const endToEndDirectory = path.join(__dirname, '..', 'e2e');
const forbiddenPatterns = [
  {
    pattern: /\b(?:pg|postgres|drizzle-orm|ioredis|redis)\b/i,
    description: '禁止 E2E 连接数据库或 Redis',
  },
  {
    pattern: /backend\/src|DbService|RedisService|SearchService/,
    description: '禁止 E2E 导入后端内部实现',
  },
  {
    pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO)?\s*[a-z_]+/i,
    description: '禁止 E2E 执行 SQL',
  },
];

const violations = [];
for (const directoryEntry of fileSystem.readdirSync(endToEndDirectory, {
  withFileTypes: true,
  recursive: true,
})) {
  if (!directoryEntry.isFile() || !/\.(?:js|ts)$/.test(directoryEntry.name)) {
    continue;
  }
  const filePath = path.join(directoryEntry.parentPath, directoryEntry.name);
  const sourceText = fileSystem.readFileSync(filePath, 'utf8');
  for (const forbiddenPattern of forbiddenPatterns) {
    if (forbiddenPattern.pattern.test(sourceText)) {
      violations.push(`${filePath}: ${forbiddenPattern.description}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`前端 E2E 黑盒边界检查失败:\n${violations.join('\n')}`);
  process.exit(1);
}

console.log('前端 E2E 黑盒边界检查通过：只使用浏览器与公开 HTTP 接口');
