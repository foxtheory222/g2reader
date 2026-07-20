let payload
try {
  payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { input += chunk })
    process.stdin.on('end', () => resolve(input))
    process.stdin.on('error', reject)
  }))
} catch (error) {
  console.error(`G2 Reader guard could not parse hook input: ${error}`)
  process.exit(2)
}

const toolName = String(payload.tool_name ?? '')
const toolInput = payload.tool_input ?? {}

function block(message) {
  console.error(`G2 Reader guard blocked the call: ${message}`)
  process.exit(2)
}

function forceDeletesBranch(command) {
  const invocation = /\bgit(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))*\s+branch\s+([^\n;|&]+)/g
  for (const match of command.matchAll(invocation)) {
    const flags = match[1].trim().split(/\s+/).filter(argument => argument.startsWith('-'))
    const longDelete = flags.includes('--delete')
    const longForce = flags.includes('--force')
    const short = flags.filter(flag => !flag.startsWith('--')).join('').replaceAll('-', '')
    const deleteRequested = longDelete || short.includes('d') || short.includes('D')
    const forceRequested = longForce || short.includes('f') || short.includes('D')
    if (deleteRequested && forceRequested) return true
  }
  return false
}

if (toolName === 'Bash') {
  const command = String(toolInput.command ?? '')
  if (forceDeletesBranch(command)) {
    block('force-deleting branches is forbidden; use git branch -d')
  }
}

if (['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
  const filePath = String(toolInput.file_path ?? '')
  if (filePath.toLowerCase().endsWith('.ehpk')) {
    block('editing packed .ehpk artifacts is forbidden')
  }

  if (/(?:^|\/)app\.json$/i.test(filePath)) {
    const proposed = toolName === 'MultiEdit'
      ? (Array.isArray(toolInput.edits) ? toolInput.edits.map(edit => edit?.new_string ?? '').join('\n') : '')
      : String(toolName === 'Write' ? (toolInput.content ?? '') : (toolInput.new_string ?? ''))
    const nonEmptyPermissions = /["']permissions["']\s*:\s*\[(?!\s*\])/i.test(proposed)
    const networkLiteral = /network|internet|https?:\/\/|whitelist/i.test(proposed)
    if (nonEmptyPermissions || networkLiteral) {
      block('app.json must keep permissions empty and must not add network access or a whitelist')
    }
  }
}

// This hook is a best-effort guard for normal branch commands. Lower-level
// ref mutation such as `git update-ref` is deliberately outside its scope;
// repository policy and review remain authoritative.
