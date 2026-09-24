
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const dns = require('dns').promises
const fs = require('fs')
const { evaluate } = require('mathjs')

// ── Configuración (la manda el panel web como variables de entorno) ──
const BOT_NOMBRE = process.env.BOT_NOMBRE || 'DARKMATTER BOT'
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GRUPO_PERMITIDO = process.env.GRUPO_PERMITIDO || ''

const USUARIOS_FILE = 'usuarios.json'
const RECORDATORIOS_FILE = 'recordatorios.json'
const USER_RE = /^[A-Za-z0-9_]{3,20}$/
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }

const leer = (f, def) => {
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch (e) { console.log(`Error al cargar ${f}:`, e.message) }
  return def
}
const guardar = (f, d) => {
  try { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf-8') } catch (e) { console.log(`Error al guardar ${f}:`, e.message) }
}

const usuarios = leer(USUARIOS_FILE, {})
const inicioBot = Date.now()
const programados = new Set()
let sockActual = null
let numeroGuardado = process.env.WA_NUMBER || null
let yaSolicitoCodigo = false

// ── Fuentes de texto ──
const L = 'abcdefghijklmnopqrstuvwxyz'
const chars = s => Array.from(s)
const cp = n => String.fromCodePoint(n)
const math = (U, l, esp = {}) => c => chars(c).map(x => {
  const k = x.charCodeAt(0)
  if (k >= 65 && k <= 90) return cp(U + k - 65)
  if (k >= 97 && k <= 122) return esp[x] || cp(l + k - 97)
  return x
}).join('')
const alfa = s => { const a = chars(s); return c => chars(c.toLowerCase()).map(x => { const i = L.indexOf(x); return i >= 0 ? a[i] : x }).join('') }
const lista = (arr, unir = '') => c => chars(c.toLowerCase()).map(x => { const i = L.indexOf(x); return i >= 0 ? arr[i] : x }).join(unir)
const sep = s => c => chars(c).join(s)
const suf = s => c => chars(c).map(x => x + s).join('')
const env = (a, b) => c => chars(c).map(x => a + x + b).join('')
const desde = base => c => chars(c.toUpperCase()).map(x => { const k = x.charCodeAt(0); return k >= 65 && k <= 90 ? cp(base + k - 65) : x }).join('')
const espejo = chars('ɐqɔpǝɟɓɥᴉɾʞlɯuodbɹsʇnʌʍxʎz')
const MATRIX = ['4', '8', '(', '|)', '3', '|=', '6', '|-|', '1', '_|', '|<', '1', '|v|', '|\\|', '0', '|D', '(,)', '|2', '5', '7', '|_|', '\\/', '\\/\\/', '><', '`/', '2']
const MORSE = '.- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --..'.split(' ')
const GLITCH = ['\u0334', '\u0335', '\u0336', '\u0337', '\u0338', '\u034F']

const FUENTES = [
  ['Fuente Alienígena', alfa('ᗩᗷᑕᗪᗴᖴǤᕼIᒍKᒪᗰᑎOᑭᑫᖇSTᑌᐯᗯ᙭Yᘔ')],
  ['Negrita Serif', math(0x1D400, 0x1D41A)],
  ['Cursiva Serif', math(0x1D434, 0x1D44E, { h: '\u210E' })],
  ['Negrita Cursiva', math(0x1D468, 0x1D482)],
  ['Script Elegante', math(0x1D49C, 0x1D4B6)],
  ['Fraktur', math(0x1D504, 0x1D51E)],
  ['Doble Trazo', math(0x1D538, 0x1D552)],
  ['Monoespaciado', math(0x1D670, 0x1D68A)],
  ['Círculos', math(0x24B6, 0x24D0)],
  ['Círculos Negros', desde(0x1F150)],
  ['Cuadros Negros', desde(0x1F130)],
  ['Subrayado', suf('\u0332')],
  ['Tachado', suf('\u0336')],
  ['Puntos Arriba', suf('\u0307')],
  ['Doble Subrayado', suf('\u0333')],
  ['Onda Abajo', suf('\u0330')],
  ['Espejado', c => chars(c).reverse().map(x => { const i = L.indexOf(x.toLowerCase()); return i >= 0 ? espejo[i] : x }).join('')],
  ['Pequeñas Mayúsculas', alfa('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘqʀsᴛᴜᴠᴡxʏᴢ')],
  ['Runas', alfa('ᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈqᚱᛊᛏᚢᚡᚹxᛃᛉ')],
  ['Etíope Decorado', alfa('ሃጌርዕቿቻኗዘጎጋዀረጠኒዐየqዪነፕሁሀሠሸሃዘ')],
  ['Coreano Decorado', alfa('ልጌርᗡቿቻኗዘጎጋዀረጠኒዐየዒዪነፕሁሀሠሸሃዙ')],
  ['Chino Decorado', alfa('卂乃匚ᗪ乇千ᘜ卄丨ﾌҜㄥ爪几ㄖ卩Ɋ尺丂ㄒㄩᐯ山乂ㄚ乙')],
  ['Glitch', c => chars(c).map(x => x + GLITCH[Math.floor(Math.random() * GLITCH.length)]).join('')],
  ['Estrellas', sep('★')], ['Puntos Separados', sep('·')], ['Guiones Separados', sep('-')], ['Barras Separadas', sep('/')],
  ['Corazones', sep('♥')], ['Diamantes', sep('◆')], ['Flores', sep('✿')], ['Ondas', sep('〜')], ['Cruces', sep('✞')],
  ['Llamas', sep('🔥')], ['Lunas', sep('🌙')], ['Relámpagos', sep('⚡')], ['Calaveras', sep('💀')], ['Rosas', sep('🌹')],
  ['Hojas', sep('🍃')], ['Cristales', sep('💎')], ['Veneno', sep('☠')],
  ['Medieval', alfa('αв¢∂єƒgнιנкℓмησρqяѕтυνωχуz')],
  ['Griego', alfa('αβςδεφγηιξκλμνθπqρστυvωχψζ')],
  ['Ruso Decorado', alfa('дбчдэфгчийклмнорqрстувшхуз')],
  ['Japonés Decorado', alfa('ム日亡り乇ｷム卄ﾉﾌズﾚﾶ刀のｱq尺丂ｲひ√шメﾘ乙')],
  ['Matrix', lista(MATRIX)],
  ['Braille', alfa('⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵')],
  ['Morse', lista(MORSE, ' ')],
  ['Banderas', desde(0x1F1E6)],
  ['Gótico Elegante', math(0x1D56C, 0x1D586)],
  ['Sans Serif', math(0x1D5A0, 0x1D5BA)],
  ['Sans Negrita', math(0x1D5D4, 0x1D5EE)],
  ['Sans Cursiva', math(0x1D608, 0x1D622)],
  ['Sans Negrita Cursiva', math(0x1D63C, 0x1D656)],
  ['Paréntesis', c => chars(c.toLowerCase()).map(x => { const k = x.charCodeAt(0); return k >= 97 && k <= 122 ? cp(0x249C + k - 97) : x }).join('')],
  ['Punto Final', suf('.')],
  ['Comillas', env('"', '"')], ['Llaves', env('{', '}')], ['Corchetes', env('[', ']')], ['Mayor Menor', env('<', '>')],
  ['Vibrante', c => chars(c).map((x, i) => i % 2 === 0 ? x.toUpperCase() : x.toLowerCase()).join('')],
  ['Invertido Vibrante', c => chars(c).map((x, i) => i % 2 === 0 ? x.toLowerCase() : x.toUpperCase()).join('')],
  ['Espaciado', sep(' ')], ['Doble Espaciado', sep('  ')],
  ['Gótico Negrita', math(0x1D56C, 0x1D586)],
  ['Cuadrado', c => env('[', ']')(c.toUpperCase())],
  ['Círculo Simple', c => env('(', ')')(c.toUpperCase())],
  ['Tilde Arriba', suf('\u0303')], ['Acento Grave', suf('\u0300')], ['Acento Agudo', suf('\u0301')], ['Circunflejo', suf('\u0302')],
  ['Diéresis', suf('\u0308')], ['Anillo', suf('\u030A')], ['Cedilla', suf('\u0327')], ['Ogónek', suf('\u0328')],
  ['Macron', suf('\u0304')], ['Breve', suf('\u0306')], ['Caron', suf('\u030C')], ['Doble Agudo', suf('\u030B')],
  ['Línea Vertical', suf('|')],
  ['Slash Separado', sep('\\')], ['Tilde Separado', sep('~')], ['Exclamación', sep('!')], ['Interrogación', sep('?')],
  ['Arroba', sep('@')], ['Numeral', sep('#')], ['Dólar', sep('$')], ['Porcentaje', sep('%')], ['Ampersand', sep('&')],
  ['Más', sep('+')], ['Igual', sep('=')], ['Dos Puntos', sep(':')], ['Punto y Coma', sep(';')], ['Virgulilla', sep('°')],
  ['Infinito', sep('∞')], ['Triángulo', sep('△')], ['Cuadro Vacío', sep('□')], ['Rombo', sep('◇')], ['Estrella Vacía', sep('☆')],
  ['Musical', sep('♪')], ['Alas', sep('»')], ['Flecha Derecha', sep('→')], ['Flecha Izquierda', sep('←')],
  ['Flecha Arriba', sep('↑')], ['Flecha Abajo', sep('↓')], ['Espadas', sep('⚔')], ['Ankh', sep('☥')], ['Yin Yang', sep('☯')],
  ['Pentagrama', sep('⛤')], ['Corona', sep('♛')], ['Escudo', sep('⛨')]
].map(([nombre, fn], i) => ({ id: i + 1, nombre, fn }))

// ── Formato de mensajes ──
const PIE = '╰ׅ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ╯'
const cabecera = () => `╭┈ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ╮\n│🌑 *${BOT_NOMBRE}* 🌑\n╰ׅ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ─ׄ╯`
const seccion = (t, cuerpo) => `╭┈ׄ─ׄ─ׄ𐔌 ${t} 𐦯─ׄ─ׄ\n${cuerpo}\n${PIE}`
const caja = (t, cuerpo) => `${cabecera()}\n\n${seccion(t, cuerpo)}`.trim()

const AYUDA = [
  ['👤 *CUENTA*', [['!register [username]', 'Crea tu cuenta en el bot.'], ['!cambiarnombre [username]', 'Cambia tu nombre de usuario.'], ['!perfil', 'Muestra tu perfil y estadísticas.']]],
  ['🔧 *GENERALES*', [['!ping', 'Revisa la latencia del bot.'], ['!hora', 'Muestra la hora del servidor.'], ['!clima [ciudad]', 'Consulta el clima actual.'], ['!buscar [consulta]', 'Busca info precisa sobre un tema.'], ['!imagen [consulta]', 'Busca y envía una imagen.'], ['!meme', 'Recibe un meme en español.']]],
  ['🛠️ *UTILIDAD*', [['!calcular [expresión]', 'Calculadora rápida.'], ['!recordar [min] [msg]', 'Programa un recordatorio.'], ['!noticias [tema]', 'Últimos titulares sobre un tema.'], ['!cotizacion [moneda]', 'Tasa de cambio actual.'], ['!ip [dominio]', 'Resuelve la IP de un dominio.'], ['!acortar [url]', 'Acorta un enlace largo.'], ['!qr [texto]', 'Genera un código QR.']]],
  ['🔤 *FUENTES*', [['!fuentes', 'Lista todas las fuentes disponibles.'], ['!seleccionar [num] [texto]', 'Aplica la fuente elegida al texto.']]],
  ['🤖 *IA GENERAL*', [['!ia [pregunta]', 'Respuesta general sobre cualquier tema.'], ['!explicar [tema]', 'Explicación sencilla para estudiantes.'], ['!explicarpro [tema]', 'Explicación técnica y detallada.'], ['!eli5 [tema]', 'Explicación como si tuvieras 5 años.']]],
  ['📚 *EDUCACIÓN IA*', [['!resumir [texto]', 'Resume textos largos.'], ['!corregir [texto]', 'Corrige ortografía y gramática.'], ['!parafrasear [texto]', 'Reescribe un texto con otras palabras.'], ['!continuar [texto]', 'Continúa un texto automáticamente.'], ['!ejemplos [tema]', 'Genera ejemplos educativos.']]],
  ['💻 *PROGRAMACIÓN IA*', [['!code [petición]', 'Genera código.'], ['!debug [código]', 'Busca errores en un código.'], ['!optimizar [código]', 'Mejora el rendimiento del código.'], ['!explicarcodigo [código]', 'Explica línea por línea.'], ['!traducircodigo [origen] [destino] [código]', 'Convierte código entre lenguajes.'], ['!documentar [código]', 'Añade comentarios automáticamente.']]],
  ['✍️ *ESCRITURA IA*', [['!redactar [tema]', 'Redacta un texto sobre un tema.'], ['!email [tema]', 'Redacta un correo electrónico.'], ['!titulo [tema]', 'Genera títulos.'], ['!descripcion [tema]', 'Genera descripciones.'], ['!hashtags [tema]', 'Genera hashtags relevantes.']]],
  ['🌍 *LENGUAJE IA*', [['!traduciria [idioma] [texto]', 'Traducción natural.'], ['!sinonimos [palabra]', 'Lista sinónimos.'], ['!antonimos [palabra]', 'Lista antónimos.'], ['!formal [texto]', 'Convierte un texto a formal.'], ['!informal [texto]', 'Hace un texto más casual.'], ['!mejorar [texto]', 'Mejora la redacción.']]],
  ['🧠 *INVESTIGACIÓN IA*', [['!investigar [tema]', 'Definición, historia, ventajas y más.'], ['!proscontras [tema]', 'Pros y contras de un tema.'], ['!cronologia [tema]', 'Cronología de un tema.'], ['!comparar [tema1] vs [tema2]', 'Compara dos temas.'], ['!preguntas [tema]', 'Genera preguntas de estudio.']]]
]
const ayuda = () => `${cabecera()}\n\n${AYUDA.map(([t, cmds]) => seccion(t, cmds.map(([c, d]) => `*${c}*\n> ${d}`).join('\n'))).join('\n\n')}`

// ── Comandos de IA (Groq) ──
// i: icono, t: título, a: 1 si el título lleva el tema, s: rol del sistema, p: inicio del prompt, k: tokens, u/e: uso y ejemplo, m: largo máximo
const IA = {
  ia: { i: '🤖', t: 'RESPUESTA IA', s: 'Eres un asistente de IA útil, claro y conciso. Respondes siempre en español.', p: '', k: 1024, u: '[pregunta]', e: 'Ej: !ia ¿Qué es la teoría de la relatividad?' },
  explicar: { i: '📘', t: 'EXPLICACIÓN', a: 1, s: 'Eres un profesor que explica temas de forma sencilla y clara para estudiantes, en español, con ejemplos cuando sea útil.', p: 'Explica de forma sencilla: ', k: 900, u: '[tema]', e: 'Ej: !explicar fotosíntesis' },
  explicarpro: { i: '🎓', t: 'EXPLICACIÓN TÉCNICA', a: 1, s: 'Eres un experto académico. Da explicaciones técnicas, detalladas y precisas en español, usando terminología especializada cuando sea apropiado.', p: 'Explica de forma técnica y detallada: ', k: 1200, u: '[tema]', e: 'Ej: !explicarpro agujeros negros' },
  eli5: { i: '🧒', t: 'ELI5', a: 1, s: 'Explicas temas complejos como si hablaras con un niño de 5 años, usando analogías simples y lenguaje muy sencillo, en español.', p: 'Explícame como si tuviera 5 años: ', k: 700, u: '[tema]', e: 'Ej: !eli5 inteligencia artificial' },
  resumir: { i: '📝', t: 'RESUMEN', s: 'Resumes textos largos de forma clara y concisa, conservando las ideas principales, en español.', p: 'Resume el siguiente texto:\n\n', k: 800, u: '[texto]', e: 'Ej: !resumir La Segunda Guerra Mundial comenzó...' },
  corregir: { i: '✅', t: 'TEXTO CORREGIDO', s: 'Corriges ortografía y gramática en español. Devuelves únicamente el texto corregido, sin explicaciones adicionales.', p: 'Corrige la ortografía y gramática de este texto:\n\n', k: 800, u: '[texto]', e: 'Ej: !corregir ola komo estas' },
  parafrasear: { i: '🔄', t: 'PARÁFRASIS', s: 'Reescribes textos con otras palabras, manteniendo el significado original, en español. Devuelves únicamente el texto parafraseado.', p: 'Parafrasea este texto:\n\n', k: 800, u: '[texto]', e: 'Ej: !parafrasear La tecnología avanza rápidamente.' },
  continuar: { i: '✏️', t: 'CONTINUACIÓN', s: 'Continúas textos de forma coherente y natural, manteniendo el mismo estilo y tono, en español.', p: 'Continúa este texto de forma natural:\n\n', k: 800, u: '[texto]', e: 'Ej: !continuar Había una vez un pequeño pueblo...' },
  ejemplos: { i: '📋', t: 'EJEMPLOS', a: 1, s: 'Generas ejemplos educativos claros y variados sobre un tema, en español, en formato de lista.', p: 'Dame ejemplos educativos sobre: ', k: 900, u: '[tema]', e: 'Ej: !ejemplos verbos irregulares' },
  debug: { i: '🐛', t: 'DEBUG', s: 'Eres un experto programador. Analizas código, encuentras errores y explicas cómo corregirlos de forma clara, en español.', p: 'Encuentra los errores en este código y explica cómo corregirlos:\n\n', k: 1200, u: '[código]', e: 'Ej: !debug print("hola"' },
  optimizar: { i: '⚡', t: 'CÓDIGO OPTIMIZADO', s: 'Eres un experto en optimización de código. Mejoras el rendimiento y la legibilidad del código que se te da, explicando los cambios en español.', p: 'Optimiza este código y explica las mejoras:\n\n', k: 1200, u: '[código]', e: 'Ej: !optimizar for(let i=0;i<arr.length;i++){...}' },
  explicarcodigo: { i: '📖', t: 'EXPLICACIÓN DE CÓDIGO', s: 'Eres un profesor de programación. Explicas código línea por línea de forma clara y didáctica, en español.', p: 'Explica línea por línea este código:\n\n', k: 1200, u: '[código]', e: 'Ej: !explicarcodigo function suma(a,b){return a+b}' },
  documentar: { i: '📑', t: 'CÓDIGO DOCUMENTADO', s: 'Eres un experto programador. Añades comentarios claros y útiles al código que se te proporciona, sin cambiar su lógica. Devuelve el código comentado en bloque de código.', p: 'Añade comentarios explicativos a este código:\n\n', k: 1200, u: '[código]', e: 'Ej: !documentar function suma(a,b){return a+b}' },
  code: { i: '💻', t: 'CÓDIGO GENERADO', s: 'Eres un experto programador. Generas código limpio, funcional y bien estructurado según lo que se te pide. Explica brevemente el código en español.', p: 'Genera código para: ', k: 1500, m: 3800, u: '[petición]', e: 'Ej: !code hacer un sistema de inventario en Lua' },
  redactar: { i: '✍️', t: 'REDACCIÓN', a: 1, s: 'Eres un redactor profesional. Escribes textos bien estructurados, claros y coherentes en español según lo que se te pide.', p: 'Redacta un texto sobre: ', k: 1200, u: '[tema]', e: 'Ej: !redactar ensayo sobre el cambio climático' },
  email: { i: '📧', t: 'CORREO', s: 'Eres un experto en redacción de correos electrónicos profesionales. Escribes correos claros, corteses y bien estructurados en español, incluyendo asunto, saludo, cuerpo y despedida.', p: 'Redacta un correo electrónico sobre: ', k: 1000, u: '[tema]', e: 'Ej: !email pedir información a una universidad' },
  titulo: { i: '🏷️', t: 'TÍTULOS', a: 1, s: 'Generas títulos creativos y atractivos para trabajos, videos o publicaciones, en español. Devuelve una lista de 5 a 8 opciones de títulos.', p: 'Genera títulos para: ', k: 600, u: '[tema]', e: 'Ej: !titulo video sobre viajes' },
  descripcion: { i: '📄', t: 'DESCRIPCIÓN', a: 1, s: 'Generas descripciones atractivas y profesionales en español para productos, videos, publicaciones u otros contenidos.', p: 'Genera una descripción para: ', k: 700, u: '[tema]', e: 'Ej: !descripcion producto de tecnología' },
  hashtags: { i: '#️⃣', t: 'HASHTAGS', a: 1, s: 'Generas hashtags relevantes y populares para redes sociales sobre un tema dado. Devuelve solo la lista de hashtags separados por espacios, sin explicaciones.', p: 'Genera hashtags para: ', k: 300, u: '[tema]', e: 'Ej: !hashtags roblox' },
  sinonimos: { i: '🔄', t: 'SINÓNIMOS', a: 1, s: 'Generas listas de sinónimos en español para una palabra dada. Devuelve solo la lista de sinónimos separados por comas.', p: 'Dame sinónimos de la palabra: ', k: 300, u: '[palabra]', e: 'Ej: !sinonimos feliz' },
  antonimos: { i: '↔️', t: 'ANTÓNIMOS', a: 1, s: 'Generas listas de antónimos en español para una palabra dada. Devuelve solo la lista de antónimos separados por comas.', p: 'Dame antónimos de la palabra: ', k: 300, u: '[palabra]', e: 'Ej: !antonimos feliz' },
  formal: { i: '🎩', t: 'TEXTO FORMAL', s: 'Conviertes textos informales en textos formales y profesionales, en español. Devuelve únicamente el texto convertido.', p: 'Convierte este texto a un tono formal:\n\n', k: 700, u: '[texto]', e: 'Ej: !formal q onda como estas' },
  informal: { i: '😎', t: 'TEXTO INFORMAL', s: 'Conviertes textos formales en textos casuales e informales, en español. Devuelve únicamente el texto convertido.', p: 'Convierte este texto a un tono informal y casual:\n\n', k: 700, u: '[texto]', e: 'Ej: !informal Estimado señor, le escribo para informarle...' },
  mejorar: { i: '✨', t: 'TEXTO MEJORADO', s: 'Mejoras la redacción de textos, haciendo que suenen más claros, elegantes y profesionales, en español, sin cambiar el significado original.', p: 'Mejora la redacción de este texto:\n\n', k: 800, u: '[texto]', e: 'Ej: !mejorar la tecnologia es buena para todos' },
  investigar: { i: '🧪', t: 'INVESTIGACIÓN', a: 1, s: 'Eres un investigador experto. Para cada tema das una investigación completa en español organizada en: Definición, Historia, Funcionamiento, Ventajas, Desventajas y Curiosidades. Usa esos encabezados.', p: 'Investiga a fondo el tema: ', k: 1500, m: 3800, u: '[tema]', e: 'Ej: !investigar energía nuclear' },
  proscontras: { i: '⚖️', t: 'PROS Y CONTRAS', a: 1, s: 'Analizas temas presentando una lista clara de pros (ventajas) y contras (desventajas), en español, organizados en dos secciones.', p: 'Dame los pros y contras de: ', k: 1000, u: '[tema]', e: 'Ej: !proscontras inteligencia artificial' },
  cronologia: { i: '📅', t: 'CRONOLOGÍA', a: 1, s: 'Generas cronologías claras y ordenadas con fechas y eventos relevantes sobre un tema, en español.', p: 'Dame una cronología de los eventos más importantes sobre: ', k: 1200, u: '[tema]', e: 'Ej: !cronologia segunda guerra mundial' },
  comparar: { i: '🆚', t: 'COMPARACIÓN', s: 'Comparas dos temas de forma objetiva, destacando similitudes, diferencias, ventajas y desventajas de cada uno, en español.', p: 'Compara en detalle: ', k: 1200, u: '[tema1] vs [tema2]', e: 'Ej: !comparar python vs javascript' },
  preguntas: { i: '❓', t: 'PREGUNTAS', a: 1, s: 'Generas preguntas de estudio claras y variadas sobre un tema, útiles para repasar o evaluar conocimientos, en español, en formato de lista numerada.', p: 'Genera preguntas de estudio sobre: ', k: 900, u: '[tema]', e: 'Ej: !preguntas sistema solar' },
  traducircodigo: {
    i: '🔁', s: 'Eres un experto programador políglota. Traduces código entre lenguajes de programación manteniendo la misma lógica y funcionalidad, en español para las explicaciones.', k: 1200,
    u: '[origen] [destino] [código]', e: 'Ej: !traducircodigo js python console.log("hola")',
    pre: a => { const w = a.split(' '); const c = w.slice(2).join(' ').trim(); return w.length >= 3 && c ? { t: `${w[0].toUpperCase()} → ${w[1].toUpperCase()}`, p: `Convierte este código de ${w[0]} a ${w[1]}:\n\n${c}` } : null }
  },
  traduciria: {
    i: '🌐', s: 'Eres un traductor experto que produce traducciones naturales y fluidas, no literales, adaptando expresiones idiomáticas al idioma de destino.', k: 600,
    u: '[idioma] [texto]', e: 'Ej: !traduciria ingles hola amigo',
    pre: a => { const n = a.indexOf(' '); if (n === -1) return null; const id = a.slice(0, n).trim(), c = a.slice(n + 1).trim(); return c ? { t: `TRADUCCIÓN (${id.toUpperCase()})`, p: `Traduce de forma natural al idioma "${id}" el siguiente texto:\n\n${c}` } : null }
  }
}

// ── Utilidades ──
const formatUptime = ms => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`
}
const formatFecha = t => {
  const f = new Date(t), d = n => String(n).padStart(2, '0')
  return `${d(f.getDate())}/${d(f.getMonth() + 1)}/${f.getFullYear()} ${d(f.getHours())}:${d(f.getMinutes())}`
}
const limitarTexto = (t, max) => (t.length > max ? t.slice(0, max).trim() + '...' : t)
const limpiarHtml = t => t.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim()

const enviar = (sock, jid, texto) => sock.sendMessage(jid, { text: texto })
async function reaccionar(sock, msg, emoji) {
  try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }) } catch (e) { console.log('No se pudo reaccionar:', e.message) }
}

function programar(rec) {
  if (programados.has(rec.id)) return
  programados.add(rec.id)
  setTimeout(async () => {
    try { if (sockActual) await enviar(sockActual, rec.remitente, `🔔 *¡RECORDATORIO!* 🔔\n\n"${rec.mensaje}"`) } catch (e) { console.log('Error al enviar recordatorio:', e.message) }
    programados.delete(rec.id)
    guardar(RECORDATORIOS_FILE, leer(RECORDATORIOS_FILE, []).filter(r => r.id !== rec.id))
  }, Math.max(0, rec.ejecutarEn - Date.now()))
}
function restaurarRecordatorios() {
  const pendientes = leer(RECORDATORIOS_FILE, []).filter(r => r.ejecutarEn > Date.now())
  guardar(RECORDATORIOS_FILE, pendientes)
  pendientes.forEach(programar)
  if (pendientes.length) console.log(`⏰ ${pendientes.length} recordatorio(s) restaurado(s).`)
}

// ── Búsquedas ──
async function buscarEnWikipedia(consulta) {
  try {
    const resp = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(consulta)}`)
    if (!resp.ok) return null
    const d = await resp.json()
    if (d.extract && d.extract.trim().length > 30) return { texto: d.extract.trim(), urlOrigen: d.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(consulta)}` }
  } catch (e) {}
  return null
}
async function buscarEnWikipediaSearch(consulta) {
  try {
    const resp = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(consulta)}&format=json&utf8=1&srlimit=3`)
    if (!resp.ok) return null
    const p = (await resp.json())?.query?.search?.[0]
    if (!p) return null
    return { texto: `${p.title}: ${limpiarHtml(p.snippet)}`, urlOrigen: `https://es.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` }
  } catch (e) { return null }
}
async function buscarEnDuckDuckGoHTML(consulta) {
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`, { headers: UA })
    if (!resp.ok) return null
    const html = await resp.text()
    const res = []
    for (const b of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
      let u = b[1]
      const m = u.match(/uddg=([^&]+)/)
      if (m) { try { u = decodeURIComponent(m[1]) } catch (e) {} }
      const titulo = limpiarHtml(b[2]), snippet = limpiarHtml(b[3])
      if (titulo && snippet.length > 25) res.push({ titulo, snippet, url: u })
      if (res.length >= 5) break
    }
    if (!res.length) return null
    const el = res[Math.floor(Math.random() * Math.min(3, res.length))]
    return { texto: `${el.titulo}: ${el.snippet}`, urlOrigen: el.url }
  } catch (e) { return null }
}
async function buscarEnDuckDuckGo(consulta) {
  try {
    const resp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(consulta)}&format=json&no_html=1&skip_disambig=1`)
    if (!resp.ok) return null
    const d = await resp.json()
    let resumen = d.AbstractText && d.AbstractText.trim()
    let url = d.AbstractURL && d.AbstractURL.trim()
    if (!resumen && d.RelatedTopics?.length) {
      const c = d.RelatedTopics.filter(t => t.Text && t.Text.length > 20)
      if (c.length) { const el = c[Math.floor(Math.random() * c.length)]; resumen = el.Text; url = el.FirstURL }
    }
    if (!resumen && d.Answer && d.Answer.trim()) resumen = d.Answer.trim()
    if (resumen && resumen.length > 20) return { texto: resumen, urlOrigen: url || `https://duckduckgo.com/?q=${encodeURIComponent(consulta)}` }
  } catch (e) {}
  return null
}
async function buscarImagenesWeb(consulta, cantidad) {
  try {
    const resp = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(consulta)}&form=HDRSC2&first=1&qft=+filterui:photo-photo`, { headers: UA })
    if (!resp.ok) return []
    const html = await resp.text()
    const malas = ['clipart', 'cartoon', 'icon', 'vector', 'dibujo', 'drawing', 'logo', 'png-transparent', 'silhouette', 'coloring']
    const esImg = u => /\.(jpg|jpeg|png|webp)/i.test(u)
    let urls = [...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&"]+?)&quot;/g)].map(m => m[1]).filter(esImg)
    if (!urls.length) urls = [...html.matchAll(/"murl":"(https?:\/\/[^"]+?)"/g)].map(m => m[1]).filter(esImg)
    const buenas = urls.filter(u => !malas.some(p => u.toLowerCase().includes(p)))
    return [...new Set(buenas.length >= 3 ? buenas : urls)].slice(0, cantidad || 8)
  } catch (e) { return [] }
}

async function consultarGroq(systemPrompt, userPrompt, maxTokens) {
  if (!GROQ_API_KEY) return { ok: false, mensaje: '❌ Falta la clave de Groq. Ponla en el panel web y reinicia el bot.' }
  try {
    const respuesta = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: maxTokens || 1024,
        temperature: 0.7
      })
    })
    if (!respuesta.ok) {
      console.log('Error Groq HTTP:', respuesta.status, await respuesta.text())
      if (respuesta.status === 401) return { ok: false, mensaje: '❌ La clave de Groq no es válida. Revísala en el panel web.' }
      if (respuesta.status === 429) return { ok: false, mensaje: '❌ Se alcanzó el límite de uso de la IA por ahora. Intenta de nuevo en unos minutos.' }
      return { ok: false, mensaje: '❌ La IA no pudo procesar tu solicitud en este momento.' }
    }
    const contenido = (await respuesta.json())?.choices?.[0]?.message?.content
    if (!contenido || !contenido.trim()) return { ok: false, mensaje: '❌ La IA no devolvió una respuesta válida.' }
    return { ok: true, texto: contenido.trim() }
  } catch (e) {
    console.log('Error al consultar Groq:', e.message)
    return { ok: false, mensaje: '❌ Ocurrió un error al conectar con la IA.' }
  }
}

// ── Comandos ──
async function comando(sock, msg, texto, jid) {
  const sp = texto.search(/\s/)
  const cmd = (sp === -1 ? texto.slice(1) : texto.slice(1, sp)).toLowerCase()
  const args = sp === -1 ? '' : texto.slice(sp + 1).trim()
  const r = t => enviar(sock, jid, t)
  const intentar = async (fn, errorMsg) => { try { return await fn() } catch (e) { console.log(`Error ${cmd}:`, e.message); return r(errorMsg) } }
  const uso = (u, e) => r(`❌ Formato incorrecto. Usa: !${cmd} ${u}\n${e}`)

  if (cmd === 'help') return r(ayuda())

  if (cmd === 'register') {
    if (!args) return uso('TuNombreDeUsuario', 'Ej: !register DarkMatterVip001')
    if (!USER_RE.test(args)) return r('❌ El nombre de usuario debe tener entre 3 y 20 caracteres (letras, números o "_"), sin espacios.\nEj: !register DarkMatterVip001')
    if (Object.values(usuarios).some(u => u.username.toLowerCase() === args.toLowerCase())) return r('❌ Ese nombre de usuario ya está en uso. Elige otro.')
    usuarios[jid] = { username: args, fechaRegistro: Date.now(), comandosUsados: 0 }
    guardar(USUARIOS_FILE, usuarios)
    return r(caja('✅ *REGISTRO*', `ꕤ 👤 Username: *${args}*\nꕤ 🏆 Estado: Registrado con éxito\nꕤ 🖤 Bienvenido a Darkmatter`))
  }

  const usuario = usuarios[jid]
  if (!usuario) return r('🔒 Debes registrarte primero.\nUsa: !register TuNombreDeUsuario\nEj: !register DarkMatterVip001')
  usuario.comandosUsados = (usuario.comandosUsados || 0) + 1
  guardar(USUARIOS_FILE, usuarios)

  if (cmd === 'ping') {
    const inicio = Date.now()
    await sock.sendMessage(jid, { text: '🏓 Calculando ping...' })
    const latencia = Date.now() - inicio
    return r(caja('📊 *ESTADO*', `ꕤ 🏓 Ping: *${latencia}ms*\nꕤ ⏱️ Uptime: *${formatUptime(Date.now() - inicioBot)}*\nꕤ 🟢 Estado: *Online*`))
  }

  if (cmd === 'perfil') {
    return r(caja('🗂️ *PERFIL*', `ꕤ 👤 Username: *${usuario.username}*\nꕤ 📅 Registrado: *${formatFecha(usuario.fechaRegistro || Date.now())}*\nꕤ 📊 Comandos usados: *${usuario.comandosUsados}*`))
  }

  if (cmd === 'hora') {
    const h = new Date().toLocaleString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return r(caja('🕐 *HORA*', `ꕤ ${h}`))
  }

  if (cmd === 'clima') {
    if (!args) return uso('[ciudad]', 'Ej: !clima Bogota')
    return intentar(async () => {
      const resp = await fetch(`https://wttr.in/${encodeURIComponent(args)}?format=j1`)
      if (!resp.ok) return r('❌ No se pudo obtener el clima para esa ciudad.')
      const a = (await resp.json()).current_condition[0]
      return r(caja(`🌍 *CLIMA: ${args.toUpperCase()}*`, `ꕤ 🌡️ Temperatura: *${a.temp_C}°C*\nꕤ 🤔 Sensación: *${a.FeelsLikeC}°C*\nꕤ ☁️ Condición: *${a.weatherDesc[0].value}*\nꕤ 💧 Humedad: *${a.humidity}%*\nꕤ 💨 Viento: *${a.windspeedKmph} km/h*`))
    }, '❌ Ocurrió un error al consultar el clima.')
  }

  if (cmd === 'cambiarnombre') {
    if (!args) return uso('[nuevo_username]', 'Ej: !cambiarnombre DarkMatterVip002')
    if (!USER_RE.test(args)) return r('❌ El nombre de usuario debe tener entre 3 y 20 caracteres (letras, números o "_"), sin espacios.\nEj: !cambiarnombre DarkMatterVip002')
    if (Object.entries(usuarios).some(([j, u]) => j !== jid && u.username.toLowerCase() === args.toLowerCase())) return r('❌ Ese nombre de usuario ya está en uso. Elige otro.')
    const anterior = usuario.username
    usuario.username = args
    guardar(USUARIOS_FILE, usuarios)
    return r(caja('🔄 *USERNAME*', `ꕤ De: *${anterior}*\nꕤ A: *${args}*\nꕤ ✓ Actualizado correctamente`))
  }

  if (cmd === 'meme') {
    return intentar(async () => {
      const subs = ['es', 'argentina', 'mexico', 'colombia', 'venezuela', 'chile', 'memesES', 'hispanics', 'SpanishMeme', 'memesenespanol']
      let resp = await fetch(`https://meme-api.com/gimme/${subs[Math.floor(Math.random() * subs.length)]}`)
      if (!resp.ok) resp = await fetch('https://meme-api.com/gimme')
      if (!resp.ok) return r('❌ No se pudo obtener un meme en este momento.')
      const d = await resp.json()
      if (d.nsfw || !d.url) return r('❌ No se encontró un meme adecuado, intenta de nuevo.')
      return sock.sendMessage(jid, { image: { url: d.url }, caption: `😂 *${d.title}*\n📌 r/${d.subreddit}` })
    }, '❌ Ocurrió un error al obtener el meme.')
  }

  if (cmd === 'buscar') {
    if (!args) return uso('[consulta]', 'Ej: !buscar fotosíntesis')
    return intentar(async () => {
      const pasos = [
        [buscarEnDuckDuckGoHTML, '🔎 DuckDuckGo (web)'], [buscarEnWikipediaSearch, '📖 Wikipedia'],
        [buscarEnWikipedia, '📖 Wikipedia'], [buscarEnDuckDuckGo, '🔎 DuckDuckGo']
      ]
      let res = null, fuente = ''
      for (const [fn, nombre] of pasos) { res = await fn(args); if (res) { fuente = nombre; break } }
      if (!res) return r(`❌ No se encontró información precisa sobre *"${args}"*.\n\nIntenta con términos más específicos o en español.`)
      const resumen = limitarTexto(res.texto.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), 900)
      return r(`${caja('🔎 *BÚSQUEDA*', `ꕤ Consulta: *${args}*\nꕤ Fuente: ${fuente}`)}\n\n${resumen}\n\n🔗 Origen: ${res.urlOrigen}`)
    }, '❌ Ocurrió un error al realizar la búsqueda.')
  }

  if (cmd === 'imagen') {
    if (!args) return uso('[consulta]', 'Ej: !imagen atardecer en el mar')
    return intentar(async () => {
      const urls = await buscarImagenesWeb(args, 8)
      if (!urls.length) return r(`❌ No se encontró ninguna imagen para *"${args}"*.\n\nIntenta con otros términos.`)
      const u = urls[Math.floor(Math.random() * urls.length)]
      return sock.sendMessage(jid, { image: { url: u }, caption: `🖼️ *Imagen: ${args}*\n\n🔗 Fuente: ${u}` })
    }, '❌ Ocurrió un error al buscar la imagen.')
  }

  if (cmd === 'recordar') {
    const partes = args.split(' ')
    if (partes.length < 2 || isNaN(partes[0])) return uso('[minutos] [mensaje]', 'Ej: !recordar 30 sacar la pizza')
    const minutos = parseFloat(partes[0])
    const mensaje = partes.slice(1).join(' ').trim()
    if (minutos <= 0 || minutos > 1440) return r('❌ El tiempo debe estar entre 1 y 1440 minutos (24 horas).')
    const ejecutarEn = Date.now() + minutos * 60 * 1000
    const rec = { id: `${jid}_${ejecutarEn}`, remitente: jid, mensaje, ejecutarEn }
    const pendientes = leer(RECORDATORIOS_FILE, [])
    pendientes.push(rec)
    guardar(RECORDATORIOS_FILE, pendientes)
    await r(`⏰ Recordatorio programado para dentro de ${minutos} minuto(s):\n"${mensaje}"`)
    return programar(rec)
  }

  if (cmd === 'calcular') {
    if (!args) return uso('[expresión]', 'Ej: !calcular (15*3)/2')
    try {
      const res = evaluate(args)
      if (typeof res !== 'number' || !isFinite(res)) throw new Error('Resultado inválido')
      return r(`🧮 *CALCULADORA*\n\n${args} = *${res}*`)
    } catch (e) {
      console.log('Error calcular:', e.message)
      return r('❌ Expresión inválida. Usa solo números y operadores: + - * / % ( )')
    }
  }

  if (cmd === 'noticias') {
    if (!args) return uso('[tema]', 'Ej: !noticias tecnologia')
    return intentar(async () => {
      const resp = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(args)}&hl=es&gl=CO&ceid=CO:es`)
      if (!resp.ok) return r('❌ No se pudieron obtener noticias en este momento.')
      const xml = await resp.text()
      const titulos = [...xml.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t && !t.includes('Google Noticias')).slice(0, 5)
      if (!titulos.length) return r(`❌ No se encontraron noticias sobre "${args}".`)
      return r(caja(`📰 *NOTICIAS: ${args.toUpperCase()}*`, titulos.map((t, i) => `${i + 1}. ${t}`).join('\n\n')))
    }, '❌ Ocurrió un error al buscar noticias.')
  }

  if (cmd === 'cotizacion') {
    const moneda = args.toUpperCase()
    if (!moneda) return uso('[moneda]', 'Ej: !cotizacion USD')
    return intentar(async () => {
      const resp = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(moneda)}`)
      if (!resp.ok) return r(`❌ No se pudo obtener la cotización de "${moneda}".`)
      const d = await resp.json()
      if (d.result !== 'success') return r(`❌ Moneda "${moneda}" no reconocida. Usa el código ISO, ej: USD, EUR, COP.`)
      const f = (v, n, c) => `ꕤ 1 ${moneda} ➜ *${v ? v.toFixed(n) + ' ' + c : 'N/A'}*`
      return r(caja(`💱 *COTIZACIÓN: ${moneda}*`, [f(d.rates.COP, 2, 'COP'), f(d.rates.USD, 4, 'USD'), f(d.rates.EUR, 4, 'EUR')].join('\n')))
    }, '❌ Ocurrió un error al consultar la cotización.')
  }

  if (cmd === 'ip') {
    const dominio = args.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!dominio) return uso('[dominio]', 'Ej: !ip google.com')
    return intentar(async () => {
      const x = await dns.lookup(dominio)
      return r(caja('🌐 *DNS*', `ꕤ Dominio: *${dominio}*\nꕤ IP: *${x.address}*\nꕤ Familia: *IPv${x.family}*`))
    }, `❌ No se pudo resolver el dominio "${dominio}".`)
  }

  if (cmd === 'acortar') {
    if (!/^https?:\/\//.test(args)) return uso('[url]', 'Ej: !acortar https://www.ejemplo.com/pagina-larga')
    return intentar(async () => {
      const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(args)}`)
      if (!resp.ok) return r('❌ No se pudo acortar el enlace.')
      return r(caja('🔗 *ENLACE ACORTADO*', `ꕤ Original: ${args}\nꕤ Corto: *${await resp.text()}*`))
    }, '❌ Ocurrió un error al acortar el enlace.')
  }

  if (cmd === 'qr') {
    if (!args) return uso('[texto]', 'Ej: !qr https://www.ejemplo.com')
    return intentar(() => sock.sendMessage(jid, {
      image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(args)}` },
      caption: `📷 *Código QR generado*\n\nContenido: ${args}`
    }), '❌ Ocurrió un error al generar el código QR.')
  }

  if (cmd === 'fuentes') {
    const filas = FUENTES.map(f => {
      let vista
      try { vista = f.fn('Hola') } catch (e) { vista = '(error de vista previa)' }
      return `ꕤ *${f.id}.* ${f.nombre} → ${vista}`
    }).join('\n')
    return r(`${cabecera()}\n\n${seccion('🔤 *FUENTES DISPONIBLES*', filas)}\n\n💡 Usa: *!seleccionar [número] [texto]*\nEj: !seleccionar 22 hola mundo`)
  }

  if (cmd === 'seleccionar') {
    const n = args.indexOf(' ')
    if (n === -1 || isNaN(args.slice(0, n))) return r('❌ Formato incorrecto. Usa: !seleccionar [número] [texto]\nEj: !seleccionar 22 hola mundo\n\nUsa *!fuentes* para ver la lista.')
    const num = parseInt(args.slice(0, n))
    const original = args.slice(n + 1).trim()
    if (!original) return r('❌ Debes escribir un texto a convertir.\nEj: !seleccionar 22 hola mundo')
    const fuente = FUENTES.find(f => f.id === num)
    if (!fuente) return r(`❌ La fuente número *${num}* no existe.\n\nUsa *!fuentes* para ver las disponibles (1 al ${FUENTES.length}).`)
    let convertido
    try { convertido = fuente.fn(original) } catch (e) { convertido = original }
    return r(caja(`🔤 *FUENTE #${num}*`, `ꕤ Estilo: *${fuente.nombre}*\nꕤ Original: ${original}\nꕤ Resultado:\n${convertido}`))
  }

  const ia = IA[cmd]
  if (ia) {
    let titulo = ia.t, prompt = ia.p + args
    if (ia.pre) {
      const x = args ? ia.pre(args) : null
      if (!x) return uso(ia.u, ia.e)
      titulo = x.t; prompt = x.p
    } else if (!args) return uso(ia.u, ia.e)
    else if (ia.a) titulo += `: ${args.toUpperCase()}`

    const res = await consultarGroq(ia.s, prompt, ia.k)
    if (!res.ok) return r(res.mensaje)
    return r(caja(`${ia.i} *${titulo}*`, limitarTexto(res.texto, ia.m || 3500)))
  }
}

// ── Conexión ──
async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState('sesion')
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false
  })
  sockActual = sock

  if (!state.creds.registered && !yaSolicitoCodigo) {
    yaSolicitoCodigo = true
    await new Promise(r => setTimeout(r, 3000))
    if (!numeroGuardado) {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
      numeroGuardado = await new Promise(res => rl.question('📱 Escribe tu numero con codigo de pais (ej 573001234567): ', x => { rl.close(); res(x) }))
    }
    const numero = numeroGuardado.trim().replace(/[^0-9]/g, '')
    try {
      const code = await sock.requestPairingCode(numero)
      console.log(`\n🔑 TU CODIGO ES: ${code.match(/.{1,4}/g).join('-')}\n`)
      console.log('⚠️ Ingrésalo en: WhatsApp → Dispositivos vinculados → Vincular dispositivo → Vincular con número de teléfono\n')
    } catch (e) {
      console.log('❌ No se pudo generar el código de vinculación.')
      console.log('Si usas el mismo número que tiene WhatsApp activo en este celular, prueba con otro número o vincula desde otro dispositivo.')
      console.log('Detalle del error:', e.message)
    }
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('✅ Bot conectado!')
      yaSolicitoCodigo = false
      restaurarRecordatorios()
    }
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
        console.log('🔒 Se cerró la sesión desde WhatsApp. Borrando sesión; enciende el bot otra vez para vincular de nuevo.')
        fs.rmSync('sesion', { recursive: true, force: true })
        process.exit(0)
      }
      console.log(`Conexión cerrada (${lastDisconnect?.error?.message || 'desconocido'}). Reconectando...`)
      setTimeout(iniciar, 5000)
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const msg = messages[0]
    if (!msg || !msg.message) return
    const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '').trim()
    const jid = msg.key.remoteJid
    console.log(`[MSG] type=${type} texto="${texto}" de=${jid}`)

    if (jid.endsWith('@g.us')) {
      console.log(`📍 Mensaje de un grupo. JID: ${jid}`)
      if (jid !== GRUPO_PERMITIDO) return
    }
    if (!texto.startsWith('!')) return

    await reaccionar(sock, msg, '⏳')
    try {
      await comando(sock, msg, texto, jid)
    } catch (e) {
      console.log('Error en comando:', e.message)
      try { await enviar(sock, jid, '❌ Ocurrió un error inesperado.') } catch (_) {}
    }
    await reaccionar(sock, msg, '✅')
  })
}

process.on('uncaughtException', err => console.error('Error no controlado:', err))
process.on('unhandledRejection', err => console.error('Promesa rechazada:', err))

iniciar()
