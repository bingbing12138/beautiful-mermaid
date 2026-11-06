import { mkCanvas, canvasToString } from '../ascii/canvas.ts'
import { getCorners } from '../ascii/shapes/corners.ts'
import type { Point } from '../types.ts'
import { layoutTerminalGraph } from './layout.ts'
import type { TerminalLayout, TerminalOptions, TerminalBox } from './layout.ts'
import { displayWidth, graphemes } from './text.ts'

/** Draw directly in terminal cells; no SVG coordinates or scaling are involved. */
export function renderTerminalLayout(layout: TerminalLayout, options: TerminalOptions = {}): string {
  const canvas = mkCanvas(layout.width - 1, layout.height - 1)
  const connections = Array.from({ length: layout.width }, () => Array<number>(layout.height).fill(0))
  const ascii = options.useAscii ?? false
  const lines = [' ', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼']
  const lineCharacter = (bits: number) => ascii ? (bits === 5 || bits === 1 || bits === 4 ? '|' : bits === 10 || bits === 2 || bits === 8 ? '-' : '+') : lines[bits]!
  const put = (x: number, y: number, character: string) => {
    canvas[x]![y] = character
  }
  const text = (x: number, y: number, label: string) => {
    for (const character of graphemes(label)) {
      const width = displayWidth(character)
      canvas[x]![y] = character
      for (let i = 1; i < width; i++) canvas[x + i]![y] = ''
      x += width
    }
  }
  const box = (node: TerminalBox, group: boolean) => {
    const corners = getCorners(group ? 'rectangle' : node.shape!, ascii)
    const { x, y, width: w, height: h } = node
    for (let i = 1; i < w; i++) {
      put(x + i, y, lineCharacter(10 | connections[x + i]![y]!))
      put(x + i, y + h, lineCharacter(10 | connections[x + i]![y + h]!))
    }
    for (let i = 1; i < h; i++) {
      put(x, y + i, lineCharacter(5 | connections[x]![y + i]!))
      put(x + w, y + i, lineCharacter(5 | connections[x + w]![y + i]!))
    }
    put(x, y, corners.tl); put(x + w, y, corners.tr)
    put(x, y + h, corners.bl); put(x + w, y + h, corners.br)
    if (group) text(x + 2, y, ` ${node.label[0]} `)
    else {
      const startY = y + Math.floor((h + 1 - node.label.length) / 2)
      node.label.forEach((line, i) => text(x + Math.floor((w + 1 - displayWidth(line)) / 2), startY + i, line))
    }
  }
  const segment = (a: Point, b: Point) => {
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y)
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const forward = dx > 0 ? 2 : dx < 0 ? 8 : dy > 0 ? 4 : 1
    const backward = dx > 0 ? 8 : dx < 0 ? 2 : dy > 0 ? 1 : 4
    for (let i = 0; i < length; i++) {
      connections[a.x + dx * i]![a.y + dy * i]! |= forward
      connections[a.x + dx * (i + 1)]![a.y + dy * (i + 1)]! |= backward
    }
  }
  for (const route of layout.routes) {
    for (let i = 1; i < route.points.length; i++) segment(route.points[i - 1]!, route.points[i]!)
  }
  for (let x = 0; x < layout.width; x++) {
    for (let y = 0; y < layout.height; y++) {
      const bits = connections[x]![y]!
      if (bits) put(x, y, lineCharacter(bits))
    }
  }
  for (const group of layout.groups) box(group, true)
  for (const node of layout.nodes) box(node, false)
  const arrow = (tip: Point, other: Point) => {
    canvas[tip.x]![tip.y] = tip.x > other.x ? (ascii ? '>' : '▶') : tip.x < other.x ? (ascii ? '<' : '◀') : tip.y > other.y ? (ascii ? 'v' : '▼') : (ascii ? '^' : '▲')
  }
  for (const route of layout.routes) {
    // Put arrowheads just outside the target shape's border.
    const last = route.points.length - 1
    if (route.arrowEnd) {
      const tip = route.points[last]!, prev = route.points[last - 1]!
      arrow({ x: tip.x - Math.sign(tip.x - prev.x), y: tip.y - Math.sign(tip.y - prev.y) }, prev)
    }
    if (route.arrowStart) {
      const tip = route.points[0]!, next = route.points[1]!
      arrow({ x: tip.x - Math.sign(tip.x - next.x), y: tip.y - Math.sign(tip.y - next.y) }, next)
    }
    if (route.label) text(route.label.x, route.label.y, route.label.text)
  }
  return canvasToString(canvas).split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
}

export function renderMermaidTerminal(text: string, options: TerminalOptions = {}): string {
  return renderTerminalLayout(layoutTerminalGraph(text, options), options)
}

export function terminalStats(layout: TerminalLayout, drawing: string) {
  const lines = drawing.split('\n')
  const width = Math.max(...lines.map(displayWidth))
  const ink = lines.reduce((sum, line) => sum + displayWidth(line.replace(/ /g, '')), 0)
  let routeLength = 0
  let bends = 0
  for (const route of layout.routes) {
    bends += route.points.length - 2
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!, b = route.points[i]!
      routeLength += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    }
  }
  return { width, height: lines.length, blankRatio: 1 - ink / (width * lines.length), routeLength, bends }
}
