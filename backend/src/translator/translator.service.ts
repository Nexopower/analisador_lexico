import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';

type AstNode = { type: string; [key: string]: any };

export type TranslatorResult = {
  success: boolean;
  code: string;
  error?: string;
};

class CppGenerator {
  private indentLevel = 0;
  private declaredVars = new Set<string>();
  private scopeVarStack: Set<string>[] = [];

  // Qué necesita realmente el código generado (para emitir solo los #include usados)
  private needs = {
    iostream: false, // std::cout / std::endl
    string:   false, // std::string / std::to_string
    cmath:    false, // pow, sqrt, INFINITY, ...
    cstdlib:  false, // rand, RAND_MAX
    mpi:      false, // constante M_PI
    me:       false, // constante M_E
  };

  generate(ast: AstNode): string {
    const functionNodes: AstNode[] = [];
    const globals: string[] = [];

    for (const stmt of ast.body ?? []) {
      if (stmt.type === 'FunctionDef') {
        functionNodes.push(stmt);
      } else if (this.isMainGuard(stmt)) {
        for (const s of stmt.body ?? []) globals.push(...this.genStatement(s));
      } else {
        globals.push(...this.genStatement(stmt));
      }
    }

    // Sort so callee functions appear before caller functions
    const sortedFns = this.topoSort(functionNodes);

    // Forward declarations (safety net for mutual recursion / cycles)
    const fwdDecls: string[] = [];
    for (const fn of sortedFns) fwdDecls.push(...this.genForwardDecl(fn));

    // Full definitions in dependency order
    const functions: string[] = [];
    for (const fn of sortedFns) functions.push(...this.genFunctionDef(fn), '');

    // Solo los #include que el código traducido realmente usa
    const headers: string[] = [];
    if (this.needs.iostream) headers.push('#include <iostream>');
    if (this.needs.string)   headers.push('#include <string>');
    if (this.needs.cmath)    headers.push('#include <cmath>');
    if (this.needs.cstdlib)  headers.push('#include <cstdlib>');
    if (this.needs.mpi) headers.push('#ifndef M_PI', '#define M_PI 3.14159265358979323846', '#endif');
    if (this.needs.me)  headers.push('#ifndef M_E', '#define M_E 2.71828182845904523536', '#endif');

    const lines: string[] = ['// Compilar con: g++ -std=c++20 archivo.cpp -o programa'];
    if (headers.length)  lines.push(...headers);
    if (fwdDecls.length) lines.push('', ...fwdDecls);
    if (functions.length) lines.push('', ...functions);
    else lines.push('');

    lines.push('int main() {');
    for (const line of globals) lines.push('    ' + line);
    lines.push('    return 0;');
    lines.push('}');

    return lines.join('\n');
  }

  private pad(): string {
    return '    '.repeat(this.indentLevel);
  }

  private genForwardDecl(node: AstNode): string[] {
    const rawParams = (node.params ?? []) as any[];
    const pname = (p: any): string => typeof p === 'string' ? p : (p?.name ?? '?');
    const retType = this.hasReturnValue(node.body ?? []) ? 'auto' : 'void';
    if (rawParams.length > 0) {
      const tmpl   = `template<${rawParams.map((_, i) => `typename T${i}`).join(', ')}>`;
      const params = rawParams.map((p, i) => `T${i} ${pname(p)}`).join(', ');
      return [tmpl, `${retType} ${node.name}(${params});`];
    }
    return [`${retType} ${node.name}();`];
  }

  // Collect names of user-defined functions called within a set of AST nodes
  private collectCallDeps(nodes: AstNode[], userFns: Set<string>): Set<string> {
    const deps = new Set<string>();
    const walk = (node: AstNode) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
        if (userFns.has(node.callee.name)) deps.add(node.callee.name);
      }
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (Array.isArray(val)) val.forEach(v => v && typeof v === 'object' && walk(v as AstNode));
        else if (val && typeof val === 'object' && key !== 'parent') walk(val as AstNode);
      }
    };
    nodes.forEach(walk);
    return deps;
  }

  // Topological sort: callee functions come before caller functions
  private topoSort(functionNodes: AstNode[]): AstNode[] {
    const nameToNode = new Map<string, AstNode>();
    for (const fn of functionNodes) nameToNode.set(fn.name as string, fn);
    const userFns = new Set(nameToNode.keys());

    const deps = new Map<string, Set<string>>();
    for (const fn of functionNodes) {
      deps.set(fn.name as string, this.collectCallDeps(fn.body ?? [], userFns));
    }

    const sorted: AstNode[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name) || inStack.has(name)) return;
      inStack.add(name);
      for (const dep of deps.get(name) ?? []) visit(dep);
      inStack.delete(name);
      visited.add(name);
      const node = nameToNode.get(name);
      if (node) sorted.push(node);
    };

    for (const fn of functionNodes) visit(fn.name as string);
    return sorted;
  }

  // Detecta el patrón if __name__ == '__main__':
  private isMainGuard(node: AstNode): boolean {
    if (node.type !== 'IfStatement') return false;
    const t = node.test;
    return (
      t?.type === 'BinaryExpression' &&
      t.operator === '==' &&
      t.left?.type === 'Identifier' &&
      t.left.name === '__name__' &&
      t.right?.type === 'StringLiteral'
    );
  }

  // Infer si la función tiene algún return con valor
  private hasReturnValue(body: AstNode[]): boolean {
    for (const s of body) {
      if (s.type === 'ReturnStatement' && s.value) return true;
    }
    return false;
  }

  private genStatement(node: AstNode): string[] {
    if (!node) return [];
    switch (node.type) {
      case 'FunctionDef':         return this.genFunctionDef(node);
      case 'IfStatement':         return this.genIf(node);
      case 'WhileStatement':      return this.genWhile(node);
      case 'ReturnStatement':     return this.genReturn(node);
      case 'Assignment':          return this.genAssignment(node);
      case 'ExpressionStatement': return [`${this.pad()}${this.genExpr(node.expression)};`];
      default:                    return [];
    }
  }

  private genFunctionDef(node: AstNode): string[] {
    const rawParams = (node.params ?? []) as any[];
    const pname = (p: any): string => typeof p === 'string' ? p : (p?.name ?? '?');

    const retType  = this.hasReturnValue(node.body ?? []) ? 'auto' : 'void';
    const hasParams = rawParams.length > 0;
    const templateLine = hasParams
      ? [`template<${rawParams.map((_, i) => `typename T${i}`).join(', ')}>`]
      : [];
    const paramList = rawParams.map((p, i) => `T${i} ${pname(p)}`).join(', ');

    const lines: string[] = [
      ...templateLine,
      `${retType} ${node.name}(${paramList}) {`,
    ];

    this.scopeVarStack.push(new Set(this.declaredVars));
    this.declaredVars = new Set(rawParams.map(pname));
    this.indentLevel++;

    for (const stmt of node.body ?? []) lines.push(...this.genStatement(stmt));

    this.indentLevel--;
    this.declaredVars = this.scopeVarStack.pop()!;
    lines.push('}');
    return lines;
  }

  private genIf(node: AstNode): string[] {
    const lines: string[] = [`${this.pad()}if (${this.genExpr(node.test)}) {`];
    this.indentLevel++;
    for (const s of node.body ?? []) lines.push(...this.genStatement(s));
    this.indentLevel--;

    for (const elif of node.elifs ?? []) {
      lines.push(`${this.pad()}} else if (${this.genExpr(elif.test)}) {`);
      this.indentLevel++;
      for (const s of elif.body ?? []) lines.push(...this.genStatement(s));
      this.indentLevel--;
    }

    if (node.orelse?.length) {
      lines.push(`${this.pad()}} else {`);
      this.indentLevel++;
      for (const s of node.orelse) lines.push(...this.genStatement(s));
      this.indentLevel--;
    }

    lines.push(`${this.pad()}}`);
    return lines;
  }

  private genWhile(node: AstNode): string[] {
    const lines: string[] = [`${this.pad()}while (${this.genExpr(node.test)}) {`];
    this.indentLevel++;
    for (const s of node.body ?? []) lines.push(...this.genStatement(s));
    this.indentLevel--;
    lines.push(`${this.pad()}}`);
    return lines;
  }

  private genReturn(node: AstNode): string[] {
    return node.value
      ? [`${this.pad()}return ${this.genExpr(node.value)};`]
      : [`${this.pad()}return;`];
  }

  private genAssignment(node: AstNode): string[] {
    const val = this.genExpr(node.value);
    if (!this.declaredVars.has(node.target)) {
      this.declaredVars.add(node.target);
      return [`${this.pad()}auto ${node.target} = ${val};`];
    }
    return [`${this.pad()}${node.target} = ${val};`];
  }

  // Genera una expresión en contexto de cout (f-strings se separan con <<)
  private genExprForCout(node: AstNode): string {
    if (node?.type === 'StringLiteral') {
      const isFString = /^[fF]/.test(node.value);
      if (isFString) {
        return this.parseFStringForCout(node.value);
      }
    }
    return this.genExpr(node);
  }

  private genExpr(node: AstNode): string {
    if (!node) return '';
    switch (node.type) {
      case 'Identifier':    return node.name;
      case 'NumberLiteral': return node.value;

      case 'StringLiteral': return this.translateString(node.value);

      case 'Literal': {
        if (node.value === 'True')  return 'true';
        if (node.value === 'False') return 'false';
        if (node.value === 'None')  return 'nullptr';
        return node.value;
      }

      case 'BinaryExpression': {
        if (node.operator === '**') {
          this.needs.cmath = true;
          return `pow(${this.genExpr(node.left)}, ${this.genExpr(node.right)})`;
        }
        const op  = this.translateOp(node.operator);
        const lhs = this.genExpr(node.left);
        const rhs = this.genExpr(node.right);
        // "a" + "b" es inválido en C++ (const char* + const char*): envolver en std::string
        if (op === '+' && this.isRawStringLiteral(lhs) && this.isRawStringLiteral(rhs)) {
          this.needs.string = true;
          return `std::string(${lhs}) + ${rhs}`;
        }
        return `${lhs} ${op} ${rhs}`;
      }

      case 'UnaryExpression': {
        const op  = node.operator === 'not' ? '!' : node.operator;
        return `${op}${this.genExpr(node.argument)}`;
      }

      case 'Attribute': {
        const obj  = this.genExpr(node.object);
        const attr = node.attr ?? node.attribute ?? '';
        if (obj === 'math') {
          if (attr === 'pi')  { this.needs.mpi = true; return 'M_PI'; }
          if (attr === 'e')   { this.needs.me = true; return 'M_E'; }
          if (attr === 'inf') { this.needs.cmath = true; return 'INFINITY'; }
          if (attr === 'nan') { this.needs.cmath = true; return 'NAN'; }
          if (attr === 'tau') { this.needs.mpi = true; return '(2.0 * M_PI)'; }
        }
        if (obj === 'os') {
          if (attr === 'sep')     return '"/"';
          if (attr === 'linesep') return '"\\n"';
        }
        return `${obj}.${attr}`;
      }

      case 'CallExpression': {
        const args = (node.args ?? []) as AstNode[];

        // Handle module.method() calls (math.sqrt, random.randint, os.getcwd, etc.)
        if (node.callee?.type === 'Attribute') {
          const obj    = this.genExpr(node.callee.object);
          const method = node.callee.attr ?? node.callee.attribute ?? '';
          const argList = args.map(a => this.genExpr(a));
          const argStr  = argList.join(', ');

          if (obj === 'math') {
            const mathMap: Record<string, string> = {
              sqrt: 'sqrt', cbrt: 'cbrt', pow: 'pow',
              floor: 'floor', ceil: 'ceil', trunc: 'trunc', round: 'round',
              abs: 'fabs', fabs: 'fabs',
              log: 'log', log2: 'log2', log10: 'log10', exp: 'exp',
              sin: 'sin', cos: 'cos', tan: 'tan',
              asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2',
              sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
              hypot: 'hypot', fmod: 'fmod',
            };
            if (method in mathMap) {
              this.needs.cmath = true;
              return `${mathMap[method]}(${argStr})`;
            }
          }
          if (obj === 'random') {
            if (method === 'randint' && args.length === 2) {
              this.needs.cstdlib = true;
              return `(${argList[0]} + rand() % (${argList[1]} - ${argList[0]} + 1))`;
            }
            if (method === 'random' && args.length === 0) {
              this.needs.cstdlib = true;
              return '((double)rand() / RAND_MAX)';
            }
            if (method === 'uniform' && args.length === 2) {
              this.needs.cstdlib = true;
              return `(${argList[0]} + ((double)rand() / RAND_MAX) * (${argList[1]} - ${argList[0]}))`;
            }
          }
          if (obj === 'os') {
            if (method === 'getcwd') { this.needs.string = true; return 'std::string(".")'; }
          }
          return `${obj}.${method}(${argStr})`;
        }

        const callee = node.callee?.name ?? this.genExpr(node.callee);

        if (callee === 'print') {
          this.needs.iostream = true;
          if (args.length === 0) return 'std::cout << std::endl';
          const parts = args.map(a => this.genExprForCout(a));
          return `std::cout << ${parts.join(' << ')} << std::endl`;
        }
        if (callee === 'len'   && args.length === 1) return `${this.genExpr(args[0])}.size()`;
        if (callee === 'str'   && args.length === 1) {
          this.needs.string = true;
          return `std::to_string(${this.genExpr(args[0])})`;
        }
        if (callee === 'int'   && args.length === 1) return `static_cast<int>(${this.genExpr(args[0])})`;
        if (callee === 'float' && args.length === 1) return `static_cast<double>(${this.genExpr(args[0])})`;

        return `${callee}(${args.map(a => this.genExpr(a)).join(', ')})`;
      }

      case 'Grouping':
        return `(${this.genExpr(node.expression)})`;

      default:
        return '/* ? */';
    }
  }

  // Convierte un f-string completo para uso en cout: partes separadas con <<
  private parseFStringForCout(raw: string): string {
    const inner = this.extractStringInner(raw);
    const segments = this.splitFString(inner);
    return segments
      .map(s => s.isExpr ? s.value : `"${s.value.replace(/"/g, '\\"')}"`)
      .join(' << ');
  }

  // Convierte un f-string a concatenación de strings C++
  private parseFStringConcat(raw: string): string {
    const inner = this.extractStringInner(raw);
    const segments = this.splitFString(inner);
    if (segments.some(s => s.isExpr)) this.needs.string = true;
    if (segments.length === 1) {
      const s = segments[0];
      return s.isExpr ? `std::to_string(${s.value})` : `"${s.value.replace(/"/g, '\\"')}"`;
    }
    return segments
      .map(s => s.isExpr ? `std::to_string(${s.value})` : `"${s.value.replace(/"/g, '\\"')}"`)
      .join(' + ');
  }

  // Extrae el contenido interior de un string (sin prefijos ni comillas)
  private extractStringInner(raw: string): string {
    let s = raw.replace(/^[fFrRbBuU]+/, '');
    if (s.startsWith('"""') || s.startsWith("'''")) return s.slice(3, -3);
    return s.slice(1, -1);
  }

  // Divide un f-string en segmentos literales y expresiones {expr}
  private splitFString(inner: string): Array<{ isExpr: boolean; value: string }> {
    const result: Array<{ isExpr: boolean; value: string }> = [];
    const re = /\{([^}]+)\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      if (m.index > last) result.push({ isExpr: false, value: inner.slice(last, m.index) });
      result.push({ isExpr: true, value: m[1] });
      last = m.index + m[0].length;
    }
    if (last < inner.length) result.push({ isExpr: false, value: inner.slice(last) });
    return result;
  }

  // Traduce un string literal Python a string C++
  private translateString(raw: string): string {
    const isFString = /^[fF]/.test(raw);
    if (isFString) return this.parseFStringConcat(raw);

    const inner = this.extractStringInner(raw);
    // siempre usar comillas dobles en C++
    return `"${inner.replace(/"/g, '\\"')}"`;
  }

  // Detecta si el código generado es un literal string C puro (ej. "texto")
  private isRawStringLiteral(code: string): boolean {
    return /^"(?:[^"\\]|\\.)*"$/.test(code);
  }

  private translateOp(op: string): string {
    const map: Record<string, string> = {
      and:  '&&',
      or:   '||',
      not:  '!',
      '//': '/',
    };
    return map[op] ?? op;
  }
}

@Injectable()
export class TranslatorService {
  constructor(private readonly syntaxService: SyntaxService) {}

  translateFromAst(ast: AstNode): TranslatorResult {
    try {
      const gen = new CppGenerator();
      return { success: true, code: gen.generate(ast) };
    } catch (e: any) {
      return { success: false, code: '', error: `Error al generar C++: ${e.message}` };
    }
  }

  async translate(code: string): Promise<TranslatorResult> {
    const syntaxResult = await this.syntaxService.analyze(code);

    if (!syntaxResult.success || !syntaxResult.ast) {
      return {
        success: false,
        code: '',
        error: 'No se puede traducir: el código tiene errores sintácticos.',
      };
    }

    try {
      const gen = new CppGenerator();
      const cpp = gen.generate(syntaxResult.ast as AstNode);
      return { success: true, code: cpp };
    } catch (e: any) {
      return { success: false, code: '', error: `Error interno al traducir: ${e.message}` };
    }
  }
}
