
/***** IMPORTS *****/

import type { Plugin } from '$fresh/server.ts'
import type { JSX, VNode } from 'preact'


/***** TYPES *****/

type ParsedCSS = Array<[string, string | Array<[string, string]>]>

type CompiledCSS = {
    classes: Array<string>
    customProperties: Array<[string, string]>
    rules: Array<{
        ruleBody: string
        selector: string
    }>
}

/*****  SHARED STATE  *****/

/**
 * A Map from CSS rule bodies to the Set of 
 * selectors that the rules will be applied on. 
 */
const stylesheet = new Map<string, Set<string>>

/**
 * A unique string that sits where the comma-
 * separated list of selectors will soon go.
 * This is to allow the selector list to be 
 * placed somewhere in the middle of the rule
 * body, like in the case of a media query rule.
 */
const placeholder = 'ZTc5OGY2MDUtMTFkNy00ODJmLWI4NmMtZjExYzA5MzdiZjc5'


/***** MAIN: FRESH/PREACT SPECIFIC PARTS *****/

const headwind: Plugin = {
    name: 'Headwind',
    render (context) {
        const { requiresHydration: _ } = context.render()
        const cssText = stringifyStylesheet(stylesheet)
        stylesheet.clear()
        return { styles: [{ cssText , id: 'headwind' }] }
    }
}

function hook(vnode: VNode<JSX.HTMLAttributes<HTMLElement>>) {
    
    const { props: { style } } = vnode
    
    if (typeof style === 'undefined') return vnode
    
    if (typeof style !== 'string') {
        console.warn(
            `Headwind: the compiler only works with strings, but style of the type '${typeof style}' on element '${vnode.type}'`,
            style
        )
        return vnode
    }
    
    const { classes, customProperties, rules } = compile(parse(style))
    
    classes.forEach(_class => applyClass(vnode, _class))
    
    if (customProperties.length > 0) vnode.props.style = stringifyProperties(customProperties)
    else                             vnode.props.style = undefined    
    
    rules.forEach(({ ruleBody, selector }) => addRule(stylesheet, ruleBody, selector))

    return vnode
}


/***** MAIN: CORE PARTS *****/

function parse(
    text: string,
    result: ParsedCSS = []
): ParsedCSS {

    if (trim(text) === '') return result
    
    const nextCharAt = text.search(/[;{]/)
    
    if (nextCharAt === -1) {
        const property = text.split(':').map(trim) as [string, string]
        console.assert(property.length === 2, `Headwind: line is incorrectly formatted: `, text)
        return [...result, property]
    }
    
    const nextChar = text[nextCharAt]
    
    if (nextChar === ';') {
        const line           = text.slice(0, nextCharAt)
        const property       = line.split(':').map(trim) as [string, string]
        const remainingLines = text.slice(nextCharAt + 1)
        const resultSoFar    = [...result, property]
        console.assert(property.length === 2, `Headwind: line is incorrectly formatted: `, line)
        return parse(remainingLines, resultSoFar)
    }
    
    if (nextChar === '{') {
        const bracketOpenAt  = nextCharAt
        const bracketCloseAt = text.indexOf('}')
        const rule           = text.slice(0, bracketOpenAt).trim()
        const ruleBody       = text.slice(bracketOpenAt + 1, bracketCloseAt)
        const properties     = parse(ruleBody) as [string, string][]
        const remainingLines = text.slice(bracketCloseAt + 1)
        const resultSoFar    = [...result, [rule, properties] as [string, Array<[string, string]>]]
        return parse(remainingLines, resultSoFar)
    }
    
    throw new Error('should be unreachable')
}

function compile(properties: ParsedCSS): CompiledCSS {
    
    const simpleProperties = properties.filter(isSimple)
    const nestedRules      = properties.filter(isNested)
    
    // at-rules and pseudo class rules are considered mutually exclusive
    const atQueryRules     = nestedRules.filter(isAtRule)
    const pseudoClassRules = nestedRules.filter(isPseudoClassRule)
    
    
    const simpleRule: CompiledCSS = (() => {
        if (simpleProperties.length > 0) {
            const customProperties = simpleProperties.filter(isCustomProperty)
            const normalProperties = simpleProperties.filter(isNormalProperty)
            const ruleBody         = `${placeholder} { ${stringifyProperties(normalProperties)} }`
            const hwClass          = 'hw_' + hash(ruleBody)
             
            return {
                classes: [ hwClass ],
                customProperties,
                rules: [{ ruleBody, selector: '.' + hwClass }]
            }
        }
        return { rules: [], classes: [], customProperties: [] }
    })()
    
    const pseudoRules: CompiledCSS[] = pseudoClassRules.map(( [ pseudoClass, properties ] ) => {
        const ruleBody = `${placeholder} { ${stringifyProperties(properties)} }`
        
        // this hashed class name is specific to the pseudo classes that apply to it
        const hwClass  = 'hw_' + hash(pseudoClass + hash(ruleBody))
        
        return {
            classes: [ hwClass ],
            customProperties: new Array<[string, string]>,
            rules: [{ ruleBody, selector: '.' + hwClass + pseudoClass }]
        }
    })
    
    const atRules: CompiledCSS[] = atQueryRules.map(( [ atQuery, properties ] ) => {
        const ruleBody = `${atQuery} { ${placeholder} { ${stringifyProperties(properties)} } }`
    
        // this hashed class name is specific to the at-rule that contains it
        const hwClass  = 'hw_' + hash(atQuery + hash(ruleBody))
        
        return {
            classes: [ hwClass ],
            customProperties: new Array<[string, string]>,
            rules: [{ ruleBody, selector: '.' + hwClass }]
        }
    })
    
    return [ simpleRule, ...pseudoRules, ...atRules ].reduce((accumulated, current) => (
        {
            classes         : [ ...accumulated.classes         , ...current.classes          ],
            customProperties: [ ...accumulated.customProperties, ...current.customProperties ],
            rules           : [ ...accumulated.rules           , ...current.rules            ]
        }
    ))
}


/***** HELPER FUNCTIONS *****/

/**
 * Adds a new rule to `rules` Map and adds `selector`
 * to the Set of selectors that use it.
 * If the rule is already in the Map, simply adds the
 * selector to the pre-existing rule.
 */
function addRule(
    stylesheet: Map<string, Set<string>>,
    ruleBody: string,
    selector: string
) {
    const selectors = stylesheet.get(ruleBody)
    if (selectors === undefined) {
        stylesheet.set(ruleBody, new Set([selector]))
    }
    else selectors.add(selector)
}

/**
 * Adds the passed class to the passed vnode, and
 * removes style property from it.
 */
function applyClass(
    vnode: VNode<JSX.HTMLAttributes<HTMLElement>>,
    hwClass: string    
) {
    if (vnode.props.class) vnode.props.class += " " + hwClass
    else vnode.props.class = hwClass
}

function stringifyStylesheet(stylesheet: Map<string, Set<string>>) {
    const rulesArray   = Array.from(stylesheet.entries())
    const rulesStrings = rulesArray.map(( [ruleBody, selectors] ) => {
        const selectorsString = Array.from(selectors.values()).join(', ')
        const stringifiedRule = ruleBody.replace(placeholder, selectorsString)
        return stringifiedRule
    })
    return rulesStrings.join('\n')
}

function stringifyProperties(properties: ParsedCSS) {
    return properties.map(tuple => tuple.join(': ')).join('; ')
}

function trim(text: string) {
    return text.trim()
}

function isSimple(propertyTuple: [string, unknown]): propertyTuple is [string, string] {
    return isNested(propertyTuple) === false
}

function isNested(tuple: [string, unknown]): tuple is [string, Array<[string, string]>] {
    return Array.isArray(tuple[1])
}

function isNormalProperty(property: [string, string]) {
    return isCustomProperty(property) === false
}

function isCustomProperty(property: [string, string]) {
    return property[0].startsWith('--')
}

function isAtRule<T extends [string, unknown]>(tuple: T) {
    return tuple[0].startsWith('@')
}

function isPseudoClassRule<T extends [string, unknown]>(tuple: T) {
    return tuple[0].startsWith(':')
}

function hash(data: string) {
    const alphabet = [...'01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-']
    const masks = [
        0b111111,
        0b111111000000,
        0b111111000000000000,
        0b111111000000000000000000,
        0b111111000000000000000000000000
    ]
    const hashInt = [...data].reduce((hash, char) => 
        hash * 311 + char.charCodeAt(0) >>> 0
    , 313)
    const hash = masks.map((mask, index) => 
        alphabet[(hashInt & mask) >>> index * 6]
    )
    return hash.join('')
}


/***** EXPORTS *****/

export {
    headwind,
    headwind as hw,
    headwind as plugin,
    headwind as default,
    hook as __preact_jsx_hook
}
