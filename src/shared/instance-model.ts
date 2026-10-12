export type DetectedOs = 'linux' | 'mac' | 'unknown' | 'windows'

export type DetectedShell = 'bash' | 'fish' | 'unknown' | 'zsh'

export type InstanceType = 'local' | 'ssh'

export interface IInstanceSshConfig {
  host: string
  identityFile?: string
  port?: number
  user?: string
}

export interface IDetectedEnv {
  detectedOs: DetectedOs
  detectedShell: DetectedShell
}

export interface IInstance {
  detectedOs?: DetectedOs
  detectedShell?: DetectedShell
  id: string
  label: string
  lastSession?: string
  ssh?: IInstanceSshConfig
  type: InstanceType
}
