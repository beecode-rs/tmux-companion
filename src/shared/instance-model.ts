export type InstanceType = 'local' | 'ssh'

export interface IInstanceSshConfig {
  host: string
  identityFile?: string
  port?: number
  user?: string
}

export interface IInstance {
  id: string
  label: string
  lastSession?: string
  ssh?: IInstanceSshConfig
  type: InstanceType
}
