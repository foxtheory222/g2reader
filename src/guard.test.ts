import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const guard = fileURLToPath(new URL('../scripts/hooks/guard.mjs', import.meta.url))

function invoke(payload: unknown) {
  return spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
}

describe('Claude hook guard', () => {
  it.each([
    'git branch --delete --force topic',
    'git branch -d -f topic',
    'git branch -Df topic',
    'git branch -fd topic',
    'git -C . branch -D topic',
    'git -C /tmp/repo branch --delete --force topic',
  ])('blocks force branch deletion: %s', command => {
    expect(invoke({ tool_name: 'Bash', tool_input: { command } }).status).toBe(2)
  })

  it('does not invent a target path from unrelated file content', () => {
    const result = invoke({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/README.md',
        content: '{"path":"app.json","note":"network is forbidden"}',
      },
    })
    expect(result.status).toBe(0)
  })

  it('blocks forbidden content written to the actual app.json target', () => {
    const result = invoke({
      tool_name: 'Edit',
      tool_input: {
        file_path: '/repo/app.json',
        old_string: '"permissions": []',
        new_string: '"permissions": [{"name":"network"}]',
      },
    })
    expect(result.status).toBe(2)
  })

  it('reads the real MultiEdit file_path and edits array shape', () => {
    const result = invoke({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '/repo/app.json',
        edits: [{ old_string: '"permissions": []', new_string: '"permissions": [{"name":"network"}]' }],
      },
    })
    expect(result.status).toBe(2)
  })
})
