import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'

import {
  type ILocalNetworkInterface,
  type ILocalNetworkProbeResult,
  localNetworkPermissionUtil,
} from '#src/main/business/service/local-network-permission-util'
import { type ILocalNetworkPermissionResponse } from '#src/shared/api-model'

const PROBE_PORT = 53

const PROBE_TIMEOUT_MS = 3000

export class LocalNetworkPermissionService {
  async check(): Promise<ILocalNetworkPermissionResponse> {
    if (process.platform !== 'darwin') {
      return { detail: null, probeAddress: null, status: 'unsupported' }
    }

    const addresses = localNetworkPermissionUtil.toProbeAddresses({ interfaces: this._toInterfaces() })

    if (addresses.length === 0) {
      return this._toNoInterfaceResult()
    }

    return await this._toProbedResult({ addresses })
  }

  protected _probeAddress(params: { address: string }): Promise<ILocalNetworkProbeResult> {
    return new Promise<ILocalNetworkProbeResult>((resolve) => {
      const socket = createSocket('udp4')
      const probeState = { isSettled: false }
      const settle = (result: ILocalNetworkProbeResult): void => {
        if (probeState.isSettled) {
          return
        }

        probeState.isSettled = true
        clearTimeout(timeoutId)
        socket.close()
        resolve(result)
      }
      const timeoutId = setTimeout(() => {
        settle({ error: 'probe timed out', outcome: 'timeout' })
      }, PROBE_TIMEOUT_MS)

      socket.on('error', (error: Error) => {
        settle({ error: error.message, outcome: 'blocked' })
      })
      socket.connect(PROBE_PORT, params.address, () => {
        settle({ error: null, outcome: 'allowed' })
      })
    })
  }

  protected _toInterfaces(): ILocalNetworkInterface[] {
    return Object.entries(networkInterfaces()).reduce<ILocalNetworkInterface[]>(
      (interfaces, [name, interfaceInfos]) => {
        const namedInterfaces = (interfaceInfos ?? []).map((interfaceInfo) => {
          return { ...interfaceInfo, name }
        })

        return [...interfaces, ...namedInterfaces]
      },
      [],
    )
  }

  protected _toNoInterfaceResult(): ILocalNetworkPermissionResponse {
    return { detail: 'No local network interface available to probe', probeAddress: null, status: 'unprobeable' }
  }

  protected _toProbedResult(params: { addresses: string[] }): Promise<ILocalNetworkPermissionResponse> {
    return params.addresses.reduce<Promise<ILocalNetworkPermissionResponse>>(async (previousPromise, address) => {
      const result = await previousPromise

      if (result.status === 'allowed') {
        return result
      }

      const probeResult = await this._probeAddress({ address })

      return this._toProbeResult({ address, probeResult })
    }, Promise.resolve(this._toNoInterfaceResult()))
  }

  protected _toProbeResult(params: {
    address: string
    probeResult: ILocalNetworkProbeResult
  }): ILocalNetworkPermissionResponse {
    if (params.probeResult.outcome === 'allowed') {
      return { detail: null, probeAddress: params.address, status: 'allowed' }
    }

    if (params.probeResult.outcome === 'blocked') {
      return {
        detail: params.probeResult.error ?? 'Local network access was denied by macOS',
        probeAddress: params.address,
        status: 'blocked',
      }
    }

    return { detail: 'Permission probe timed out', probeAddress: params.address, status: 'unprobeable' }
  }
}
