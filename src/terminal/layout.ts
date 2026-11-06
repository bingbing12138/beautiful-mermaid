import type { ElkNode, ElkExtendedEdge, ElkPort } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { parseMermaid } from '../parser.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, NodeShape, Point } from '../types.ts'
import { displayWidth, wrapLabel } from './text.ts'

export interface TerminalOptions {
  width?: number
  useAscii?: boolean
}

export interface TerminalBox {
  id: string
  label: string[]
  shape?: NodeShape
  x: number
  y: number
  width: number
  height: number
}

export interface TerminalRoute {
  edge: number
  points: Point[]
  label?: { text: string; x: number; y: number }
  arrowStart: boolean
  arrowEnd: boolean
}

export interface TerminalLayout {
  width: number
  height: number
  direction: Direction
  nodes: TerminalBox[]
  groups: TerminalBox[]
  routes: TerminalRoute[]
}

interface Container {
  id: string
  direction: Direction
  label: string
  parent?: Container
  groups: Container[]
  nodes: string[]
}

const elkDirection = { TD: 'DOWN', TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' }
const rootId = '$terminal'

/** Independent, bottom-up layouts preserve group directions across external edges. */
function arrange(graph: MermaidGraph, direction: Direction, labelWidth: number): TerminalLayout {
  const root: Container = { id: rootId, direction, label: '', nodes: [], groups: [] }
  const owners = new Map<string, Container>()
  const groups = new Map<string, Container>()
  function addGroup(group: MermaidSubgraph, parent: Container): Container {
    const container: Container = {
      id: group.id, direction: group.direction ?? parent.direction,
      label: group.label, parent, nodes: [...group.nodeIds], groups: [],
    }
    groups.set(group.id, container)
    owners.set(group.id, parent)
    for (const node of group.nodeIds) owners.set(node, container)
    container.groups = group.children.map(child => addGroup(child, container))
    return container
  }
  root.groups = graph.subgraphs.map(group => addGroup(group, root))
  for (const id of graph.nodes.keys()) {
    if (!owners.has(id) && !groups.has(id)) {
      owners.set(id, root)
      root.nodes.push(id)
    }
  }

  const labels = new Map([...graph.nodes].map(([id, node]) => [id, wrapLabel(node.label, labelWidth)]))
  const portId = (container: Container, edge: number, incoming: boolean) => `$${container.id}:${edge}:${incoming ? 'in' : 'out'}`
  const childUnder = (endpoint: string, container: Container): string | undefined => {
    let owner = owners.get(endpoint)!
    if (endpoint === container.id) return undefined
    if (owner === container) return endpoint
    while (owner.parent && owner.parent !== container) owner = owner.parent
    return owner.parent === container ? owner.id : undefined
  }
  const boxes = new Map<string, ElkNode>()
  const localEdges = new Map<string, Array<{ edge: number; item: ElkExtendedEdge; arrowStart: boolean; arrowEnd: boolean }>>()

  function layoutContainer(container: Container): ElkNode {
    const children: ElkNode[] = container.groups.map(group => {
      const result = layoutContainer(group)
      const ports = [...result.ports!]
      graph.edges.forEach((edge, index) => {
        for (const incoming of [false, true]) {
          if ((incoming ? edge.target : edge.source) !== group.id) continue
          const horizontal = container.direction === 'LR' || container.direction === 'RL'
          const reverse = container.direction === 'RL' || container.direction === 'BT'
          const leading = incoming !== reverse
          ports.push({
            id: portId(group, index, incoming), width: 0, height: 0,
            x: horizontal ? (leading ? 0 : result.width!) : Math.round(result.width! / 2),
            y: horizontal ? 3 : (leading ? 0 : result.height!),
          })
        }
      })
      return {
        id: group.id, width: result.width, height: result.height,
        ports,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      }
    })
    for (const id of container.nodes) {
      if (groups.has(id)) continue
      const lines = labels.get(id)!
      children.push({
        id,
        width: 2 * Math.ceil((Math.max(...lines.map(displayWidth)) + 3) / 2),
        height: 2 * Math.ceil((lines.length + 1) / 2),
      })
    }
    const ports: ElkPort[] = []
    const edges: ElkExtendedEdge[] = []
    const records: Array<{ edge: number; item: ElkExtendedEdge; arrowStart: boolean; arrowEnd: boolean }> = []
    const boundaryDirection = container.parent?.direction ?? container.direction
    const vertical = boundaryDirection !== 'LR' && boundaryDirection !== 'RL'
    const incomingSide = vertical ? (boundaryDirection === 'BT' ? 'SOUTH' : 'NORTH') : (boundaryDirection === 'RL' ? 'EAST' : 'WEST')
    const outgoingSide = vertical ? (boundaryDirection === 'BT' ? 'NORTH' : 'SOUTH') : (boundaryDirection === 'RL' ? 'WEST' : 'EAST')

    graph.edges.forEach((edge, index) => {
      const source = childUnder(edge.source, container)
      const target = childUnder(edge.target, container)
      if ((!source && !target) || (source && source === target)) return
      const boundary = (incoming: boolean): string => {
        const id = portId(container, index, incoming)
        ports.push({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': incoming ? incomingSide : outgoingSide } })
        return id
      }
      const endpoint = (child: string, original: string, incoming: boolean): string => {
        return groups.has(child) ? portId(groups.get(child)!, index, incoming) : child
      }
      const item: ElkExtendedEdge = {
        id: `$edge:${index}:${container.id}`,
        sources: [source ? endpoint(source, edge.source, false) : boundary(true)],
        targets: [target ? endpoint(target, edge.target, true) : boundary(false)],
      }
      if (edge.label && source && target) {
        item.labels = [{
          text: edge.label, width: displayWidth(edge.label) + 2, height: 1,
          layoutOptions: { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'true' },
        }]
      }
      edges.push(item)
      records.push({
        edge: index, item,
        arrowStart: source === edge.source && edge.hasArrowStart,
        arrowEnd: target === edge.target && edge.hasArrowEnd,
      })
    })
    localEdges.set(container.id, records)
    const local: ElkNode = {
      id: container.id, children, edges, ports,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': elkDirection[container.direction],
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.hierarchyHandling': 'SEPARATE',
        'elk.portConstraints': 'FIXED_SIDE',
        'elk.spacing.nodeNode': '4',
        'elk.spacing.edgeNode': '2',
        'elk.spacing.edgeEdge': '2',
        'elk.spacing.edgeLabel': '0',
        'elk.layered.spacing.nodeNodeBetweenLayers': container === root ? '4' : '2',
        'elk.layered.spacing.edgeNodeBetweenLayers': '2',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '2',
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
        'elk.padding': container === root ? '[top=1,left=1,bottom=1,right=1]' : '[top=2,left=2,bottom=2,right=2]',
        'elk.nodeSize.minimum': `(${displayWidth(container.label) + 4},0)`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      },
    }
    // A parent is necessary for ELK to resolve edges to a container's boundary ports.
    const wrapped = elkLayoutSync({
      id: '$layout', children: [local],
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'SEPARATE' },
    })
    const result = wrapped.children![0]!
    boxes.set(container.id, result)
    return result
  }

  const outer = layoutContainer(root)
  const result: TerminalLayout = {
    width: Math.ceil(outer.width!) + 1, height: Math.ceil(outer.height!) + 1,
    direction, nodes: [], groups: [], routes: [],
  }
  function extract(container: Container, offset: Point): void {
    const local = boxes.get(container.id)!
    for (const node of local.children!) {
      const x = offset.x + node.x!
      const y = offset.y + node.y!
      const rect = {
        id: node.id, x: Math.round(x), y: Math.round(y),
        width: Math.round(x + node.width!) - Math.round(x),
        height: Math.round(y + node.height!) - Math.round(y),
      }
      const group = groups.get(node.id)
      if (group) {
        result.groups.push({ ...rect, label: [group.label] })
        extract(group, { x, y })
      } else {
        result.nodes.push({ ...rect, label: labels.get(node.id)!, shape: graph.nodes.get(node.id)!.shape })
      }
    }
    const records = localEdges.get(container.id)!
    local.edges!.forEach((edge, index) => {
      const record = records[index]!
      for (const section of edge.sections!) {
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
          .map(point => ({ x: Math.round(point.x + offset.x), y: Math.round(point.y + offset.y) }))
        const label = edge.labels?.[0]
        result.routes.push({
          edge: record.edge, points,
          arrowStart: record.arrowStart, arrowEnd: record.arrowEnd,
          label: label ? { text: label.text!, x: Math.round(label.x! + offset.x + 1), y: Math.round(label.y! + offset.y) } : undefined,
        })
      }
    })
  }
  extract(root, { x: 0, y: 0 })
  return compactRows(result)
}

/** Remove unused routing tracks globally, without scaling labels or node cells. */
function compactRows(layout: TerminalLayout): TerminalLayout {
  const occupied = new Set<number>()
  for (const node of layout.nodes) {
    for (let y = node.y; y <= node.y + node.height; y++) occupied.add(y)
  }
  for (const group of layout.groups) {
    for (const y of [group.y, group.y + 1, group.y + group.height - 1, group.y + group.height]) occupied.add(y)
  }
  for (const route of layout.routes) {
    for (const point of route.points) occupied.add(point.y)
    if (route.label) occupied.add(route.label.y)
    if (route.arrowEnd) {
      const tip = route.points.at(-1)!, previous = route.points.at(-2)!
      occupied.add(tip.y - Math.sign(tip.y - previous.y))
    }
    if (route.arrowStart) {
      const tip = route.points[0]!, next = route.points[1]!
      occupied.add(tip.y - Math.sign(tip.y - next.y))
    }
  }
  const rows = [...occupied].sort((a, b) => a - b)
  const mapped = new Map(rows.map((row, index) => [row, index]))
  const box = (box: TerminalBox): TerminalBox => ({
    ...box, y: mapped.get(box.y)!, height: mapped.get(box.y + box.height)! - mapped.get(box.y)!,
  })
  return {
    ...layout, height: rows.length,
    nodes: layout.nodes.map(box), groups: layout.groups.map(box),
    routes: layout.routes.map(route => ({
      ...route,
      points: route.points.map(point => ({ x: point.x, y: mapped.get(point.y)! })),
      label: route.label ? { ...route.label, y: mapped.get(route.label.y)! } : undefined,
    })),
  }
}

export function layoutTerminalGraph(text: string, options: TerminalOptions = {}): TerminalLayout {
  const graph = parseMermaid(text)
  const columns = options.width ?? 120
  const labelWidth = Math.max(8, Math.min(22, Math.floor(columns / 5)))
  const preferred = arrange(graph, graph.direction, labelWidth)
  if (preferred.width <= columns) return preferred
  if (graph.direction === 'LR' || graph.direction === 'RL') {
    const stacked = arrange(graph, 'TD', labelWidth)
    if (stacked.width <= columns) return stacked
  }
  throw new Error(`Diagram needs ${preferred.width} columns; requested width is ${columns}.`)
}
