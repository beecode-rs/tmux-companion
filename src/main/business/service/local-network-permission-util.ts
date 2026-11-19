import { type LocalNetworkPermissionStatus } from '#src/shared/api-model'

export type LocalNetworkProbeOutcome = 'allowed' | 'blocked' | 'timeout'

export interface ILocalNetworkInterface {
  address: string
  family: string
  internal: boolean
  name: string
}

export interface ILocalNetworkProbeResult {
  error: string | null
  outcome: LocalNetworkProbeOutcome
}

const VPN_INTERFACE_NAME_PATTERN = /^(ipsec|llwaw|ppp|tap|tun|utun)/

export const localNetworkPermissionUtil = {
  toInterfaceRank: (params: { name: string }): number => {
    if (params.name.startsWith('en')) {
      return 0
    }

    return 1
  },

  toProbeAddresses: (params: { interfaces: ILocalNetworkInterface[] }): string[] => {
    const { interfaces } = params
    const broadcastInterfaces = interfaces.filter((networkInterface) => {
      return (
        networkInterface.family === 'IPv4' &&
        !networkInterface.internal &&
        !VPN_INTERFACE_NAME_PATTERN.test(networkInterface.name)
      )
    })
    const sortedInterfaces = [...broadcastInterfaces].sort((left, right) => {
      return (
        localNetworkPermissionUtil.toInterfaceRank({ name: left.name }) -
        localNetworkPermissionUtil.toInterfaceRank({ name: right.name })
      )
    })
    const addresses = sortedInterfaces.map((networkInterface) => {
      return networkInterface.address
    })

    return [...new Set(addresses)]
  },

  toStatus: (params: { outcomes: LocalNetworkProbeOutcome[] }): LocalNetworkPermissionStatus => {
    const { outcomes } = params

    if (outcomes.includes('allowed')) {
      return 'allowed'
    }

    if (outcomes.includes('blocked')) {
      return 'blocked'
    }

    return 'unprobeable'
  },
}
