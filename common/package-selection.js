export function packageSelectionError(product, selection) {
  const plan = product?.packagePlans?.find(row => row.id === selection?.planId)
  if (!plan) return '请选择套餐方案'
  for (const group of plan.groups) {
    const choices = selection.groups?.[group.id] || []
    if (choices.length !== group.pick) return group.name + '请选择' + group.pick + '项'
    for (const choice of choices) {
      const service = group.services.find(row => row.id === choice.serviceId)
      if (!service) return '套餐内容已更新，请重新选择'
      if (service.options?.length && !service.options.includes(choice.option)) return '请选择' + service.name + '的具体类型'
    }
  }
  return ''
}
