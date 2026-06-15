<template>
  <div class="analyzer">

    <!-- Editor de código -->
    <section class="panel editor-panel">
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
        ></textarea>
      </div>

      <div class="editor-actions">
        <button class="btn btn-primary" @click="analyze" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          {{ loading ? 'Analizando…' : '▶  Analizar' }}
        </button>
        <button class="btn btn-ghost" @click="loadExample">Cargar ejemplo</button>
      </div>
    </section>

    <!-- Resultados -->
    <div v-if="resultsReady" class="results-grid">

      <section class="panel">
        <div class="panel-header">
          <span class="panel-label">Tokens léxicos</span>
          <span class="badge">{{ tokens.length }}</span>
        </div>
        <div class="table-wrap">
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

      <section class="panel">
        <div class="panel-header">
          <span class="panel-label">Análisis sintáctico</span>
          <span class="status-chip" :class="syntaxResult?.success ? 'ok' : 'err'">
            {{ syntaxResult?.success ? '✓ Correcto' : '✗ Con errores' }}
          </span>
        </div>

        <div v-if="syntaxResult?.errors?.length" class="error-list">
          <p class="error-heading">Errores encontrados</p>
          <ul>
            <li v-for="(error, i) in syntaxResult.errors" :key="i">{{ error }}</li>
          </ul>
        </div>

        <div class="ast-block">
          <p class="ast-label">AST generado</p>
          <pre class="ast-pre">{{ formattedAst }}</pre>
        </div>
      </section>

    </div>

    <div v-if="!resultsReady && !loading" class="empty-state">
      <p>Escribe código Python y presiona <strong>Analizar</strong> para ver los resultados.</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'

type Token = { type: string; lexeme: string; line?: number; column?: number }
type SyntaxResult = { success: boolean; ast?: unknown; errors: string[] }

const code = ref(`def saludo(nombre):\n    print(f"Hola {nombre}")\n\nif __name__ == '__main__':\n    saludo('Mundo')\n`)
const tokens = ref<Token[]>([])
const syntaxResult = ref<SyntaxResult | null>(null)
const loading = ref(false)
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
  try {
    const lexRes = await fetch('http://localhost:3000/lexer/lex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value })
    })
    const lexJson = await lexRes.json()
    if (lexJson.error) { alert(lexJson.error); return }
    if (Array.isArray(lexJson.tokens)) {
      tokens.value = lexJson.tokens.map((t: any) => ({
        type: t.type || 'UNKNOWN', lexeme: t.lexeme || '', line: t.line, column: t.column
      }))
    }
    const synRes = await fetch('http://localhost:3000/syntax/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value })
    })
    const synJson = await synRes.json()
    if (synJson.error) { alert(synJson.error); return }
    syntaxResult.value = {
      success: Boolean(synJson.success),
      ast: synJson.ast,
      errors: Array.isArray(synJson.errors) ? synJson.errors : []
    }
    resultsReady.value = true
  } catch {
    alert('Error al conectar con el backend')
  } finally {
    loading.value = false
  }
}

function loadExample() {
  code.value = `def saludo(nombre):\n    print(f"Hola {nombre}")\n\nif __name__ == '__main__':\n    saludo('Mundo')\n`
}
</script>

<style scoped>
.analyzer { display: flex; flex-direction: column; gap: 20px; }

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
}

.panel-label { flex: 1; }
.panel-dot { width: 10px; height: 10px; border-radius: 50%; }
.panel-dot.red    { background: #ff5f56; }
.panel-dot.yellow { background: #ffbd2e; }
.panel-dot.green  { background: #27c93f; }

/* ── Editor con números de línea ── */
.editor-wrap {
  display: flex;
  background: #0d1117;
  overflow: hidden;
  /* altura fija para que el scroll funcione bien */
  height: 280px;
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
  overflow: hidden;           /* oculta su propio scrollbar */
  min-width: 44px;
  flex-shrink: 0;
}

.line-numbers span {
  display: block;
  line-height: 1.65;          /* debe coincidir con el textarea */
}

.code-editor {
  flex: 1;
  background: #0d1117;
  color: #e6edf3;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 13.5px;
  line-height: 1.65;          /* igual que .line-numbers span */
  border: none;
  outline: none;
  padding: 16px 18px;
  resize: none;               /* desactivar resize para mantener altura fija */
  overflow-y: auto;
  width: 100%;
  height: 100%;
  tab-size: 4;
}

.editor-actions {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
}

/* Botones */
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

.spinner {
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Resultados */
.results-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
@media (max-width: 700px) { .results-grid { grid-template-columns: 1fr; } }

.table-wrap { overflow-x: auto; }

.token-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.token-table th {
  background: #1c2128; color: #8b949e; font-weight: 500;
  padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d;
}
.token-table td {
  padding: 6px 12px; border-bottom: 1px solid #21262d;
  color: #e6edf3; vertical-align: middle;
}
.token-table tr:last-child td { border-bottom: none; }
.token-table tr:hover td { background: #1c2128; }

.mono { font-family: 'Courier New', monospace; font-size: 12px; }
.center { text-align: center; color: #8b949e; }

.type-chip {
  display: inline-block; padding: 2px 7px; border-radius: 4px;
  font-size: 11px; font-family: 'Courier New', monospace; font-weight: 600;
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

.error-list { padding: 12px 16px; border-bottom: 1px solid #30363d; }
.error-heading {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: #f85149; margin-bottom: 8px; font-weight: 600;
}
.error-list ul { padding-left: 16px; }
.error-list li { font-size: 12.5px; color: #ffa198; margin-bottom: 4px; }

.ast-block { padding: 14px 16px; }
.ast-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: #8b949e; margin-bottom: 8px; font-weight: 600;
}
.ast-pre {
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  padding: 12px; font-family: 'Courier New', monospace; font-size: 11.5px;
  color: #79c0ff; white-space: pre-wrap; word-break: break-all;
  max-height: 320px; overflow-y: auto;
}

.empty-state {
  text-align: center; padding: 40px 20px; color: #8b949e;
  font-size: 14px; border: 1px dashed #30363d; border-radius: 10px;
}
.empty-state strong { color: #58a6ff; }
</style>