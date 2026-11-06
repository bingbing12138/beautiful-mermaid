import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { layoutTerminalGraph } from './layout.ts'
import { renderTerminalLayout, renderMermaidTerminal } from './render.ts'
import { displayWidth } from './text.ts'

const materials = readFileSync(new URL('../../examples/materials-screening-original.mmd', import.meta.url), 'utf8')

test('the original workflow retains its nodes, groups, and independent directions', () => {
  const layout = layoutTerminalGraph(materials, { width: 160 })
  assert.equal(layout.nodes.length, 11)
  assert.equal(layout.groups.length, 3)
  assert.equal(new Set(layout.routes.map(route => route.edge)).size, 10)
  const node = (id: string) => layout.nodes.find(node => node.id === id)!
  assert.ok(node('B').y > node('A').y)
  assert.ok(node('E').y > node('D').y)
  assert.ok(node('H').y > node('G').y)
  assert.ok(layout.groups[1]!.x > layout.groups[0]!.x)
  assert.ok(layout.groups[2]!.x > layout.groups[1]!.x)
})

for (const width of [80, 120, 160]) {
  test(`the original workflow fits ${width} terminal columns without clipping labels`, () => {
    const layout = layoutTerminalGraph(materials, { width })
    const drawing = renderTerminalLayout(layout)
    assert.ok(Math.max(...drawing.split('\n').map(displayWidth)) <= width)
    for (const box of layout.nodes) {
      for (const label of box.label) assert.ok(drawing.includes(label), `Missing ${label}`)
    }
    for (const route of layout.routes) {
      if (!route.label) continue
      const label = route.label
      for (const node of layout.nodes) {
        const overlaps = label.y >= node.y && label.y <= node.y + node.height
          && label.x <= node.x + node.width && label.x + displayWidth(label.text) > node.x
        assert.equal(overlaps, false, `Edge label ${label.text} overlaps node ${node.id}`)
      }
    }
    for (let i = 0; i < layout.nodes.length; i++) {
      const a = layout.nodes[i]!
      for (const b of layout.nodes.slice(i + 1)) {
        assert.ok(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y, `${a.id} overlaps ${b.id}`)
      }
    }
  })
}

test('Chinese, combining characters, and emoji occupy terminal cells correctly', () => {
  const drawing = renderMermaidTerminal('flowchart LR\n A[材料 é 🔬] --> B[完成]', { width: 80 })
  assert.ok(drawing.includes('材料 é 🔬'))
  assert.ok(drawing.includes('完成'))
  const rows = drawing.split('\n').filter(row => row.includes('┌') || row.includes('材料'))
  assert.equal(displayWidth(rows[0]!.trimEnd()), displayWidth(rows[1]!.trimEnd()))
})

test('cross-group edges stay connected through boundary ports, including nested groups', () => {
  const source = `flowchart LR
    subgraph A [First]
      direction TB
      subgraph N [Nested]
        direction TB
        a[Input] --> b[Filter]
      end
    end
    subgraph B [Second]
      direction TB
      c[Compute] --> d[Result]
    end
    b -->|pass| c
    d -->|update| a`
  const layout = layoutTerminalGraph(source, { width: 160 })
  assert.equal(layout.groups.length, 3)
  const key = (point: { x: number; y: number }) => `${point.x},${point.y}`
  for (const edge of [2, 3]) {
    const routes = layout.routes.filter(route => route.edge === edge)
    assert.equal(routes.filter(route => route.arrowEnd).length, 1)
    const endpoints = routes.flatMap(route => [key(route.points[0]!), key(route.points.at(-1)!)])
    const counts = new Map<string, number>()
    for (const point of endpoints) counts.set(point, (counts.get(point) ?? 0) + 1)
    assert.equal([...counts.values()].filter(count => count === 1).length, 2, 'Port fragments must join end to end')
  }
  for (const route of layout.routes) {
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!, b = route.points[i]!
      assert.ok(a.x === b.x || a.y === b.y, 'Every segment must be orthogonal')
      for (const node of layout.nodes) {
        const crosses = a.x === b.x
          ? a.x > node.x && a.x < node.x + node.width && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height
          : a.y > node.y && a.y < node.y + node.height && Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + node.width
        assert.equal(crosses, false, `Edge ${route.edge} crosses node ${node.id}`)
      }
    }
  }
})

test('elbows use corners and incoming edges do not become four-way node junctions', () => {
  const drawing = renderMermaidTerminal('flowchart TD\n A{Pass?} -->|yes| B[Keep]\n A -->|no| C[Discard]', { width: 80 })
  assert.ok(drawing.includes('yes'))
  assert.ok(drawing.includes('no'))
  assert.ok(!drawing.includes('┼'))
})
