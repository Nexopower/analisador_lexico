<template>
  <div class="analyzer">

    <!-- ══════ BARRA SUPERIOR: acciones + estado ══════ -->
    <section class="panel toolbar-panel">
      <button class="btn btn-primary" @click="analyzeAll" :disabled="loading">
        <span v-if="loading" class="spinner"></span>
        {{ loading ? 'Analizando…' : '▶  Analizar todo' }}
      </button>
      <select v-model="selectedExample" class="example-select">
        <option value="real">Ejemplo 1</option>
        <option value="librerias">Ejemplo 2 (con librerias)</option>
        <option value="optimizable">Para optimizar</option>
        <option value="errores_lexicos">Errores léxicos</option>
        <option value="errores_sintacticos">Errores sintácticos</option>
        <option value="errores_semanticos">Errores semánticos</option>
      </select>
      <button class="btn btn-ghost" @click="loadExample">Cargar</button>

      <div class="phase-chips">
        <button
          v-for="ph in phases" :key="ph.key"
          class="phase-chip"
          :class="[`pc-${ph.status}`, activeTab === ph.key ? 'pc-active' : '']"
          :title="ph.detail"
          @click="activeTab = ph.key"
        >
          <span class="pc-icon">{{ ph.icon }}</span>{{ ph.label }}
        </button>
      </div>

      <span v-if="resultsReady" class="all-ok-chip" :class="allOk ? 'aok-ok' : 'aok-err'">
        {{ allOk ? '✓ Todo correcto' : '✗ Hay errores' }}
      </span>
    </section>

    <!-- ══════ TABS (pantalla completa) ══════ -->
    <section class="panel tabs-section">

      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ 'tab-active': activeTab === 'editor' }"
          @click="activeTab = 'editor'"
        >
          ✎ Editor
          <span class="tab-badge badge-neutral">{{ lineCount }}</span>
        </button>
        <button
          v-for="ph in phases" :key="ph.key"
          class="tab-btn"
          :class="{ 'tab-active': activeTab === ph.key, 'tab-has-err': ph.status === 'err' }"
          @click="activeTab = ph.key"
        >
          {{ ph.label }}
          <span v-if="resultsReady && ph.badge !== null" class="tab-badge" :class="ph.badgeClass">{{ ph.badge }}</span>
        </button>
      </div>

      <div class="tab-content">

        <!-- ── Editor ── -->
        <div v-show="activeTab === 'editor'" class="tab-pane editor-pane">
        <div class="editor-wrap">
          <div class="line-numbers" ref="lineNumbersRef">
            <span
              v-for="n in lineCount" :key="n"
              :class="lineMarkClass(n) === 'bd-err' ? 'ln-err' : lineMarkClass(n) === 'bd-warn' ? 'ln-warn' : ''"
            >{{ n }}</span>
          </div>
          <div class="editor-area">
            <div class="editor-backdrop" ref="backdropRef">
              <div v-for="n in lineCount" :key="n" class="bd-line" :class="lineMarkClass(n)"></div>
            </div>
            <textarea
              v-model="code"
              ref="textareaRef"
              class="code-editor"
              spellcheck="false"
              wrap="off"
              placeholder="# Escribe o pega tu código Python aquí..."
              @scroll="syncScroll"
              @input="syncScroll"
              @keydown.tab.prevent="insertTab"
              @mousemove="onEditorMouseMove"
              @mouseleave="hideTooltip"
            ></textarea>
          </div>
          <div
            v-if="tooltip.visible"
            class="err-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
          >
            <div v-for="(er, i) in tooltip.errors" :key="i" class="tt-item">
              <span class="tt-chip" :class="`tt-${er.sev}`">{{ er.label }}</span>
              <span class="tt-msg">{{ er.message }}</span>
            </div>
          </div>
        </div>
        </div>

        <!-- ── Léxico ── -->
        <div v-show="activeTab === 'lexico'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <template v-else>
            <div v-if="unknownTokens.length" class="warn-bar">
              ⚠ {{ unknownTokens.length }} token(s) no reconocido(s):
              <span class="mono">{{ unknownTokens.map(t => `'${t.lexeme}'`).join(', ') }}</span>
            </div>
            <div class="tab-scroll">
              <table class="data-table">
                <thead><tr><th>Tipo</th><th>Lexema</th><th>Línea</th><th>Col</th></tr></thead>
                <tbody>
                  <tr v-for="(t, i) in tokens" :key="i" :class="{ 'row-err': t.type === 'UNKNOWN' }">
                    <td><span class="type-chip" :class="chipClass(t.type)">{{ t.type }}</span></td>
                    <td class="mono">{{ t.lexeme }}</td>
                    <td class="center">{{ t.line ?? '—' }}</td>
                    <td class="center">{{ t.column ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>

        <!-- ── Sintáctico ── -->
        <div v-show="activeTab === 'sintactico'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <template v-else>
            <div v-if="syntaxResult?.errors?.length" class="err-block">
              <p class="block-title err-color">Errores sintácticos</p>
              <ul class="plain-list">
                <li v-for="(e, i) in syntaxResult.errors" :key="i" class="err-line">{{ e }}</li>
              </ul>
            </div>
            <div v-else class="ok-bar">✓ Sin errores sintácticos</div>
            <div class="tab-scroll">
              <div class="ast-block">
                <p class="section-label">AST generado</p>
                <pre class="ast-pre">{{ formattedAst }}</pre>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Semántico ── -->
        <div v-show="activeTab === 'semantico'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <template v-else>
            <div v-if="!semanticResult?.errors?.length && !semanticResult?.warnings?.length" class="ok-bar">
              ✓ Sin errores ni advertencias semánticas
            </div>
            <div v-else class="diag-blocks">
              <div v-if="semanticResult?.errors?.length" class="diag-block">
                <p class="block-title err-color">Errores semánticos</p>
                <ul class="diag-list">
                  <li v-for="(e, i) in semanticResult.errors" :key="i" class="diag-err">
                    <span v-if="e.line" class="loc-chip">L{{ e.line }}</span>{{ e.message }}
                  </li>
                </ul>
              </div>
              <div v-if="semanticResult?.warnings?.length" class="diag-block">
                <p class="block-title warn-color">Advertencias</p>
                <ul class="diag-list">
                  <li v-for="(w, i) in semanticResult.warnings" :key="i" class="diag-warn">
                    <span v-if="w.line" class="loc-chip">L{{ w.line }}</span>{{ w.message }}
                  </li>
                </ul>
              </div>
            </div>
            <div v-if="semanticResult?.symbolTable?.length" class="tab-scroll sym-section">
              <p class="section-label">Tabla de símbolos</p>
              <table class="data-table">
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Ámbito</th><th>Tipo inferido</th><th>Usos</th><th>Línea</th></tr></thead>
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
          </template>
        </div>

        <!-- ── C++ Directo ── -->
        <div v-show="activeTab === 'traductor'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <div v-else-if="!translatorResult?.success" class="err-block">
            <p class="block-title err-color">Error en la traducción</p>
            <p class="err-msg">{{ translatorResult?.error }}</p>
          </div>
          <template v-else>
            <div class="cpp-toolbar">
              <span class="cpp-info">{{ (translatorResult?.code ?? '').split('\n').length }} líneas generadas</span>
              <button class="btn-copy" @click="copyDirectCpp">{{ copiedDirect ? '✓ Copiado' : '⎘ Copiar C++' }}</button>
            </div>
            <div class="tab-scroll cpp-scroll">
              <div class="code-numbered code-direct">
                <div v-for="(l, i) in directLines" :key="i" class="cl">
                  <span class="cl-num">{{ i + 1 }}</span><span class="cl-text">{{ l }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── C++ Optimizado ── -->
        <div v-show="activeTab === 'optimizador'" class="tab-pane opt-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <div v-else-if="!optimizerResult?.success" class="err-block">
            <p class="block-title err-color">Error en el optimizador</p>
            <p class="err-msg">{{ optimizerResult?.error }}</p>
          </div>
          <template v-else>
            <div class="opt-summary">
              <span class="opt-stat"><strong>{{ optimizerResult.totalChanges }}</strong> optimización(es)</span>
              <span class="opt-dot">·</span>
              <span class="opt-stat"><strong>{{ optimizerResult.passesRun }}</strong> pasada(s)</span>
              <button class="btn-copy ml-auto" @click="copyOptCpp">{{ copiedOpt ? '✓ Copiado' : '⎘ Copiar C++' }}</button>
            </div>
            <div class="opt-split">
              <div class="opt-report">
                <p class="section-label">Cambios aplicados</p>
                <div v-if="!optimizerResult.changes.length" class="opt-none">
                  El código ya es óptimo.
                </div>
                <ul v-else class="opt-list">
                  <li v-for="(c, i) in optimizerResult.changes" :key="i" class="opt-item">
                    <span class="pass-chip" :class="passChip(c.pass)">{{ c.pass }}</span>
                    <span class="opt-desc">{{ c.description }}</span>
                    <span v-if="c.line" class="loc-chip">L{{ c.line }}</span>
                  </li>
                </ul>
              </div>
              <div class="opt-code">
                <p class="section-label">
                  C++ generado (optimizado)
                  <span class="line-count">{{ (optimizerResult.optimizedCpp ?? '').split('\n').length }} líneas</span>
                </p>
                <div class="cpp-pre code-numbered code-opt">
                  <div v-for="(l, i) in optLines" :key="i" class="cl">
                    <span class="cl-num">{{ i + 1 }}</span><span class="cl-text">{{ l }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Comparación ── -->
        <div v-show="activeTab === 'comparacion'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <div v-else-if="!translatorResult?.success || !optimizerResult?.success" class="err-block">
            <p class="block-title err-color">No se puede comparar</p>
            <p class="err-msg">Se necesita que la traducción directa y la optimización sean exitosas.</p>
          </div>
          <template v-else>
            <div class="diff-toolbar">
              <span class="legend-chip"><span class="legend-box lb-mod"></span> Modificada</span>
              <span class="legend-chip"><span class="legend-box lb-del"></span> Eliminada</span>
              <span class="legend-chip"><span class="legend-box lb-add"></span> Agregada</span>
              <span class="diff-stats">
                <strong class="ds-same">{{ diffStats.same }}</strong> iguales ·
                <strong class="ds-mod">{{ diffStats.mod }}</strong> modificadas ·
                <strong class="ds-del">{{ diffStats.del }}</strong> eliminadas ·
                <strong class="ds-add">{{ diffStats.add }}</strong> agregadas
              </span>
            </div>
            <div v-if="diffStats.mod + diffStats.del + diffStats.add === 0" class="ok-bar">
              ✓ El optimizador no modificó el código: ambas versiones son idénticas.
            </div>
            <div class="diff-headers">
              <span class="diff-h">C++ Directo · {{ directLines.length }} líneas</span>
              <span class="diff-h">C++ Optimizado · {{ optLines.length }} líneas</span>
            </div>
            <div class="tab-scroll diff-scroll">
              <div
                v-for="(row, idx) in diffRows" :key="idx"
                class="diff-row" :class="`dr-${row.type}`"
              >
                <span class="d-num">{{ row.ln ?? '' }}</span>
                <span class="d-code d-left">{{ row.left ?? '' }}</span>
                <span class="d-num">{{ row.rn ?? '' }}</span>
                <span class="d-code d-right">{{ row.right ?? '' }}</span>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Código Destino ── -->
        <div v-show="activeTab === 'destino'" class="tab-pane">
          <div v-if="!resultsReady" class="tab-empty">Sin análisis aún.</div>
          <div v-else-if="!codegenResult?.success" class="err-block">
            <p class="block-title err-color">Error en la generación de código destino</p>
            <p class="err-msg">{{ codegenResult?.error }}</p>
          </div>
          <template v-else>
            <div class="cpp-toolbar">
              <span class="asm-stat"><strong>{{ codegenResult.stats.instructions }}</strong> instrucciones</span>
              <span class="opt-dot">·</span>
              <span class="asm-stat"><strong>{{ codegenResult.stats.registers }}</strong> registros</span>
              <span class="opt-dot">·</span>
              <span class="asm-stat"><strong>{{ codegenResult.stats.labels }}</strong> etiquetas</span>
              <span class="opt-dot">·</span>
              <span class="asm-stat"><strong>{{ codegenResult.stats.strings }}</strong> cadenas</span>
              <span class="opt-dot">·</span>
              <span class="asm-stat"><strong>{{ codegenResult.stats.variables }}</strong> variables</span>
              <button class="btn-copy ml-auto" @click="copyAsm">{{ copiedAsm ? '✓ Copiado' : '⎘ Copiar ASM' }}</button>
            </div>
            <div class="tab-scroll cpp-scroll">
              <div class="code-numbered code-asm">
                <div v-for="(l, i) in asmLines" :key="i" class="cl">
                  <span class="cl-num">{{ i + 1 }}</span><span class="cl-text" :class="asmLineClass(l)">{{ l }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'

// ── Types ─────────────────────────────────────────────────────────────────────
type Token          = { type: string; lexeme: string; line?: number; column?: number }
type SyntaxResult   = { success: boolean; ast?: unknown; errors: string[] }
type SemanticDiag   = { message: string; line?: number; column?: number }
type SymbolInfo     = { name: string; kind: string; scope: string; inferredType: string; line?: number; usages: number }
type SemanticResult = { success: boolean; errors: SemanticDiag[]; warnings: SemanticDiag[]; symbolTable: SymbolInfo[] }
type TranslResult   = { success: boolean; code: string; error?: string }
type OptChange      = { pass: string; description: string; line?: number }
type OptResult      = { success: boolean; optimizedCpp: string; changes: OptChange[]; totalChanges: number; passesRun: number; error?: string }
type CodegenStats   = { instructions: number; registers: number; labels: number; strings: number; variables: number }
type CodegenResult  = { success: boolean; assembly: string; stats: CodegenStats; error?: string }

// ── Examples ──────────────────────────────────────────────────────────────────
const EX_REAL = `def factorial(n):
    if n == 0:
        return 1
    resultado = 1
    i = 1
    while i <= n:
        resultado = resultado * i
        i = i + 1
    return resultado

def fibonacci(n):
    if n <= 1:
        return n
    a = 0
    b = 1
    i = 2
    while i <= n:
        temp = a + b
        a = b
        b = temp
        i = i + 1
    return b

def mcd(a, b):
    while b != 0:
        temp = b
        b = a % b
        a = temp
    return a

def mcm(a, b):
    return a * b // mcd(a, b)

def es_primo(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i = i + 1
    return True

def potencia_rapida(base, exp):
    if exp == 0:
        return 1
    if exp == 1:
        return base
    mitad = potencia_rapida(base, exp // 2)
    if exp % 2 == 0:
        return mitad * mitad
    return base * mitad * mitad

i = 1
while i <= 10:
    print(str(i) + "! = " + str(factorial(i)))
    i = i + 1

i = 0
while i <= 15:
    print("F" + str(i) + " = " + str(fibonacci(i)))
    i = i + 1

n = 2
while n <= 50:
    if es_primo(n):
        print(str(n))
    n = n + 1

print("MCD(48, 18) = " + str(mcd(48, 18)))
print("MCM(12, 18) = " + str(mcm(12, 18)))
print("2^10 = " + str(potencia_rapida(2, 10)))
`

const EX_LIBS = `import math
import random
import os

def distancia(x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    return math.sqrt(dx ** 2 + dy ** 2)

def area_circulo(radio):
    return math.pi * radio ** 2

def volumen_esfera(radio):
    return (4 / 3) * math.pi * radio ** 3

def media_aleatoria(n, minimo, maximo):
    suma = 0
    i = 0
    while i < n:
        suma = suma + random.randint(minimo, maximo)
        i = i + 1
    return suma / n

def combinaciones(n, k):
    if k > n:
        return 0
    return factorial_math(n) // (factorial_math(k) * factorial_math(n - k))

def factorial_math(n):
    if n <= 1:
        return 1
    return n * factorial_math(n - 1)

radio = 7
print("pi = " + str(math.pi))
print("e = " + str(math.e))
print("sqrt(144) = " + str(math.sqrt(144)))
print("log(1000) = " + str(math.log10(1000)))
print("Area circulo r=" + str(radio) + ": " + str(area_circulo(radio)))
print("Volumen esfera r=" + str(radio) + ": " + str(volumen_esfera(radio)))
print("Distancia (0,0)-(3,4) = " + str(distancia(0, 0, 3, 4)))
print("Media 1000 muestras [1,10]: " + str(media_aleatoria(1000, 1, 10)))
print("C(10,3) = " + str(combinaciones(10, 3)))
print("Directorio: " + os.getcwd())
print("Separador: " + os.sep)
`

const EX_LEXICO = `precio = 150
descuento = 20$
tasa_impuesto = 0.16

subtotal = precio - descuento
impuesto = subtotal * tasa_impuesto
total = subtotal + impuesto

if total > 100?
    categoria = "premium"
else:
    categoria = "estandar"

codigo_producto = "PRD$001"
factor = 1 + descuento$100

print("Precio:", precio)
print("Total:", total)
print("Categoria:", categoria)
`

const EX_SINTACTICO = `def calcular_area(base, altura
    return base * altura / 2

def calcular_perimetro(a, b, c):
    return a + b + c

def calcular_hipotenusa(cateto_a, cateto_b):
    suma_cuadrados = cateto_a ** 2 + cateto_b ** 2
    return suma_cuadrados ** 0.5

area = calcular_area(10, 5
perimetro = calcular_perimetro(3, 4, 5)
hipotenusa = calcular_hipotenusa(3, 4)

if area > 20
    print("Area grande")
elif area > 10:
    print("Area mediana")
else:
    print("Area pequena")

while hipotenusa > 0:
    print("Hipotenusa:", hipotenusa
    hipotenusa = hipotenusa - 1
`

const EX_SEMANTICO = `def calcular_precio(costo, margen):
    return costo + costo * margen / 100

def calcular_precio(base, ganancia, impuesto):
    return base + ganancia + impuesto

precio_base = 200
margen = 30

precio_venta = calcular_precio(precio_base, margen, 50, "extra")

descuento_invalido = precio_base / 0

etiqueta = "Producto: "
codigo = 1042
descripcion = etiqueta + codigo

if precio_venta > precio_minimo:
    print("Precio valido")

ganancia_neta = ingresos_totales - costos_fijos - impuestos_pendientes

print(nombre_cliente)
print(calcular_precio(precio_base))
`

const EX_OPTIMIZABLE = `PI = 3.14159
E = 2.71828
GRAVEDAD = 9.8
RADIO_TIERRA = 6371

def area_circulo(radio):
    return PI * radio * radio

def area_esfera(radio):
    return 4 * PI * radio * radio

def circunferencia(radio):
    return 2 * PI * radio

def energia_potencial(masa, altura):
    return masa * GRAVEDAD * altura

def velocidad_caida(tiempo):
    return GRAVEDAD * tiempo

def distancia_caida(tiempo):
    return 0 + GRAVEDAD * tiempo * tiempo / 2

def calcular(x):
    base = x * 1
    resultado = base + 0
    factor = 1 * resultado
    return factor

suma_constante = 2 + 3
producto_constante = 10 * 4
potencia_fija = 2 ** 8
valor_puro = 100 / 1

area_fija = PI * RADIO_TIERRA * RADIO_TIERRA

if True:
    print("Sistema inicializado")

if False:
    print("esto no se ejecuta")
else:
    print("modo de produccion activo")

while False:
    print("bucle imposible")

radio = 7
print("Area circulo: " + str(area_circulo(radio)))
print("Area esfera: " + str(area_esfera(radio)))
print("Circunferencia: " + str(circunferencia(radio)))
print("Energia (masa=10, h=50): " + str(energia_potencial(10, 50)))
print("Velocidad (t=5): " + str(velocidad_caida(5)))
print("Suma constante: " + str(suma_constante))
print("2^8 = " + str(potencia_fija))
print("Area Tierra: " + str(area_fija))
`

const EXAMPLES: Record<string, string> = {
  real: EX_REAL,
  librerias: EX_LIBS,
  optimizable: EX_OPTIMIZABLE,
  errores_lexicos: EX_LEXICO,
  errores_sintacticos: EX_SINTACTICO,
  errores_semanticos: EX_SEMANTICO,
}

// ── State ─────────────────────────────────────────────────────────────────────
const code            = ref(EX_REAL)
const tokens          = ref<Token[]>([])
const syntaxResult    = ref<SyntaxResult | null>(null)
const semanticResult  = ref<SemanticResult | null>(null)
const translatorResult= ref<TranslResult | null>(null)
const optimizerResult = ref<OptResult | null>(null)
const codegenResult   = ref<CodegenResult | null>(null)
const loading         = ref(false)
const copiedDirect    = ref(false)
const copiedOpt       = ref(false)
const copiedAsm       = ref(false)
const resultsReady    = ref(false)
const selectedExample = ref('real')
const activeTab       = ref<'editor'|'lexico'|'sintactico'|'semantico'|'traductor'|'optimizador'|'comparacion'|'destino'>('editor')
const textareaRef     = ref<HTMLTextAreaElement | null>(null)
const lineNumbersRef  = ref<HTMLDivElement | null>(null)
const backdropRef     = ref<HTMLDivElement | null>(null)

// ── Computed ──────────────────────────────────────────────────────────────────
const lineCount     = computed(() => code.value.split('\n').length)
const formattedAst  = computed(() => syntaxResult.value?.ast ? JSON.stringify(syntaxResult.value.ast, null, 2) : 'Sin AST')
const unknownTokens = computed(() => tokens.value.filter(t => t.type === 'UNKNOWN'))
const directLines   = computed(() => (translatorResult.value?.code ?? '').split('\n'))
const optLines      = computed(() => (optimizerResult.value?.optimizedCpp ?? '').split('\n'))
const asmLines      = computed(() => (codegenResult.value?.assembly ?? '').split('\n'))

// ── Errores por línea (para resaltar en el editor) ────────────────────────────
type LineError = { sev: 'lex'|'syn'|'sem'|'warn'; label: string; message: string }

const errorsByLine = computed(() => {
  const map = new Map<number, LineError[]>()
  if (!resultsReady.value) return map
  const add = (line: number | undefined, err: LineError) => {
    if (!line || line < 1) return
    if (!map.has(line)) map.set(line, [])
    map.get(line)!.push(err)
  }
  for (const t of unknownTokens.value)
    add(t.line, { sev: 'lex', label: 'Error léxico', message: `Símbolo no reconocido: '${t.lexeme}'` })
  for (const e of syntaxResult.value?.errors ?? []) {
    const m = e.match(/\(línea (\d+)/)
    if (m) add(Number(m[1]), { sev: 'syn', label: 'Error sintáctico', message: e })
  }
  for (const e of semanticResult.value?.errors ?? [])
    add(e.line, { sev: 'sem', label: 'Error semántico', message: e.message })
  for (const w of semanticResult.value?.warnings ?? [])
    add(w.line, { sev: 'warn', label: 'Advertencia', message: w.message })
  return map
})

function lineMarkClass(n: number): string {
  const errs = errorsByLine.value.get(n)
  if (!errs?.length) return ''
  return errs.some(e => e.sev !== 'warn') ? 'bd-err' : 'bd-warn'
}

// ── Tooltip de errores en el editor ───────────────────────────────────────────
const tooltip = ref<{ visible: boolean; x: number; y: number; errors: LineError[] }>(
  { visible: false, x: 0, y: 0, errors: [] },
)

const EDITOR_PAD_TOP = 14
const EDITOR_LINE_H  = 13 * 1.65   // font-size × line-height del editor

function onEditorMouseMove(e: MouseEvent) {
  const el = textareaRef.value
  if (!el || errorsByLine.value.size === 0) { tooltip.value.visible = false; return }
  const rect = el.getBoundingClientRect()
  const yInText = e.clientY - rect.top + el.scrollTop - EDITOR_PAD_TOP
  const line = Math.floor(yInText / EDITOR_LINE_H) + 1
  const errs = errorsByLine.value.get(line)
  if (errs?.length) {
    tooltip.value = {
      visible: true,
      x: Math.min(e.clientX + 14, window.innerWidth - 380),
      y: e.clientY + 18,
      errors: errs,
    }
  } else {
    tooltip.value.visible = false
  }
}
function hideTooltip() { tooltip.value.visible = false }

// ── Diff (comparación C++ Directo vs Optimizado) ─────────────────────────────
type DiffRow = { type: 'same'|'mod'|'del'|'add'; left: string|null; right: string|null; ln: number|null; rn: number|null }

// Diff por líneas basado en LCS: 'mod' = línea cambiada, 'del' = solo en directo, 'add' = solo en optimizado
function computeDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const rows: DiffRow[] = []
  const pendingDel: string[] = []
  const pendingAdd: string[] = []
  let ln = 1, rn = 1

  const flush = () => {
    const paired = Math.min(pendingDel.length, pendingAdd.length)
    for (let x = 0; x < paired; x++)
      rows.push({ type: 'mod', left: pendingDel[x], right: pendingAdd[x], ln: ln++, rn: rn++ })
    for (let x = paired; x < pendingDel.length; x++)
      rows.push({ type: 'del', left: pendingDel[x], right: null, ln: ln++, rn: null })
    for (let x = paired; x < pendingAdd.length; x++)
      rows.push({ type: 'add', left: null, right: pendingAdd[x], ln: null, rn: rn++ })
    pendingDel.length = 0
    pendingAdd.length = 0
  }

  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush()
      rows.push({ type: 'same', left: a[i], right: b[j], ln: ln++, rn: rn++ })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pendingDel.push(a[i]); i++
    } else {
      pendingAdd.push(b[j]); j++
    }
  }
  while (i < n) { pendingDel.push(a[i]); i++ }
  while (j < m) { pendingAdd.push(b[j]); j++ }
  flush()
  return rows
}

const diffRows = computed<DiffRow[]>(() => {
  if (!translatorResult.value?.success || !optimizerResult.value?.success) return []
  return computeDiff(directLines.value, optLines.value)
})

const diffStats = computed(() => {
  const s = { same: 0, mod: 0, del: 0, add: 0 }
  for (const r of diffRows.value) s[r.type]++
  return s
})

const phases = computed(() => {
  const r      = resultsReady.value
  const lexOk  = r && unknownTokens.value.length === 0
  const synOk  = r && Boolean(syntaxResult.value?.success)
  const semOk  = r && Boolean(semanticResult.value?.success)
  const trlOk  = r && Boolean(translatorResult.value?.success)
  const optOk  = r && Boolean(optimizerResult.value?.success)
  const cgOk   = r && Boolean(codegenResult.value?.success)
  const semErr = semanticResult.value?.errors?.length ?? 0
  const semWrn = semanticResult.value?.warnings?.length ?? 0
  const trlLines = (translatorResult.value?.code ?? '').split('\n').length

  return [
    {
      key: 'lexico' as const, label: 'Léxico',
      status: !r ? 'pending' : lexOk ? 'ok' : 'err',
      icon:   !r ? '◌' : lexOk ? '✓' : '✗',
      detail: !r ? 'Sin analizar' : `${tokens.value.length} tokens${unknownTokens.value.length ? ` · ${unknownTokens.value.length} error(es)` : ''}`,
      badge: r ? String(tokens.value.length) : null, badgeClass: 'badge-neutral',
    },
    {
      key: 'sintactico' as const, label: 'Sintáctico',
      status: !r ? 'pending' : synOk ? 'ok' : 'err',
      icon:   !r ? '◌' : synOk ? '✓' : '✗',
      detail: !r ? 'Sin analizar' : synOk ? 'Sin errores' : `${syntaxResult.value?.errors.length ?? 0} error(es)`,
      badge: r ? (synOk ? '✓' : String(syntaxResult.value?.errors.length ?? 0)) : null,
      badgeClass: synOk ? 'badge-ok' : 'badge-err',
    },
    {
      key: 'semantico' as const, label: 'Semántico',
      status: !r ? 'pending' : semOk ? 'ok' : 'err',
      icon:   !r ? '◌' : semOk ? '✓' : '✗',
      detail: !r ? 'Sin analizar' : `${semErr} err · ${semWrn} advert.`,
      badge: r ? ((semErr + semWrn) > 0 ? String(semErr + semWrn) : '✓') : null,
      badgeClass: !semOk ? 'badge-err' : semWrn > 0 ? 'badge-warn' : 'badge-ok',
    },
    {
      key: 'traductor' as const, label: 'C++ Directo',
      status: !r ? 'pending' : trlOk ? 'ok' : 'err',
      icon:   !r ? '◌' : trlOk ? '✓' : '✗',
      detail: !r ? 'Sin analizar' : trlOk ? `${trlLines} líneas` : 'Error',
      badge: r ? (trlOk ? '✓' : '✗') : null,
      badgeClass: trlOk ? 'badge-ok' : 'badge-err',
    },
    {
      key: 'optimizador' as const, label: 'C++ Optimizado',
      status: !r ? 'pending' : optOk ? 'ok' : 'err',
      icon:   !r ? '◌' : optOk ? '⚡' : '✗',
      detail: !r ? 'Sin analizar' : optOk ? `${optimizerResult.value?.totalChanges ?? 0} optimización(es)` : 'Error',
      badge: r && optOk ? String(optimizerResult.value?.totalChanges ?? 0) : null,
      badgeClass: 'badge-opt',
    },
    {
      key: 'comparacion' as const, label: 'Comparación',
      status: !r ? 'pending' : (trlOk && optOk) ? 'ok' : 'err',
      icon:   !r ? '◌' : (trlOk && optOk) ? '⇄' : '✗',
      detail: !r ? 'Sin analizar'
        : (trlOk && optOk)
          ? `${diffStats.value.mod + diffStats.value.del + diffStats.value.add} línea(s) diferentes`
          : 'No disponible',
      badge: r && trlOk && optOk ? String(diffStats.value.mod + diffStats.value.del + diffStats.value.add) : null,
      badgeClass: 'badge-warn',
    },
    {
      key: 'destino' as const, label: 'Código Destino',
      status: !r ? 'pending' : cgOk ? 'ok' : 'err',
      icon:   !r ? '◌' : cgOk ? '⛭' : '✗',
      detail: !r ? 'Sin analizar' : cgOk ? `${codegenResult.value?.stats.instructions ?? 0} instrucciones` : 'Error',
      badge: r && cgOk ? String(codegenResult.value?.stats.instructions ?? 0) : null,
      badgeClass: 'badge-neutral',
    },
  ]
})

const allOk = computed(() => phases.value.every(p => p.status === 'ok'))

// ── Helpers ───────────────────────────────────────────────────────────────────
function syncScroll() {
  if (textareaRef.value && lineNumbersRef.value)
    lineNumbersRef.value.scrollTop = textareaRef.value.scrollTop
  if (textareaRef.value && backdropRef.value)
    backdropRef.value.scrollTop = textareaRef.value.scrollTop
}
watch(lineCount, () => nextTick(syncScroll))

function insertTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const s = el.selectionStart, end = el.selectionEnd
  code.value = code.value.substring(0, s) + '    ' + code.value.substring(end)
  nextTick(() => { el.selectionStart = el.selectionEnd = s + 4 })
}

const KW  = ['DEF','IF','ELSE','WHILE','FOR','RETURN','IMPORT','CLASS','KEYWORD']
const LIT = ['STRING','NUMBER','INT','FLOAT','BOOL']
const OPS = ['OP','OPERATOR','ASSIGN','COMPARE','PLUS','MINUS','STAR','SLASH']

function chipClass(t: string) {
  const u = t.toUpperCase()
  if (KW.some(k  => u.includes(k))) return 'chip-kw'
  if (LIT.some(k => u.includes(k))) return 'chip-lit'
  if (OPS.some(k => u.includes(k))) return 'chip-op'
  if (u.includes('ID') || u.includes('NAME')) return 'chip-id'
  return 'chip-default'
}
function kindChip(k: string) {
  if (k === 'function') return 'chip-kw'
  if (k === 'parameter') return 'chip-op'
  if (k === 'import' || k === 'class') return 'chip-lit'
  return 'chip-id'
}
function asmLineClass(line: string): string {
  const t = line.trim()
  if (t.startsWith(';'))                 return 'asm-comment'
  if (t.startsWith('.'))                 return 'asm-directive'
  if (/^[A-Za-z_][\w.]*:/.test(t))       return 'asm-label'
  return 'asm-instr'
}

function passChip(p: string) {
  if (p.includes('Plegado'))    return 'pass-fold'
  if (p.includes('algebraica') || p.includes('Reducción') || p.includes('potencia')) return 'pass-alg'
  if (p.includes('Propagación')) return 'pass-prop'
  return 'pass-dead'
}

// ── Actions ───────────────────────────────────────────────────────────────────
const POST = (url: string) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: code.value }),
})

async function analyzeAll() {
  loading.value = true
  resultsReady.value = false
  tokens.value = []; syntaxResult.value = null
  semanticResult.value = null; translatorResult.value = null; optimizerResult.value = null
  codegenResult.value = null

  try {
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      POST('http://localhost:3000/lexer/lex'),
      POST('http://localhost:3000/syntax/analyze'),
      POST('http://localhost:3000/semantic/analyze'),
      POST('http://localhost:3000/translator/translate'),
      POST('http://localhost:3000/optimizer/optimize'),
      POST('http://localhost:3000/codegen/generate'),
    ])
    const [j1, j2, j3, j4, j5, j6] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json(), r5.json(), r6.json()])

    if (Array.isArray(j1.tokens))
      tokens.value = j1.tokens.map((t: any) => ({ type: t.type||'UNKNOWN', lexeme: t.lexeme||'', line: t.line, column: t.column }))

    syntaxResult.value   = { success: Boolean(j2.success), ast: j2.ast, errors: Array.isArray(j2.errors) ? j2.errors : [] }
    semanticResult.value = { success: Boolean(j3.success), errors: Array.isArray(j3.errors) ? j3.errors : [], warnings: Array.isArray(j3.warnings) ? j3.warnings : [], symbolTable: Array.isArray(j3.symbolTable) ? j3.symbolTable : [] }
    translatorResult.value= { success: Boolean(j4.success), code: j4.code ?? '', error: j4.error }
    optimizerResult.value = { success: Boolean(j5.success), optimizedCpp: j5.optimizedCpp ?? '', changes: Array.isArray(j5.changes) ? j5.changes : [], totalChanges: j5.totalChanges ?? 0, passesRun: j5.passesRun ?? 0, error: j5.error }
    codegenResult.value   = { success: Boolean(j6.success), assembly: j6.assembly ?? '', stats: j6.stats ?? { instructions: 0, registers: 0, labels: 0, strings: 0, variables: 0 }, error: j6.error }

    resultsReady.value = true
  } catch {
    alert('Error al conectar con el backend')
  } finally {
    loading.value = false
  }
}

function loadExample() {
  code.value = EXAMPLES[selectedExample.value] ?? EX_REAL
  resultsReady.value = false
  tokens.value = []; syntaxResult.value = null
  semanticResult.value = null; translatorResult.value = null; optimizerResult.value = null
  codegenResult.value = null
}

async function copyDirectCpp() {
  if (!translatorResult.value?.code) return
  await navigator.clipboard.writeText(translatorResult.value.code)
  copiedDirect.value = true; setTimeout(() => { copiedDirect.value = false }, 2000)
}
async function copyOptCpp() {
  if (!optimizerResult.value?.optimizedCpp) return
  await navigator.clipboard.writeText(optimizerResult.value.optimizedCpp)
  copiedOpt.value = true; setTimeout(() => { copiedOpt.value = false }, 2000)
}
async function copyAsm() {
  if (!codegenResult.value?.assembly) return
  await navigator.clipboard.writeText(codegenResult.value.assembly)
  copiedAsm.value = true; setTimeout(() => { copiedAsm.value = false }, 2000)
}
</script>

<style scoped>
/* ══════════════════════════ LAYOUT ══════════════════════════ */
.analyzer { display: flex; flex-direction: column; gap: 12px; height: calc(100vh - 100px); min-height: 560px; }

.tabs-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

/* ── Panel base ── */
.panel { background: #161b22; border: 1px solid #30363d; border-radius: 10px; overflow: hidden; }

/* ── Barra superior ── */
.toolbar-panel {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; flex-shrink: 0;
}

.phase-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: 8px; flex: 1; }

.phase-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 14px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  background: transparent; border: 1px solid #30363d; color: #8b949e;
  cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.phase-chip:hover { background: #21262d; color: #e6edf3; }
.pc-icon { font-size: 12px; }

.pc-ok      { border-color: #2e5a3a; color: #56d364; }
.pc-err     { border-color: #6e2b28; color: #f85149; }
.pc-pending { border-color: #30363d; color: #545d68; }

.pc-active { background: #21262d; border-color: #388bfd; color: #e6edf3; }
.pc-active.pc-ok  { border-color: #56d364; }
.pc-active.pc-err { border-color: #f85149; }

/* ── Editor como tab ── */
.editor-pane { position: relative; }

/* ── Editor ── */
.editor-wrap { display: flex; flex: 1; background: #0d1117; overflow: hidden; min-height: 0; }

.line-numbers {
  display: flex; flex-direction: column; align-items: flex-end;
  padding: 14px 10px 14px 12px; background: #0d1117;
  border-right: 1px solid #21262d; color: #3d444d;
  font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.65;
  user-select: none; overflow: hidden; min-width: 40px; flex-shrink: 0;
}
.line-numbers span { display: block; line-height: 1.65; }
.ln-err  { color: #f85149 !important; font-weight: 700; }
.ln-warn { color: #e3b341 !important; font-weight: 700; }

.editor-area { position: relative; flex: 1; min-width: 0; overflow: hidden; }

.editor-backdrop {
  position: absolute; inset: 0; overflow: hidden;
  padding: 14px 0 34px; background: #0d1117;
  font-size: 13px; pointer-events: none;
}
.bd-line { height: calc(13px * 1.65); }
.bd-err  { background: rgba(248, 81, 73, 0.14); box-shadow: inset 3px 0 0 #f85149; }
.bd-warn { background: rgba(227, 179, 65, 0.10); box-shadow: inset 3px 0 0 #e3b341; }

.code-editor {
  position: absolute; inset: 0; background: transparent; color: #e6edf3;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 13px; line-height: 1.65;
  border: none; outline: none; padding: 14px 16px;
  resize: none; overflow: auto; width: 100%; height: 100%; tab-size: 4;
  white-space: pre;
}

/* ── Tooltip de errores ── */
.err-tooltip {
  position: fixed; z-index: 1000; max-width: 380px;
  background: #1c2128; border: 1px solid #f85149; border-radius: 8px;
  padding: 8px 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; gap: 6px;
  pointer-events: none;
}
.tt-item { display: flex; align-items: baseline; gap: 8px; }
.tt-chip {
  flex-shrink: 0; padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; font-family: 'Courier New', monospace;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.tt-lex  { background: #3d1a1a; color: #ffa198; }
.tt-syn  { background: #3d1a2e; color: #ff9bce; }
.tt-sem  { background: #2d1f3d; color: #d2a8ff; }
.tt-warn { background: #3d2b00; color: #e3b341; }
.tt-msg  { font-size: 12px; color: #e6edf3; line-height: 1.5; }

/* ── Botones ── */
.btn {
  padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 500;
  cursor: pointer; border: none; display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.15s, opacity 0.15s; white-space: nowrap;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #238636; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #2ea043; }
.btn-ghost { background: transparent; color: #8b949e; border: 1px solid #30363d; }
.btn-ghost:hover { background: #21262d; color: #e6edf3; }

.spinner {
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Select de ejemplos ── */
.example-select {
  background: #21262d; color: #e6edf3;
  border: 1px solid #30363d; border-radius: 6px;
  padding: 6px 10px; font-size: 12.5px; cursor: pointer;
  outline: none; flex: 1; max-width: 260px;
}
.example-select:hover { border-color: #8b949e; }
.example-select option { background: #1c2128; }

/* ── Chip de estado global ── */
.all-ok-chip { padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.aok-ok  { background: #1a3a2a; color: #56d364; }
.aok-err { background: #3d1a1a; color: #f85149; }

/* ── Tab bar ── */
.tab-bar {
  display: flex; background: #1c2128;
  border-bottom: 1px solid #30363d; flex-shrink: 0; overflow-x: auto;
}
.tab-btn {
  padding: 11px 18px; font-size: 12.5px; font-weight: 500;
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: #8b949e; cursor: pointer; white-space: nowrap;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  display: flex; align-items: center; gap: 6px;
}
.tab-btn:hover { color: #e6edf3; background: #21262d; }
.tab-active { color: #e6edf3 !important; border-bottom-color: #388bfd; background: #21262d; }
.tab-has-err { color: #ffa198; }
.tab-has-err.tab-active { border-bottom-color: #f85149; }

.tab-badge {
  padding: 1px 6px; border-radius: 10px;
  font-size: 10px; font-weight: 700; font-family: 'Courier New', monospace;
}
.badge-neutral { background: #21262d; color: #8b949e; }
.badge-ok      { background: #1a3a2a; color: #56d364; }
.badge-err     { background: #3d1a1a; color: #f85149; }
.badge-warn    { background: #3d2b00; color: #e3b341; }
.badge-opt     { background: #3a2a00; color: #e3b341; }

/* ── Tab content ── */
.tab-content { flex: 1; overflow: hidden; min-height: 0; position: relative; }

.tab-pane { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

.tab-empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: #3d444d; font-size: 12px;
  font-family: 'Courier New', monospace;
}

.tab-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; }

/* ── Banners ── */
.warn-bar { padding: 8px 16px; background: #3d2b00; color: #e3b341; font-size: 12px; border-bottom: 1px solid #6a4e00; flex-shrink: 0; }
.ok-bar   { padding: 10px 16px; background: #1a3a2a; color: #56d364; font-size: 12.5px; border-bottom: 1px solid #2e5a3a; flex-shrink: 0; }

.err-block { padding: 12px 16px; border-bottom: 1px solid #30363d; flex-shrink: 0; }
.block-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin: 0 0 6px; }
.err-color   { color: #f85149; }
.warn-color  { color: #e3b341; }
.err-msg     { font-size: 12.5px; color: #ffa198; margin: 4px 0 0; }

/* ── Tables ── */
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th {
  background: #1c2128; color: #8b949e; font-weight: 500;
  padding: 7px 12px; text-align: left; border-bottom: 1px solid #30363d;
  position: sticky; top: 0; z-index: 1;
}
.data-table td { padding: 5px 12px; border-bottom: 1px solid #1c2128; color: #e6edf3; vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: #1c2128; }
.row-err td { background: #2a1515 !important; }

.mono   { font-family: 'Courier New', monospace; font-size: 11.5px; }
.center { text-align: center; color: #8b949e; }

/* ── Chips ── */
.type-chip { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10.5px; font-family: 'Courier New', monospace; font-weight: 600; }
.chip-kw      { background: #1f3a5f; color: #79c0ff; }
.chip-lit     { background: #3d2b00; color: #e3b341; }
.chip-op      { background: #2d1f3d; color: #d2a8ff; }
.chip-id      { background: #1a3a2a; color: #56d364; }
.chip-default { background: #21262d; color: #8b949e; }

/* ── Sintáctico ── */
.plain-list { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 4px; }
.err-line { font-size: 12px; color: #ffa198; font-family: 'Courier New', monospace; padding: 3px 8px; background: #2a1515; border-radius: 4px; }

.ast-block { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
.section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; font-weight: 600; margin: 0; }
.ast-pre { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px; font-family: 'Courier New', monospace; font-size: 11px; color: #79c0ff; white-space: pre-wrap; word-break: break-all; }

/* ── Semántico ── */
.diag-blocks { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
.diag-block  { display: flex; flex-direction: column; gap: 5px; }
.diag-list   { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.diag-err, .diag-warn { font-size: 12px; padding: 4px 8px; border-radius: 5px; display: flex; align-items: baseline; gap: 6px; }
.diag-err  { background: #3d1a1a; color: #ffa198; }
.diag-warn { background: #3d2b00; color: #e3b341; }
.loc-chip { font-family: 'Courier New', monospace; font-size: 10px; background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; flex-shrink: 0; color: #8b949e; }
.sym-section { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }

/* ── C++ Directo ── */
.cpp-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: #1c2128;
  border-bottom: 1px solid #30363d; flex-shrink: 0;
  font-size: 12px; color: #8b949e;
}
.cpp-info { font-family: 'Courier New', monospace; }
.cpp-scroll { flex: 1; overflow: auto; padding: 12px 16px; background: #0d1117; }
.cpp-direct { margin: 0; font-family: 'Courier New', 'Cascadia Code', monospace; font-size: 12px; line-height: 1.65; color: #79c0ff; white-space: pre; }

/* ── C++ Optimizado ── */
.opt-pane { overflow: hidden; }

.opt-summary {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: #1c2128;
  border-bottom: 1px solid #30363d;
  font-size: 12.5px; color: #8b949e; flex-shrink: 0;
}
.opt-stat strong { color: #e3b341; }
.opt-dot { color: #3d444d; }
.ml-auto { margin-left: auto; }

.btn-copy {
  background: #21262d; border: 1px solid #30363d; color: #8b949e;
  border-radius: 5px; padding: 4px 12px; cursor: pointer; font-size: 12px;
  transition: background 0.15s; white-space: nowrap;
}
.btn-copy:hover { background: #30363d; color: #e6edf3; }

.opt-split {
  display: grid; grid-template-columns: 1fr 1.6fr;
  flex: 1; min-height: 0; overflow: hidden;
}

.opt-report {
  padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
  border-right: 1px solid #30363d; overflow-y: auto; min-height: 0;
}
.opt-none { font-size: 12px; color: #56d364; }
.opt-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
.opt-item { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }

.pass-chip { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; font-family: 'Courier New', monospace; flex-shrink: 0; }
.pass-fold { background: #1f3a5f; color: #79c0ff; }
.pass-alg  { background: #2d1f3d; color: #d2a8ff; }
.pass-prop { background: #3a2a00; color: #e3b341; }
.pass-dead { background: #3d1a1a; color: #ffa198; }
.opt-desc  { color: #e6edf3; font-family: 'Courier New', monospace; font-size: 11px; }
.line-count { font-size: 10px; color: #56d364; background: #1a3a2a; padding: 1px 7px; border-radius: 10px; margin-left: 8px; font-weight: 600; font-family: 'Courier New', monospace; }

.opt-code {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; overflow: hidden; min-height: 0;
}

.cpp-pre {
  flex: 1; margin: 0; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  padding: 12px 14px; color: #56d364;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 11.5px; line-height: 1.6; white-space: pre; overflow: auto; min-height: 0;
}

/* ── Código con números de línea ── */
.code-numbered {
  display: flex; flex-direction: column;
  font-family: 'Courier New', 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.65;
}
.cl { display: flex; }
.cl:hover { background: rgba(255,255,255,0.03); }
.cl-num {
  flex: 0 0 42px; text-align: right; padding-right: 14px;
  color: #3d444d; user-select: none; flex-shrink: 0;
}
.cl-text { white-space: pre; }
.code-direct .cl-text { color: #79c0ff; }
.code-opt    .cl-text { color: #56d364; }
.code-opt { font-size: 11.5px; line-height: 1.6; }

/* ── Código Destino (ensamblador) ── */
.asm-stat strong { color: #ffa657; }
.code-asm .asm-instr     { color: #e6edf3; }
.code-asm .asm-label     { color: #ffa657; font-weight: 700; }
.code-asm .asm-directive { color: #d2a8ff; font-weight: 600; }
.code-asm .asm-comment   { color: #6a737d; font-style: italic; }

/* ── Comparación (diff) ── */
.diff-toolbar {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 16px; background: #1c2128;
  border-bottom: 1px solid #30363d; flex-shrink: 0;
  font-size: 12px; color: #8b949e;
}
.legend-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; }
.legend-box  { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.lb-mod { background: #e3b341; }
.lb-del { background: #f85149; }
.lb-add { background: #56d364; }

.diff-stats { margin-left: auto; font-family: 'Courier New', monospace; font-size: 11.5px; }
.ds-same { color: #e6edf3; }
.ds-mod  { color: #e3b341; }
.ds-del  { color: #f85149; }
.ds-add  { color: #56d364; }

.diff-headers {
  display: grid; grid-template-columns: 1fr 1fr;
  background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0;
}
.diff-h {
  padding: 8px 16px; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.06em; color: #8b949e; font-weight: 600;
}
.diff-h + .diff-h { border-left: 1px solid #30363d; }

.diff-scroll { background: #0d1117; }

.diff-row {
  display: grid; grid-template-columns: 44px 1fr 44px 1fr;
  font-family: 'Courier New', monospace; font-size: 11.5px; line-height: 1.6;
}
.d-num {
  text-align: right; padding: 0 8px; color: #3d444d;
  user-select: none; background: #10151b;
}
.d-code { white-space: pre-wrap; word-break: break-all; padding: 0 12px; color: #e6edf3; min-height: 1.6em; }
.d-left { border-right: 1px solid #21262d; }

.dr-mod .d-code { background: rgba(227, 179, 65, 0.10); }
.dr-mod .d-num  { color: #e3b341; }

.dr-del .d-left  { background: rgba(248, 81, 73, 0.13); color: #ffa198; }
.dr-del .d-right { background: #0a0d12; }
.dr-del .d-num   { color: #f85149; }

.dr-add .d-right { background: rgba(86, 211, 100, 0.10); color: #7ee787; }
.dr-add .d-left  { background: #0a0d12; }
.dr-add .d-num   { color: #56d364; }
</style>
