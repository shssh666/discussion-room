import ts from 'typescript'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// 进程内编译：不 spawn 子进程，规避 Android linker/execPath/sh 路径等所有环境差异
const configPath = path.join(root, 'tsconfig.build.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath))
const program = ts.createProgram(parsed.fileNames, parsed.options)
const emitResult = program.emit()

const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)
for (const d of diagnostics) {
  const where = d.file
    ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} `
    : ''
  console.error(where + ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}
if (diagnostics.length > 0 || emitResult.emitSkipped) process.exit(1)

mkdirSync(path.join(root, 'dist/public'), { recursive: true })
cpSync(path.join(root, 'public'), path.join(root, 'dist/public'), { recursive: true })
console.log('build ok: dist/')
