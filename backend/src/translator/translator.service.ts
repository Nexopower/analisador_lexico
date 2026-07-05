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

  generate(ast: AstNode): string {
    const functions: string[] = [];
    const globals: string[] = [];

    for (const stmt of ast.body ?? []) {
      if (stmt.type === 'FunctionDef') {
        functions.push(...this.genFunctionDef(stmt), '');
      } else if (this.isMainGuard(stmt)) {
        // if __name__ == '__main__': → unwrap body into main()
        for (const s of stmt.body ?? []) globals.push(...this.genStatement(s));
      } else {
        globals.push(...this.genStatement(stmt));
      }
    }

    const lines: string[] = [
      '// Compilar con: g++ -std=c++20 archivo.cpp -o programa',
      '#include <iostream>',
      '#include <string>',
      '',
      ...functions,
    ];

    lines.push('int main() {');
    for (const line of globals) lines.push('    ' + line);
    lines.push('    return 0;');
    lines.push('}');

    return lines.join('\n');
  }

  private pad(): string {
    return '    '.repeat(this.indentLevel);
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
    const params = (node.params ?? []).map((p: string) => `auto ${p}`).join(', ');
    const retType = this.hasReturnValue(node.body ?? []) ? 'auto' : 'void';

    // template si tiene parámetros (auto params requiere C++20 o template)
    const templateLine = (node.params ?? []).length > 0
      ? [`template<${(node.params ?? []).map((_: string, i: number) => `typename T${i}`).join(', ')}>`]
      : [];
    const paramList = (node.params ?? []).map((p: string, i: number) =>
      (node.params ?? []).length > 0 ? `T${i} ${p}` : `auto ${p}`
    ).join(', ');

    const lines: string[] = [
      ...templateLine,
      `${retType} ${node.name}(${paramList}) {`,
    ];

    this.scopeVarStack.push(new Set(this.declaredVars));
    this.declaredVars = new Set(node.params ?? []);
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
        const op  = this.translateOp(node.operator);
        const lhs = this.genExpr(node.left);
        const rhs = this.genExpr(node.right);
        return `${lhs} ${op} ${rhs}`;
      }

      case 'UnaryExpression': {
        const op  = node.operator === 'not' ? '!' : node.operator;
        return `${op}${this.genExpr(node.argument)}`;
      }

      case 'CallExpression': {
        const callee = node.callee?.name ?? this.genExpr(node.callee);
        const args   = (node.args ?? []) as AstNode[];

        if (callee === 'print') {
          if (args.length === 0) return 'std::cout << std::endl';
          const parts = args.map(a => this.genExprForCout(a));
          return `std::cout << ${parts.join(' << ')} << std::endl`;
        }
        if (callee === 'len'   && args.length === 1) return `${this.genExpr(args[0])}.size()`;
        if (callee === 'str'   && args.length === 1) return `std::to_string(${this.genExpr(args[0])})`;
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

  private translateOp(op: string): string {
    const map: Record<string, string> = {
      and:  '&&',
      or:   '||',
      not:  '!',
      '//': '/',
      '**': '/* ** no soportado en C++ */',
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
