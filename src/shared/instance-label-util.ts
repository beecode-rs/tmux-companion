import { type IInstance, type InstanceType } from '#src/shared/instance-model'

export const instanceLabelUtil = {
  resolveLabelError(params: {
    excludeId?: string
    instances: IInstance[]
    label: string
    type: InstanceType
  }): string | null {
    if (params.label.trim() === '') {
      return 'Label cannot be empty'
    }

    if (params.type !== 'local') {
      return null
    }

    const isTaken = params.instances.some((instance) => {
      return (
        instance.type === 'local' && instance.id !== params.excludeId && instance.label.trim() === params.label.trim()
      )
    })

    if (isTaken) {
      return `A local instance named '${params.label.trim()}' already exists`
    }

    return null
  },
}
