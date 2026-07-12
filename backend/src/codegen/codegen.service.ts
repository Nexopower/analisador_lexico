import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';
import { AstOptimizer } from '../optimizer/optimizer.service';

type AstNode = { type: string; [key: string]: any };

export type CodegenResult = {
  success: boolean;
  assembly: string;
  stats: {
    instructions: number;
    registers: number;
    labels: number;
    strings: number;
    variables: number;
  };
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Generador de código destino: ensamblador didáctico estilo RISC.
// Convenciones:
//   t0..tN  registros temporales (virtuales)
//   a0..a3  registros de argumentos
//   v0      registro de valor de retorno
//   fp/sp   frame pointer / stack pointer
// ─────────────────────────────────────────────────────────────────────────────
class AsmGenerator {
  private text: string[] = [];
  private strings = new Map<string, string>();  // contenido → etiqueta
  private globalVars = new Set<string>();
  private localVars = new Set<string>();
  private inFunction = false;
  private tempCounter = 0;
  private maxTemp = -1;
  private labelCounter = 0;
  private instructionCount = 0;
  private labelCount = 0;
  private currentFnName = '';
  private loopStack: Array<{ start: string; end: string }> = [];

  generate(ast: AstNode): { assembly: string; stats: CodegenResult['stats'] } {
    const functionNodes: AstNode[] = [];
    const mainStmts: AstNode[] = [];

    for (const stmt of ast.body ?? []) {
      if (stmt.type === 'FunctionDef') functionNodes.push(stmt);
      else if (this.isMainGuard(stmt)) mainStmts.push(...(stmt.body ?? []));
      else mainStmts.push(stmt);
    }

    // ── .text: funciones primero, main al final ──
    this.emitRaw('.text');
    this.emitInstr('JMP', 'main', 'punto de entrada del programa');
    this.emitRaw('');

    for (const fn of functionNodes) {
      this.genFunctionDef(fn);
      this.emitRaw('');
    }

    this.emitLabel('main');
    this.inFunction = false;
    for (const stmt of mainStmts) this.genStatement(stmt);
    this.emitInstr('LI', 'v0, 0', 'código de salida 0');
    this.emitInstr('SYSCALL', 'exit', 'terminar programa');

    // ── .data: cadenas y variables globales ──
    const data: string[] = ['.data'];
    for (const [content, label] of this.strings)
      data.push(`    ${label}:`.padEnd(16) + `.asciiz "${content}"`);
    for (const v of this.globalVars)
      data.push(`    ${v}:`.padEnd(16) + '.word 0');
    if (this.strings.size === 0 && this.globalVars.size === 0)
      data.push('    ; (sin datos estáticos)');

    const header = [
      '; ══════════════════════════════════════════════════',
      '; CÓDIGO DESTINO — Ensamblador didáctico estilo RISC',
      '; Generado a partir del AST optimizado',
      '; ══════════════════════════════════════════════════',
      '',
    ];

    const assembly = [...header, ...data, '', ...this.text].join('\n');
    return {
      assembly,
      stats: {
        instructions: this.instructionCount,
        registers: this.maxTemp + 1,
        labels: this.labelCount,
        strings: this.strings.size,
        variables: this.globalVars.size + this.localVars.size,
      },
    };
  }

  // ── Emisión ──────────────────────────────────────────────────────────────
  private emitRaw(line: string): void {
    this.text.push(line);
  }

  private emitInstr(mnemonic: string, operands: string, comment?: string): void {
    let line = `    ${mnemonic.padEnd(8)}${operands}`;
    if (comment) line = line.padEnd(42) + `; ${comment}`;
    this.text.push(line);
    this.instructionCount++;
  }

  private emitLabel(name: string, comment?: string): void {
    this.text.push(comment ? `${name}:`.padEnd(42) + `; ${comment}` : `${name}:`);
    this.labelCount++;
  }

  private emitComment(comment: string): void {
    this.text.push(`    ; ${comment}`);
  }

  private newTemp(): string {
    const t = `t${this.tempCounter++}`;
    if (this.tempCounter - 1 > this.maxTemp) this.maxTemp = this.tempCounter - 1;
    return t;
  }

  private resetTemps(): void {
    this.tempCounter = 0;
  }

  private newLabel(): string {
    return `L${this.labelCounter++}`;
  }

  private internString(content: string): string {
    if (!this.strings.has(content))
      this.strings.set(content, `str_${this.strings.size}`);
    return this.strings.get(content)!;
  }

  private recordVar(name: string): void {
    if (this.inFunction) this.localVars.add(`${this.currentFnName}.${name}`);
    else this.globalVars.add(name);
  }

  // ── Utilidades ───────────────────────────────────────────────────────────
  private isMainGuard(node: AstNode): boolean {
    if (node.type !== 'IfStatement') return false;
    const t = node.test;
    return (
      t?.type === 'BinaryExpression' && t.operator === '==' &&
      t.left?.type === 'Identifier' && t.left.name === '__name__' &&
      t.right?.type === 'StringLiteral'
    );
  }

  private extractStringInner(raw: string): string {
    let s = String(raw).replace(/^[fFrRbBuU]+/, '');
    if (s.startsWith('"""') || s.startsWith("'''")) return s.slice(3, -3);
    return s.slice(1, -1);
  }

  private pname(p: any): string {
    return typeof p === 'string' ? p : (p?.name ?? '?');
  }

  // Aplana cadenas de concatenación con '+' (para imprimir por partes)
  private flattenConcat(node: AstNode): AstNode[] {
    if (node?.type === 'BinaryExpression' && node.operator === '+')
      return [...this.flattenConcat(node.left), ...this.flattenConcat(node.right)];
    if (node?.type === 'Grouping') return this.flattenConcat(node.expression);
    return [node];
  }

  private isStringPart(node: AstNode): boolean {
    if (node?.type === 'StringLiteral') return true;
    if (node?.type === 'CallExpression' && node.callee?.name === 'str') return true;
    return false;
  }

  // ── Sentencias ───────────────────────────────────────────────────────────
  private genStatement(node: AstNode): void {
    if (!node) return;
    this.resetTemps();
    switch (node.type) {
      case 'Assignment':          return this.genAssignment(node);
      case 'AugmentedAssignment': return this.genAugAssignment(node);
      case 'IfStatement':         return this.genIf(node);
      case 'WhileStatement':      return this.genWhile(node);
      case 'ReturnStatement':     return this.genReturn(node);
      case 'ExpressionStatement': { this.genExpr(node.expression); return; }
      case 'BreakStatement': {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (loop) this.emitInstr('JMP', loop.end, 'break');
        return;
      }
      case 'ContinueStatement': {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (loop) this.emitInstr('JMP', loop.start, 'continue');
        return;
      }
      case 'PassStatement':       return;
      default:                    return; // imports y otros no generan código
    }
  }

  private genFunctionDef(node: AstNode): void {
    const params = (node.params ?? []).map((p: any) => this.pname(p));
    this.inFunction = true;
    this.currentFnName = node.name;

    this.emitRaw(`; ── función ${node.name}(${params.join(', ')}) ──`);
    this.emitLabel(node.name);
    this.emitInstr('PUSH', 'fp', 'guardar frame pointer');
    this.emitInstr('MOV', 'fp, sp', 'nuevo marco de pila');

    params.forEach((p: string, i: number) => {
      this.emitInstr('ST', `a${i}, [${p}]`, `parámetro ${p}`);
      this.recordVar(p);
    });

    for (const stmt of node.body ?? []) this.genStatement(stmt);

    this.emitLabel(`${node.name}__fin`, 'epílogo');
    this.emitInstr('POP', 'fp', 'restaurar frame pointer');
    this.emitInstr('RET', '', `fin de ${node.name}`);

    this.inFunction = false;
    this.currentFnName = '';
  }

  private genAssignment(node: AstNode): void {
    const reg = this.genExpr(node.value);
    this.emitInstr('ST', `${reg}, [${node.target}]`, `${node.target} = ${reg}`);
    this.recordVar(node.target);
  }

  private genAugAssignment(node: AstNode): void {
    const op = String(node.operator ?? '+=').replace('=', '');
    const cur = this.newTemp();
    this.emitInstr('LD', `${cur}, [${node.target}]`, `cargar ${node.target}`);
    const val = this.genExpr(node.value);
    const res = this.newTemp();
    const instr = this.binOpInstr(op);
    this.emitInstr(instr, `${res}, ${cur}, ${val}`, `${node.target} ${op}= ...`);
    this.emitInstr('ST', `${res}, [${node.target}]`);
  }

  private genIf(node: AstNode): void {
    const endLabel = this.newLabel();
    const branches: Array<{ test: AstNode | null; body: AstNode[] }> = [
      { test: node.test, body: node.body ?? [] },
      ...(node.elifs ?? []).map((e: AstNode) => ({ test: e.test, body: e.body ?? [] })),
    ];
    if (node.orelse?.length) branches.push({ test: null, body: node.orelse });

    for (let i = 0; i < branches.length; i++) {
      const br = branches[i];
      const nextLabel = i < branches.length - 1 ? this.newLabel() : endLabel;
      if (br.test) {
        this.resetTemps();
        const reg = this.genExpr(br.test);
        this.emitInstr('BEQZ', `${reg}, ${nextLabel}`, i === 0 ? 'si falso, saltar' : 'elif falso, saltar');
      }
      for (const s of br.body) this.genStatement(s);
      if (i < branches.length - 1) {
        this.emitInstr('JMP', endLabel, 'saltar al fin del if');
        this.emitLabel(nextLabel);
      }
    }
    this.emitLabel(endLabel, 'fin if');
  }

  private genWhile(node: AstNode): void {
    const startLabel = this.newLabel();
    const endLabel = this.newLabel();
    this.loopStack.push({ start: startLabel, end: endLabel });

    this.emitLabel(startLabel, 'inicio while');
    this.resetTemps();
    const reg = this.genExpr(node.test);
    this.emitInstr('BEQZ', `${reg}, ${endLabel}`, 'condición falsa: salir');
    for (const s of node.body ?? []) this.genStatement(s);
    this.emitInstr('JMP', startLabel, 'repetir bucle');
    this.emitLabel(endLabel, 'fin while');

    this.loopStack.pop();
  }

  private genReturn(node: AstNode): void {
    if (node.value) {
      const reg = this.genExpr(node.value);
      this.emitInstr('MOV', `v0, ${reg}`, 'valor de retorno');
    } else {
      this.emitInstr('LI', 'v0, 0', 'retorno sin valor');
    }
    this.emitInstr('JMP', `${this.currentFnName}__fin`, 'ir al epílogo');
  }

  // ── Expresiones (devuelven el registro con el resultado) ─────────────────
  private genExpr(node: AstNode): string {
    if (!node) { const t = this.newTemp(); this.emitInstr('LI', `${t}, 0`); return t; }

    switch (node.type) {
      case 'NumberLiteral': {
        const t = this.newTemp();
        this.emitInstr('LI', `${t}, ${node.value}`, `cargar constante ${node.value}`);
        return t;
      }

      case 'StringLiteral': {
        const label = this.internString(this.extractStringInner(node.value));
        const t = this.newTemp();
        this.emitInstr('LA', `${t}, ${label}`, 'dirección de cadena');
        return t;
      }

      case 'Literal': {
        const t = this.newTemp();
        const v = node.value === 'True' ? 1 : 0;
        this.emitInstr('LI', `${t}, ${v}`, `${node.value}`);
        return t;
      }

      case 'Identifier': {
        const t = this.newTemp();
        this.emitInstr('LD', `${t}, [${node.name}]`, `cargar ${node.name}`);
        return t;
      }

      case 'Grouping':
        return this.genExpr(node.expression);

      case 'UnaryExpression': {
        const arg = this.genExpr(node.argument);
        const t = this.newTemp();
        if (node.operator === '-')        this.emitInstr('NEG', `${t}, ${arg}`, 'negación aritmética');
        else if (node.operator === 'not') this.emitInstr('SEQZ', `${t}, ${arg}`, 'negación lógica (1 si 0)');
        else return arg;
        return t;
      }

      case 'BinaryExpression': {
        if (node.operator === '**') {
          const l = this.genExpr(node.left);
          const r = this.genExpr(node.right);
          this.emitInstr('MOV', `a0, ${l}`, 'base');
          this.emitInstr('MOV', `a1, ${r}`, 'exponente');
          this.emitInstr('CALL', '__pow', 'potencia');
          const t = this.newTemp();
          this.emitInstr('MOV', `${t}, v0`);
          return t;
        }
        const l = this.genExpr(node.left);
        const r = this.genExpr(node.right);
        const t = this.newTemp();
        const instr = this.binOpInstr(node.operator);
        this.emitInstr(instr, `${t}, ${l}, ${r}`, `${l} ${node.operator} ${r}`);
        return t;
      }

      case 'Attribute': {
        const objName = node.object?.name ?? '';
        const attr = node.attr ?? node.attribute ?? '';
        const t = this.newTemp();
        if (objName === 'math') {
          const constants: Record<string, string> = {
            pi: '3.14159265358979', e: '2.71828182845905',
            tau: '6.28318530717959', inf: 'INF', nan: 'NAN',
          };
          if (attr in constants) {
            this.emitInstr('LI', `${t}, ${constants[attr]}`, `math.${attr}`);
            return t;
          }
        }
        this.emitInstr('LD', `${t}, [${objName}.${attr}]`, `atributo ${objName}.${attr}`);
        return t;
      }

      case 'CallExpression':
        return this.genCall(node);

      default: {
        const t = this.newTemp();
        this.emitInstr('LI', `${t}, 0`, `expresión no soportada: ${node.type}`);
        return t;
      }
    }
  }

  private genCall(node: AstNode): string {
    const args = (node.args ?? []) as AstNode[];

    // Llamadas módulo.método (math.sqrt, random.randint, ...)
    if (node.callee?.type === 'Attribute') {
      const objName = node.callee.object?.name ?? '';
      const method = node.callee.attr ?? node.callee.attribute ?? '';
      const regs = args.map(a => this.genExpr(a));
      regs.forEach((r, i) => this.emitInstr('MOV', `a${i}, ${r}`));
      this.emitInstr('CALL', `__${objName}_${method}`, `${objName}.${method}()`);
      const t = this.newTemp();
      this.emitInstr('MOV', `${t}, v0`, 'resultado');
      return t;
    }

    const callee = node.callee?.name ?? '';

    if (callee === 'print') return this.genPrint(args);

    // Conversiones: el valor pasa igual, la conversión es del runtime
    if ((callee === 'str' || callee === 'int' || callee === 'float') && args.length === 1) {
      const r = this.genExpr(args[0]);
      this.emitInstr('MOV', `a0, ${r}`);
      this.emitInstr('CALL', `__${callee}`, `conversión ${callee}()`);
      const t = this.newTemp();
      this.emitInstr('MOV', `${t}, v0`);
      return t;
    }

    if (callee === 'len' && args.length === 1) {
      const r = this.genExpr(args[0]);
      this.emitInstr('MOV', `a0, ${r}`);
      this.emitInstr('CALL', '__len', 'longitud');
      const t = this.newTemp();
      this.emitInstr('MOV', `${t}, v0`);
      return t;
    }

    // Llamada a función de usuario
    const regs = args.map(a => this.genExpr(a));
    regs.forEach((r, i) => this.emitInstr('MOV', `a${i}, ${r}`, `argumento ${i}`));
    this.emitInstr('CALL', callee, `llamar ${callee}()`);
    const t = this.newTemp();
    this.emitInstr('MOV', `${t}, v0`, 'valor devuelto');
    return t;
  }

  // print: si hay concatenación con cadenas, imprime cada parte por separado
  private genPrint(args: AstNode[]): string {
    if (args.length === 0) {
      this.emitInstr('SYSCALL', 'print_nl', 'salto de línea');
      return 'v0';
    }

    for (const arg of args) {
      const parts = this.flattenConcat(arg);
      const isConcat = parts.length > 1 && parts.some(p => this.isStringPart(p));

      if (isConcat) {
        for (const part of parts) {
          if (part.type === 'StringLiteral') {
            const label = this.internString(this.extractStringInner(part.value));
            this.emitInstr('LA', `a0, ${label}`);
            this.emitInstr('SYSCALL', 'print_str', 'imprimir cadena');
          } else if (part.type === 'CallExpression' && part.callee?.name === 'str' && part.args?.length === 1) {
            const r = this.genExpr(part.args[0]);
            this.emitInstr('MOV', `a0, ${r}`);
            this.emitInstr('SYSCALL', 'print_val', 'imprimir valor');
          } else {
            const r = this.genExpr(part);
            this.emitInstr('MOV', `a0, ${r}`);
            this.emitInstr('SYSCALL', 'print_val', 'imprimir valor');
          }
        }
      } else if (arg.type === 'StringLiteral') {
        const label = this.internString(this.extractStringInner(arg.value));
        this.emitInstr('LA', `a0, ${label}`);
        this.emitInstr('SYSCALL', 'print_str', 'imprimir cadena');
      } else {
        const r = this.genExpr(arg);
        this.emitInstr('MOV', `a0, ${r}`);
        this.emitInstr('SYSCALL', 'print_val', 'imprimir valor');
      }
    }

    this.emitInstr('SYSCALL', 'print_nl', 'salto de línea');
    return 'v0';
  }

  private binOpInstr(op: string): string {
    const map: Record<string, string> = {
      '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '//': 'DIV', '%': 'MOD',
      '==': 'SEQ', '!=': 'SNE', '<': 'SLT', '<=': 'SLE', '>': 'SGT', '>=': 'SGE',
      'and': 'AND', 'or': 'OR',
    };
    return map[op] ?? 'NOP';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NestJS Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CodegenService {
  constructor(private readonly syntaxService: SyntaxService) {}

  async generate(code: string): Promise<CodegenResult> {
    const syntaxResult = await this.syntaxService.analyze(code);

    if (!syntaxResult.success || !syntaxResult.ast) {
      return {
        success: false,
        assembly: '',
        stats: { instructions: 0, registers: 0, labels: 0, strings: 0, variables: 0 },
        error: 'No se puede generar código destino: el código tiene errores sintácticos.',
      };
    }

    try {
      // El código destino se genera desde el AST ya optimizado
      const optimizer = new AstOptimizer();
      const { ast: optimizedAst } = optimizer.optimize(syntaxResult.ast as AstNode);
      const gen = new AsmGenerator();
      const { assembly, stats } = gen.generate(optimizedAst);
      return { success: true, assembly, stats };
    } catch (e: any) {
      return {
        success: false,
        assembly: '',
        stats: { instructions: 0, registers: 0, labels: 0, strings: 0, variables: 0 },
        error: `Error al generar código destino: ${e.message}`,
      };
    }
  }
}
