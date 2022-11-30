import { __preact_jsx_hook as hook } from 'headwind'
import type { VNode } from 'preact'
import * as Preact from 'preact/jsx-runtime'

function createVNode(
    type: VNode['type'],
    props: VNode['props'],
    key: VNode['key'],
    __self: string,
    __source: string
) {
    const vnode = Preact.jsx(type, props, key, __self, __source)
    // hook is only required for deno and esbuild, not the browser
    return hook(vnode)
}

export { Fragment } from 'preact'
export {
    createVNode as jsx,
    createVNode as jsxs
}
