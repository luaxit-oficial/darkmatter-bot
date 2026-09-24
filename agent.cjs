
const { spawn } = require('child_process')
const fs = require('fs'), path = require('path'), crypto = require('crypto')

const DB = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent.json'), 'utf8')).db.replace(/\/$/, '')
const CODE_FILE = path.join(__dirname, '.code')
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let code
try { code = fs.readFileSync(CODE_FILE, 'utf8').trim() } catch {
  code = Array.from(crypto.randomBytes(9), b => ABC[b % 32]).join('')
  fs.writeFileSync(CODE_FILE, code)
}

const url = p => `${DB}/bots/${code}/${p}.json`
const get = p => fetch(url(p)).then(r => (r.ok ? r.json() : null)).catch(() => null)
const put = (p, v) => fetch(url(p), { method: 'PUT', body: JSON.stringify(v) }).catch(() => {})

let child = null, pair = null, logs = [], dirty = false, lastId = null
const push = l => { logs.push(String(l).slice(0, 300)); if (logs.length > 60) logs.shift(); dirty = true }

function start(c) {
  if (child) return
  const env = {
    ...process.env,
    WA_NUMBER: String(c.numero || ''),
    GROQ_API_KEY: String(c.groqKey || ''),
    GROQ_MODEL: String(c.model || ''),
    GRUPO_PERMITIDO: String(c.grupo || ''),
    BOT_NOMBRE: String(c.nombre || 'DARKMATTER BOT')
  }
  push('▶ Encendiendo bot...')
  child = spawn(process.execPath, ['bot.cjs'], { cwd: __dirname, env })
  const onData = d => d.toString().split('\n').forEach(l => {
    l = l.trim(); if (!l) return
    const m = l.match(/TU CODIGO ES: (\S+)/)
    if (m) pair = m[1]
    if (l.includes('Bot conectado')) pair = null
    push(l)
  })
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', n => { child = null; pair = null; push(`■ Bot detenido (${n})`) })
}

const stop = () => { if (child) child.kill('SIGTERM') }

// Solo se ejecutan estas 4 acciones fijas. Nada de lo que llegue de Firebase se ejecuta como comando.
async function tick() {
  const ctl = await get('ctl')
  const cmd = ctl && ctl.cmd
  if (cmd && cmd.id !== lastId) {
    lastId = cmd.id
    const c = ctl.config || {}
    if (cmd.action === 'start') start(c)
    else if (cmd.action === 'stop') stop()
    else if (cmd.action === 'restart') { stop(); setTimeout(() => start(c), 2500) }
    else if (cmd.action === 'reset') {
      stop()
      setTimeout(() => {
        fs.rmSync(path.join(__dirname, 'sesion'), { recursive: true, force: true })
        push('🗑 Sesión de WhatsApp borrada')
      }, 2500)
    }
  }
  await put('st', { running: !!child, pair, ts: Date.now() })
  if (dirty) { dirty = false; await put('logs', logs) }
}

;(async () => {
  const c0 = await get('ctl')
  lastId = c0 && c0.cmd ? c0.cmd.id : null // ignora órdenes viejas
  console.log(`\n🔑 TU CÓDIGO: ${code}\n\nPégalo en la página del panel. El bot se enciende desde allí.\nDeja Termux abierto.\n`)
  await tick()
  setInterval(tick, 3000)
})()

process.on('SIGINT', () => { stop(); put('st', { running: false, ts: 0 }).finally(() => process.exit()) })
