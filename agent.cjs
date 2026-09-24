const { spawn } = require('child_process')
const fs = require('fs'), path = require('path'), crypto = require('crypto')

const DB = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent.json'), 'utf8')).db.replace(/\/$/, '')
const SESSION_FILE = path.join(__dirname, '.session')
const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_RE = /^[0-9A-Z]{9}$/
const EXPIRA = 15 * 60 * 1000 // el panel se cierra solo tras 15 min sin actividad

const nuevoId = () => Array.from(crypto.randomBytes(9), b => ABC[b % 32]).join('')
const url = (id, p) => `${DB}/bots/${id}${p ? '/' + p : ''}.json`
const get = (id, p) => fetch(url(id, p)).then(r => (r.ok ? r.json() : null)).catch(() => null)
const put = (id, p, v) => fetch(url(id, p), { method: 'PUT', body: JSON.stringify(v) }).catch(() => {})
const del = id => fetch(url(id), { method: 'DELETE' }).catch(() => {})

let codigo = null   // código de un solo uso que se pega en la página
let sid = null      // canal secreto de la sesión del panel (nace cuando se usa el código)
let hb = { v: null, t: 0 }, lastId = null, busy = false
let child = null, estado = 'apagado', vinc = null, pedido = false, sesionCerrada = false
let logs = [], dirty = false

const push = l => { logs.push(String(l).slice(0, 300)); if (logs.length > 60) logs.shift(); dirty = true }
const guardarSesion = () => { try { fs.writeFileSync(SESSION_FILE, JSON.stringify({ codigo, sid })) } catch {} }
const publicar = () => (sid || codigo) ? put(sid || codigo, 'st', { estado, running: !!child, pair: vinc, ts: Date.now() }) : null
const setEstado = e => { estado = e; publicar() }

function nuevoCodigo() {
  codigo = nuevoId()
  guardarSesion()
  console.log(`\n🔑 CÓDIGO DEL PANEL: ${codigo}\n   Sirve una sola vez. Pégalo en la página junto con tu clave de Groq.\n`)
}

async function cerrarSesion(motivo) {
  const viejo = sid
  sid = null
  if (viejo) await del(viejo) // borra también la configuración guardada en Firebase
  console.log(motivo)
  nuevoCodigo()
}

function start(c) {
  if (child) return
  pedido = false; sesionCerrada = false; vinc = null
  setEstado('encendiendo')
  push('▶ Encendiendo bot...')
  const env = {
    ...process.env,
    WA_NUMBER: String(c.numero || ''),
    GROQ_API_KEY: String(c.groqKey || ''),
    GROQ_MODEL: String(c.model || ''),
    GRUPO_PERMITIDO: String(c.grupo || ''),
    BOT_NOMBRE: String(c.nombre || 'DARKMATTER BOT')
  }
  child = spawn(process.execPath, ['bot.cjs'], { cwd: __dirname, env })
  const onData = d => d.toString().split('\n').forEach(l => {
    l = l.trim(); if (!l) return
    const m = l.match(/TU CODIGO ES: (\S+)/)
    if (m) { vinc = m[1]; setEstado('vinculando') }
    else if (l.includes('Bot conectado')) { vinc = null; setEstado('encendido') }
    else if (l.includes('Conexión cerrada')) setEstado('reconectando')
    if (l.includes('Se cerró la sesión desde WhatsApp')) sesionCerrada = true
    push(l)
  })
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', n => {
    child = null; vinc = null
    push(`■ Bot detenido (${n})`)
    if (estado === 'cerrando') return
    setEstado(sesionCerrada ? 'sesion_cerrada' : (pedido || n === 0) ? 'apagado' : 'error')
  })
}

const matar = () => { if (child) { pedido = true; child.kill('SIGTERM') } }
const cuandoApague = (fn, n = 0) => (child && n < 20) ? setTimeout(() => cuandoApague(fn, n + 1), 500) : fn()

// Solo existen estas acciones fijas. Nada de lo que llegue de Firebase se ejecuta como comando.
async function tickSesion() {
  const ctl = await get(sid, 'ctl')
  if (ctl && ctl.hb !== hb.v) hb = { v: ctl.hb, t: Date.now() }
  else if (Date.now() - hb.t > EXPIRA) return cerrarSesion('\n⌛ El panel estuvo 15 minutos sin actividad. Se cerró la sesión.')

  const cmd = ctl && ctl.cmd
  if (cmd && cmd.id !== lastId) {
    lastId = cmd.id
    const c = ctl.config || {}
    if (cmd.action === 'start') start(c)
    else if (cmd.action === 'stop') { if (child) { setEstado('apagando'); matar() } }
    else if (cmd.action === 'restart') { if (child) { setEstado('apagando'); matar() } cuandoApague(() => start(c)) }
    else if (cmd.action === 'reset') {
      setEstado('cerrando'); matar()
      cuandoApague(() => {
        fs.rmSync(path.join(__dirname, 'sesion'), { recursive: true, force: true })
        push('🗑 Sesión de WhatsApp borrada')
        setEstado('sesion_cerrada')
      })
    }
    else if (cmd.action === 'salir') return cerrarSesion('\n👋 Saliste del panel. Ese acceso ya no sirve.')
  }
  await publicar()
  if (dirty) { dirty = false; await put(sid, 'logs', logs) }
}

async function tickCodigo() {
  const claim = await get(codigo, 'claim')
  if (claim && ID_RE.test(claim.sid || '') && claim.sid !== codigo) {
    const usado = codigo
    sid = claim.sid; codigo = null
    await del(usado) // el código queda quemado
    const c0 = await get(sid, 'ctl')
    lastId = c0 && c0.cmd ? c0.cmd.id : null
    hb = { v: c0 && c0.hb, t: Date.now() }
    dirty = true
    guardarSesion()
    console.log('\n✅ Panel vinculado. Ese código ya no sirve.\n')
    return publicar()
  }
  await put(codigo, 'st', { ts: Date.now() })
}

async function tick() {
  if (busy) return
  busy = true
  try { sid ? await tickSesion() : await tickCodigo() } finally { busy = false }
}

;(async () => {
  try { // limpia restos de la ejecución anterior
    const v = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
    for (const id of [v.sid, v.codigo]) if (ID_RE.test(id || '')) await del(id)
  } catch {}
  nuevoCodigo()
  await tick()
  setInterval(tick, 2000)
})()

process.on('SIGINT', async () => {
  matar()
  await Promise.all([sid && del(sid), codigo && del(codigo)])
  process.exit()
})
