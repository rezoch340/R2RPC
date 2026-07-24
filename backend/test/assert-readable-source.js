// 可读性门禁:拒绝单字母变量和团队已禁止的含糊缩写。
// HTTP、URL、JWT、RPC、WS、ID 等稳定协议/领域术语允许保留。
const fileSystem = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const SOURCE_ROOTS = [path.join(__dirname, '..', 'src'), path.join(__dirname)];
const FORBIDDEN_NAME_PARTS = new Set([
  'arr',
  'cb',
  'cfg',
  'cond',
  'conds',
  'ctx',
  'doc',
  'dto',
  'err',
  'fn',
  'idx',
  'msg',
  'num',
  'obj',
  'opts',
  'params',
  'proj',
  'req',
  'res',
  'resp',
  'str',
  'svc',
  'tx',
  'val',
]);

function sourceFiles(directory) {
  return fileSystem
    .readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:js|ts)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function bindingIdentifiers(bindingName, identifiers = []) {
  if (typescript.isIdentifier(bindingName)) {
    identifiers.push(bindingName);
    return identifiers;
  }
  if (
    typescript.isObjectBindingPattern(bindingName) ||
    typescript.isArrayBindingPattern(bindingName)
  ) {
    for (const element of bindingName.elements) {
      if (typescript.isBindingElement(element)) {
        bindingIdentifiers(element.name, identifiers);
      }
    }
  }
  return identifiers;
}

function nameParts(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((part) => part.toLowerCase());
}

function namingProblem(name) {
  if (name.length <= 2) {
    return '变量名不得少于 3 个字符';
  }
  const forbiddenPart = nameParts(name).find((part) =>
    FORBIDDEN_NAME_PARTS.has(part),
  );
  if (forbiddenPart) {
    return `禁止含糊缩写 "${forbiddenPart}"`;
  }
  return null;
}

const violations = [];
for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
  if (path.resolve(file) === path.resolve(__filename)) {
    continue;
  }
  const sourceText = fileSystem.readFileSync(file, 'utf8');
  const sourceFile = typescript.createSourceFile(
    file,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    file.endsWith('.ts') ? typescript.ScriptKind.TS : typescript.ScriptKind.JS,
  );

  function inspect(node) {
    if (
      typescript.isVariableDeclaration(node) ||
      typescript.isParameter(node)
    ) {
      for (const identifier of bindingIdentifiers(node.name)) {
        const problem = namingProblem(identifier.text);
        if (!problem) {
          continue;
        }
        const location = sourceFile.getLineAndCharacterOfPosition(
          identifier.getStart(sourceFile),
        );
        violations.push(
          `${file}:${location.line + 1}:${location.character + 1} ${identifier.text}: ${problem}`,
        );
      }
    }
    typescript.forEachChild(node, inspect);
  }

  inspect(sourceFile);
}

if (violations.length > 0) {
  console.error(`源码命名可读性检查失败:\n${violations.join('\n')}`);
  process.exit(1);
}

console.log('源码命名可读性检查通过: 未发现单字母变量或禁止缩写');
