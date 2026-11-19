import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(projectDir, 'node_modules', 'electron')

const LOCAL_NETWORK_USAGE_DESCRIPTION =
  'Tmux Companion needs local network access so SSH and other commands run in its terminals can reach hosts on your network.'

const isElectronPackageInstalled = () => {
  return existsSync(path.join(electronDir, 'package.json'))
}

const isElectronBinaryDownloaded = () => {
  const pathFilePath = path.join(electronDir, 'path.txt')
  if (!existsSync(pathFilePath)) {
    return false
  }
  const binaryRelativePath = readFileSync(pathFilePath, 'utf8').trim()
  return existsSync(path.join(electronDir, 'dist', binaryRelativePath))
}

const installElectronBinary = async () => {
  console.log('electron binary missing - downloading it now')
  const installProcess = spawn(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })
  const exitCode = await new Promise((resolve) => {
    installProcess.on('close', resolve)
  })
  if (exitCode !== 0) {
    console.error(`electron download failed with exit code ${exitCode ?? 1}`)
    process.exit(exitCode ?? 1)
  }
  console.log('electron binary downloaded successfully')
}

const patchDevElectronInfoPlist = () => {
  if (process.platform !== 'darwin') {
    return false
  }
  const infoPlistPath = path.join(electronDir, 'dist', 'Electron.app', 'Contents', 'Info.plist')
  if (!existsSync(infoPlistPath)) {
    console.error('dev electron Info.plist not found - local network usage key not added')
    return false
  }
  const content = readFileSync(infoPlistPath, 'utf8')
  if (content.includes('<key>NSLocalNetworkUsageDescription</key>')) {
    console.log('dev electron Info.plist already has NSLocalNetworkUsageDescription')
    return false
  }
  const closeDictIndex = content.lastIndexOf('</dict>')
  if (closeDictIndex === -1) {
    console.error('dev electron Info.plist has an unexpected shape - local network usage key not added')
    return false
  }
  const entry = `\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>${LOCAL_NETWORK_USAGE_DESCRIPTION}</string>\n`
  writeFileSync(infoPlistPath, `${content.slice(0, closeDictIndex)}${entry}${content.slice(closeDictIndex)}`)
  console.log('added NSLocalNetworkUsageDescription to dev electron Info.plist')
  return true
}

const resignDevElectronApp = async () => {
  const appPath = path.join(electronDir, 'dist', 'Electron.app')
  const codesignProcess = spawn('codesign', ['--force', '--sign', '-', appPath], { stdio: 'inherit' })
  const exitCode = await new Promise((resolve) => {
    codesignProcess.on('close', resolve)
  })
  if (exitCode !== 0) {
    console.warn(`codesign failed with exit code ${exitCode ?? 1} - dev app may be blocked by macOS`)
    return
  }
  console.log('dev electron app re-signed after Info.plist patch')
}

if (!isElectronPackageInstalled()) {
  console.error('electron package not found - run `pnpm install` first')
  process.exit(1)
}

if (isElectronBinaryDownloaded()) {
  console.log('electron binary is ready')
} else {
  await installElectronBinary()
}

if (patchDevElectronInfoPlist()) {
  await resignDevElectronApp()
}
