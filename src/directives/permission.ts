import type {DirectiveBinding, ObjectDirective} from 'vue'
import {useUserStore} from '../stores/user'

type PermissionValue = string | string[] | undefined
type PermissionEl = HTMLElement & { __vOriginalDisplay?: string }

const parseCodes = (value: PermissionValue): string[] => {
    if (typeof value === 'string') return value ? [value] : []
    if (Array.isArray(value)) return value.filter((code): code is string => typeof code === 'string')
    return []
}

const updatePermission = (el: PermissionEl, binding: DirectiveBinding<PermissionValue>) => {
    const codes = parseCodes(binding.value)
    const store = useUserStore()
    const allowed = !codes.length || codes.every(code => store.hasPermission(code))
    const disableMode = Boolean(binding.modifiers?.disabled)

    if (allowed) {
        if (disableMode) {
            el.removeAttribute('disabled')
        } else {
            el.style.display = el.__vOriginalDisplay ?? ''
        }
        return
    }

    if (disableMode) {
        el.setAttribute('disabled', 'disabled')
        return
    }

    if (el.__vOriginalDisplay === undefined) {
        el.__vOriginalDisplay = el.style.display
    }
    el.style.display = 'none'
}

const permissionDirective: ObjectDirective<PermissionEl, PermissionValue> = {
    mounted(el, binding) {
        updatePermission(el, binding)
    },
    updated(el, binding) {
        updatePermission(el, binding)
    },
    unmounted(el) {
        // 恢复 display，防止影响后续复用
        if (el.__vOriginalDisplay !== undefined) {
            el.style.display = el.__vOriginalDisplay
        }
    },
}

export default permissionDirective
