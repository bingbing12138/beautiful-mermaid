#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { layoutTerminalGraph } from './layout.ts'
import { renderTerminalLayout, terminalStats } from './render.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: 'string' }, layout: { type: 'string', default: 'elk' },
    ascii: { type: 'boolean' }, stats: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
})
if (values.help) {
  console.log('Usage: mermaid-term [file.mmd] [--width COLUMNS] [--layout elk] [--ascii] [--stats]\nReads stdin when no file is given.')
} else {
  try {
    if (values.layout !== 'elk') throw new Error('Supported layout: elk')
    const width = values.width ? Number(values.width) : (process.stdout.columns ?? 120)
    if (!Number.isInteger(width) || width < 20) throw new Error('--width must be an integer of at least 20.')
    const source = readFileSync(positionals[0] ?? 0, 'utf8')
    const options = { width, useAscii: values.ascii }
    const layout = layoutTerminalGraph(source, options)
    const drawing = renderTerminalLayout(layout, options)
    console.log(drawing)
    if (values.stats) {
      const stats = terminalStats(layout, drawing)
      console.error(`${stats.width} columns × ${stats.height} rows; blank ${(stats.blankRatio * 100).toFixed(1)}%; route length ${stats.routeLength}; bends ${stats.bends}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
