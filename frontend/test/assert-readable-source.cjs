// 可读性门禁：拒绝单字母变量和团队已禁止的含糊缩写。
// HTTP、URL、JWT、RPC、WS、ID 等稳定协议或领域术语允许保留。
/* eslint-disable @typescript-eslint/no-require-imports */
const fileSystem = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_ROOTS = ['app', 'components', 'e2e', 'lib', 'test'].map(
  (directory) => path.join(PROJECT_ROOT, directory),
);
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
      (directoryEntry) =>
        directoryEntry.isFile() &&
        /\.(?:cjs|js|ts|tsx)$/.test(directoryEntry.name) &&
        !directoryEntry.name.endsWith('.d.ts'),
    )
    .map((directoryEntry) =>
      path.join(directoryEntry.parentPath, directoryEntry.name),
    );
}

function rootSourceFiles() {
  return fileSystem
    .readdirSync(PROJECT_ROOT, { withFileTypes: true })
    .filter(
      (directoryEntry) =>
        directoryEntry.isFile() &&
        /\.(?:cjs|js|mjs|ts|tsx)$/.test(directoryEntry.name) &&
        !directoryEntry.name.endsWith('.d.ts'),
    )
    .map((directoryEntry) => path.join(PROJECT_ROOT, directoryEntry.name));
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
    for (const bindingElement of bindingName.elements) {
      if (typescript.isBindingElement(bindingElement)) {
        bindingIdentifiers(bindingElement.name, identifiers);
      }
    }
  }
  return identifiers;
}

function nameParts(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((namePart) => namePart.toLowerCase());
}

function namingProblem(name) {
  if (name.length <= 2) {
    return '变量名不得少于 3 个字符';
  }
  const forbiddenNamePart = nameParts(name).find((namePart) =>
    FORBIDDEN_NAME_PARTS.has(namePart),
  );
  return forbiddenNamePart
    ? `禁止含糊缩写 "${forbiddenNamePart}"`
    : null;
}

const violations = [];
const checkedSourceFiles = [
  ...SOURCE_ROOTS.flatMap(sourceFiles),
  ...rootSourceFiles(),
];
for (const sourceFilePath of checkedSourceFiles) {
  if (path.resolve(sourceFilePath) === path.resolve(__filename)) {
    continue;
  }
  const sourceText = fileSystem.readFileSync(sourceFilePath, 'utf8');
  const scriptKind = sourceFilePath.endsWith('.tsx')
    ? typescript.ScriptKind.TSX
    : sourceFilePath.endsWith('.ts')
      ? typescript.ScriptKind.TS
      : typescript.ScriptKind.JS;
  const sourceFile = typescript.createSourceFile(
    sourceFilePath,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  function inspectNode(node) {
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
          `${sourceFilePath}:${location.line + 1}:${location.character + 1} ${identifier.text}: ${problem}`,
        );
      }
    }
    typescript.forEachChild(node, inspectNode);
  }

  inspectNode(sourceFile);
}

if (violations.length > 0) {
  console.error(`源码命名可读性检查失败:\n${violations.join('\n')}`);
  process.exit(1);
}

console.log('源码命名可读性检查通过：未发现单字母变量或禁止缩写');
