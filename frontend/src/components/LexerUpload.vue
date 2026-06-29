<template>
  <div class="analyzer">

    <div class="main-grid">

      <!-- ── Columna izquierda: Léxico ── -->
      <section class="panel col-panel">
        <div class="panel-header">
          <span class="panel-label">Tokens léxicos</span>
          <span v-if="resultsReady" class="badge">{{ tokens.length }}</span>
        </div>
        <div v-if="!resultsReady" class="col-empty">Sin análisis</div>
        <div v-else class="col-scroll">
          <table class="token-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Lexema</th>
                <th>Línea</th>
                <th>Col</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in tokens" :key="i">
                <td><span class="type-chip" :class="chipClass(t.type)">{{ t.type }}</span></td>
                <td class="mono">{{ t.lexeme }}</td>
                <td class="center">{{ t.line ?? '—' }}</td>
                <td class="center">{{ t.column ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── Columna central: Editor + Semántico ── -->
      <div class="center-col">

        <!-- Editor -->
        <section class="panel">
          <div class="panel-header">
            <span class="panel-dot red"></span>
            <span class="panel-dot yellow"></span>
            <span class="panel-dot green"></span>
            <span class="panel-label">código fuente · Python</span>
          </div>
          <div class="editor-wrap">
            <div class="line-numbers" ref="lineNumbersRef">
              <span v-for="n in lineCount" :key="n">{{ n }}</span>
            </div>
            <textarea
              v-model="code"
              ref="textareaRef"
              class="code-editor"
              spellcheck="false"
              placeholder="# Escribe o pega tu código Python aquí..."
              @scroll="syncScroll"
              @input="syncScroll"
              @keydown.tab.prevent="insertTab"
            ></textarea>
          </div>
          <div class="editor-actions">
            <button class="btn btn-primary" @click="analyze" :disabled="loading">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? 'Analizando…' : '▶  Analizar' }}
            </button>
            <button class="btn btn-translate" @click="translate" :disabled="translating">
              <span v-if="translating" class="spinner"></span>
              {{ translating ? 'Traduciendo…' : '⇄  Python → C++' }}
            </button>
            <button class="btn btn-ghost" @click="loadExample">Cargar ejemplo</button>
          </div>
        </section>

        <!-- Traductor Python → C++ -->
        <section v-if="translatorResult !== null" class="panel trans-panel">
          <div class="panel-header">
            <span class="panel-label">Traducción · Python → C++</span>
            <span class="status-chip" :class="translatorResult.success ? 'ok' : 'err'">
              {{ translatorResult.success ? '✓ Generado' : '✗ Error' }}
            </span>
            <button class="btn-copy" @click="copyCpp" :title="copied ? 'Copiado!' : 'Copiar código'">
              {{ copied ? '✓' : '⎘' }}
            </button>
          </div>
          <div v-if="!translatorResult.success" class="trans-error">
            {{ translatorResult.error }}
          </div>
          <pre v-else class="cpp-pre">{{ translatorResult.code }}</pre>
        </section>

        <!-- Semántico -->
        <section class="panel sem-panel">
          <div class="panel-header">
            <span class="panel-label">Análisis semántico</span>
            <span v-if="resultsReady" class="status-chip" :class="semanticResult?.success ? 'ok' : 'err'">
              {{ semanticResult?.success ? '✓ Correcto' : '✗ Con errores' }}
            </span>
          </div>

          <div v-if="!resultsReady" class="col-empty">Sin análisis</div>

          <div v-else class="semantic-body">
            <div class="diag-columns">
              <div v-if="semanticResult?.errors?.length" class="diag-block">
                <p class="diag-heading err-color">Errores semánticos</p>
                <ul class="diag-list">
                  <li v-for="(e, i) in semanticResult.errors" :key="i" class="diag-err">
                    <span v-if="e.line" class="diag-loc">L{{ e.line }}</span>{{ e.message }}
                  </li>
                </ul>
              </div>
              <div v-if="semanticResult?.warnings?.length" class="diag-block">
                <p class="diag-heading warn-color">Advertencias</p>
                <ul class="diag-list">
                  <li v-for="(w, i) in semanticResult.warnings" :key="i" class="diag-warn">
                    <span v-if="w.line" class="diag-loc">L{{ w.line }}</span>{{ w.message }}
                  </li>
                </ul>
              </div>
              <div v-if="!semanticResult?.errors?.length && !semanticResult?.warnings?.length" class="diag-ok">
                Sin errores ni advertencias semánticas.
              </div>
            </div>

            <div v-if="semanticResult?.symbolTable?.length" class="sym-block">
              <p class="ast-label">Tabla de símbolos</p>
              <div class="table-wrap">
                <table class="token-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Tipo de símbolo</th>
                      <th>Ámbito</th>
                      <th>Tipo inferido</th>
                      <th>Usos</th>
                      <th>Línea</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(sym, i) in semanticResult.symbolTable" :key="i">
                      <td class="mono">{{ sym.name }}</td>
                      <td><span class="type-chip" :class="kindChip(sym.kind)">{{ sym.kind }}</span></td>
                      <td class="mono">{{ sym.scope }}</td>
                      <td><span class="type-chip chip-lit">{{ sym.inferredType }}</span></td>
                      <td class="center">{{ sym.usages }}</td>
                      <td class="center">{{ sym.line ?? '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

      </div>

      <!-- ── Columna derecha: Sintáctico ── -->
      <section class="panel col-panel">
        <div class="panel-header">
          <span class="panel-label">Análisis sintáctico</span>
          <span v-if="resultsReady" class="status-chip" :class="syntaxResult?.success ? 'ok' : 'err'">
            {{ syntaxResult?.success ? '✓' : '✗' }}
          </span>
        </div>

        <div v-if="!resultsReady" class="col-empty">Sin análisis</div>

        <div v-else class="col-scroll">
          <div v-if="syntaxResult?.errors?.length" class="error-list">
            <p class="error-heading">Errores encontrados</p>
            <ul>
              <li v-for="(error, i) in syntaxResult.errors" :key="i">{{ error }}</li>
            </ul>
          </div>
          <div v-else class="side-ok">Sin errores sintácticos.</div>

          <div class="ast-block">
            <p class="ast-label">AST generado</p>
            <pre class="ast-pre">{{ formattedAst }}</pre>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'

type Token = { type: string; lexeme: string; line?: number; column?: number }
type SyntaxResult = { success: boolean; ast?: unknown; errors: string[] }
type SemanticDiag = { message: string; line?: number; column?: number }
type SymbolInfo = { name: string; kind: string; scope: string; inferredType: string; line?: number; usages: number }
type SemanticResult = { success: boolean; errors: SemanticDiag[]; warnings: SemanticDiag[]; symbolTable: SymbolInfo[] }
type TranslatorResult = { success: boolean; code: string; error?: string }

const code = ref(`def saludo(nombre):\n    print(f"Hola {nombre}")\n\nif __name__ == '__main__':\n    saludo('Mundo')\n`)
const tokens = ref<Token[]>([])
const syntaxResult = ref<SyntaxResult | null>(null)
const semanticResult = ref<SemanticResult | null>(null)
const translatorResult = ref<TranslatorResult | null>(null)
const loading = ref(false)
const translating = ref(false)
const copied = ref(false)
const resultsReady = ref(false)

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const lineNumbersRef = ref<HTMLDivElement | null>(null)

const lineCount = computed(() => code.value.split('\n').length)

const formattedAst = computed(() =>
  syntaxResult.value?.ast ? JSON.stringify(syntaxResult.value.ast, null, 2) : 'Sin AST'
)

function syncScroll() {
  if (textareaRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = textareaRef.value.scrollTop
  }
}

// Re-sync after Vue updates the DOM (line count change)
watch(lineCount, () => nextTick(syncScroll))

const KEYWORD_TYPES = ['DEF', 'IF', 'ELSE', 'WHILE', 'FOR', 'RETURN', 'IMPORT', 'CLASS', 'KEYWORD']
const LITERAL_TYPES = ['STRING', 'NUMBER', 'INT', 'FLOAT', 'BOOL']
const OP_TYPES = ['OP', 'OPERATOR', 'ASSIGN', 'COMPARE', 'PLUS', 'MINUS', 'STAR', 'SLASH']

function chipClass(type: string) {
  const t = type.toUpperCase()
  if (KEYWORD_TYPES.some(k => t.includes(k))) return 'chip-kw'
  if (LITERAL_TYPES.some(k => t.includes(k))) return 'chip-lit'
  if (OP_TYPES.some(k => t.includes(k))) return 'chip-op'
  if (t.includes('ID') || t.includes('NAME')) return 'chip-id'
  return 'chip-default'
}

async function analyze() {
  loading.value = true
  resultsReady.value = false
  tokens.value = []
  syntaxResult.value = null
  semanticResult.value = null
  try {
    const [lexRes, synRes, semRes] = await Promise.all([
      fetch('http://localhost:3000/lexer/lex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.value })
      }),
      fetch('http://localhost:3000/syntax/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.value })
      }),
      fetch('http://localhost:3000/semantic/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.value })
      }),
    ])

    const lexJson = await lexRes.json()
    if (lexJson.error) { alert(lexJson.error); return }
    if (Array.isArray(lexJson.tokens)) {
      tokens.value = lexJson.tokens.map((t: any) => ({
        type: t.type || 'UNKNOWN', lexeme: t.lexeme || '', line: t.line, column: t.column
      }))
    }

    const synJson = await synRes.json()
    if (synJson.error) { alert(synJson.error); return }
    syntaxResult.value = {
      success: Boolean(synJson.success),
      ast: synJson.ast,
      errors: Array.isArray(synJson.errors) ? synJson.errors : []
    }

    const semJson = await semRes.json()
    semanticResult.value = {
      success: Boolean(semJson.success),
      errors: Array.isArray(semJson.errors) ? semJson.errors : [],
      warnings: Array.isArray(semJson.warnings) ? semJson.warnings : [],
      symbolTable: Array.isArray(semJson.symbolTable) ? semJson.symbolTable : [],
    }

    resultsReady.value = true
  } catch {
    alert('Error al conectar con el backend')
  } finally {
    loading.value = false
  }
}

function kindChip(kind: string) {
  if (kind === 'function') return 'chip-kw'
  if (kind === 'parameter') return 'chip-op'
  return 'chip-id'
}

function loadExample() {
  code.value = `def saludo(nombre):\n    print(f"Hola {nombre}")\n\nif __name__ == '__main__':\n    saludo('Mundo')\n`
}

async function translate() {
  translating.value = true
  translatorResult.value = null
  try {
    const res = await fetch('http://localhost:3000/translator/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value })
    })
    translatorResult.value = await res.json()
  } catch {
    translatorResult.value = { success: false, code: '', error: 'Error al conectar con el backend' }
  } finally {
    translating.value = false
  }
}

async function copyCpp() {
  if (!translatorResult.value?.code) return
  await navigator.clipboard.writeText(translatorResult.value.code)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function insertTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const start = el.selectionStart
  const end = el.selectionEnd
  code.value = code.value.substring(0, start) + '    ' + code.value.substring(end)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + 4
  })
}
</script>

<style scoped>
/* ══════════════════════════════════════
   LAYOUT PRINCIPAL
   izquierda(léxico) | centro(editor+sem) | derecha(sintáctico)
   ══════════════════════════════════════ */
.analyzer { display: flex; flex-direction: column; }

.main-grid {
  display: grid;
  grid-template-columns: 1fr 1.6fr 1fr;
  gap: 14px;
  /* altura total de la pantalla menos el header (~80px) */
  height: calc(100vh - 100px);
  min-height: 600px;
}

/* Columna central: editor arriba, semántico abajo */
.center-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

/* Paneles laterales ocupan toda la altura */
.col-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

/* Área scrollable dentro de los laterales */
.col-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* Placeholder cuando no hay análisis */
.col-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3d444d;
  font-size: 12px;
  font-family: 'Courier New', monospace;
}

/* ── Panel base ── */
.panel {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 10px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #1c2128;
  border-bottom: 1px solid #30363d;
  font-size: 12px;
  color: #8b949e;
  font-family: 'Courier New', monospace;
  flex-shrink: 0;
}
.panel-label { flex: 1; }
.panel-dot { width: 10px; height: 10px; border-radius: 50%; }
.panel-dot.red    { background: #ff5f56; }
.panel-dot.yellow { background: #ffbd2e; }
.panel-dot.green  { background: #27c93f; }

/* ── Editor ── */
.editor-wrap {
  display: flex;
  background: #0d1117;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.line-numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 16px 10px 16px 12px;
  background: #0d1117;
  border-right: 1px solid #21262d;
  color: #3d444d;
  font-family: 'Courier New', monospace;
  font-size: 13.5px;
  line-height: 1.65;
  user-select: none;
  overflow: hidden;
  min-width: 44px;
  flex-shrink: 0;
}
.line-numbers span { display: block; line-height: 1.65; }

.code-editor {
  flex: 1;
  background: #0d1117;
  color: #e6edf3;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 13.5px;
  line-height: 1.65;
  border: none;
  outline: none;
  padding: 16px 18px;
  resize: none;
  overflow-y: auto;
  width: 100%;
  height: 100%;
  tab-size: 4;
}

/* El panel del editor se expande para llenar el espacio disponible */
.center-col > .panel:first-child {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-actions {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
  flex-shrink: 0;
}

/* ── Botones ── */
.btn {
  padding: 7px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, opacity 0.15s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #238636; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #2ea043; }
.btn-ghost { background: transparent; color: #8b949e; border: 1px solid #30363d; }
.btn-ghost:hover { background: #21262d; color: #e6edf3; }
.btn-translate { background: #1a3a5c; color: #79c0ff; border: 1px solid #2d5986; }
.btn-translate:hover:not(:disabled) { background: #1f4a73; }

.spinner {
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Traductor ── */
.trans-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 0 0 auto;
}

.cpp-pre {
  flex: 1;
  margin: 0;
  padding: 14px 16px;
  background: #0d1117;
  color: #ffa657;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  overflow: auto;
  max-height: 280px;
}

.trans-error {
  padding: 12px 16px;
  color: #ffa198;
  background: #3d1a1a;
  font-size: 12.5px;
}

.btn-copy {
  background: #21262d;
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 5px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: background 0.15s;
}
.btn-copy:hover { background: #30363d; color: #e6edf3; }

/* ── Semántico ── */
.sem-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* altura fija razonable — se puede ajustar */
  flex: 0 0 280px;
}

.semantic-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.diag-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.diag-block { display: flex; flex-direction: column; gap: 5px; }

.diag-heading {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  font-weight: 600; margin: 0;
}
.err-color  { color: #f85149; }
.warn-color { color: #e3b341; }

.diag-list { padding-left: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }

.diag-err, .diag-warn {
  font-size: 12px; padding: 4px 8px; border-radius: 5px;
  display: flex; align-items: baseline; gap: 6px;
}
.diag-err  { background: #3d1a1a; color: #ffa198; }
.diag-warn { background: #3d2b00; color: #e3b341; }

.diag-loc {
  font-family: 'Courier New', monospace; font-size: 10px;
  background: rgba(255,255,255,0.08); padding: 1px 4px;
  border-radius: 3px; flex-shrink: 0;
}

.diag-ok { color: #56d364; font-size: 12.5px; }

.sym-block { display: flex; flex-direction: column; gap: 6px; }

/* ── Tabla genérica ── */
.table-wrap { overflow-x: auto; }

.token-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.token-table th {
  background: #1c2128; color: #8b949e; font-weight: 500;
  padding: 7px 10px; text-align: left; border-bottom: 1px solid #30363d;
  position: sticky; top: 0; z-index: 1;
}
.token-table td {
  padding: 5px 10px; border-bottom: 1px solid #21262d;
  color: #e6edf3; vertical-align: middle;
}
.token-table tr:last-child td { border-bottom: none; }
.token-table tr:hover td { background: #1c2128; }

.mono   { font-family: 'Courier New', monospace; font-size: 11.5px; }
.center { text-align: center; color: #8b949e; }

/* ── Chips ── */
.type-chip {
  display: inline-block; padding: 2px 6px; border-radius: 4px;
  font-size: 10.5px; font-family: 'Courier New', monospace; font-weight: 600;
}
.chip-kw      { background: #1f3a5f; color: #79c0ff; }
.chip-lit     { background: #3d2b00; color: #e3b341; }
.chip-op      { background: #2d1f3d; color: #d2a8ff; }
.chip-id      { background: #1a3a2a; color: #56d364; }
.chip-default { background: #21262d; color: #8b949e; }

.badge {
  background: #21262d; color: #8b949e;
  padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-family: 'Courier New', monospace;
}

.status-chip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.status-chip.ok  { background: #1a3a2a; color: #56d364; }
.status-chip.err { background: #3d1a1a; color: #f85149; }

/* ── Sintáctico ── */
.error-list { padding: 10px 14px; border-bottom: 1px solid #30363d; }
.error-heading {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: #f85149; margin-bottom: 6px; font-weight: 600;
}
.error-list ul { padding-left: 14px; }
.error-list li { font-size: 12px; color: #ffa198; margin-bottom: 3px; }

.side-ok { padding: 10px 14px; color: #56d364; font-size: 12.5px; border-bottom: 1px solid #30363d; }

.ast-block { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.ast-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: #8b949e; font-weight: 600;
}
.ast-pre {
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  padding: 10px; font-family: 'Courier New', monospace; font-size: 11px;
  color: #79c0ff; white-space: pre-wrap; word-break: break-all;
  overflow-y: auto;
}
</style>