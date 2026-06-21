import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';

type AstNode = { type: string; [key: string]: any };

type SymbolInfo = {
  name: string;
  kind: 'function' | 'variable' | 'parameter';
  scope: string;
  inferredType: string;
  line?: number;
  column?: number;
  usages: number;
};

type SemanticDiagnostic = {
  message: string;
  line?: number;
  column?: number;
};

export type SemanticResult = {
  success: boolean;
  errors: SemanticDiagnostic[];
  warnings: SemanticDiagnostic[];
  symbolTable: SymbolInfo[];
};

// Built-in Python functions that are always available
const BUILTINS = new Set([
  'print', 'input', 'len', 'range', 'int', 'float', 'str', 'bool',
  'list', 'dict', 'set', 'tuple', 'type', 'isinstance', 'abs', 'max',
  'min', 'sum', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter',
  'open', 'repr', 'id', 'hex', 'oct', 'bin', 'round', 'pow', 'divmod',
  'hasattr', 'getattr', 'setattr', 'delattr', 'callable', 'iter', 'next',
  '__name__', '__main__',
]);

class SemanticAnalyzer {
  private errors: SemanticDiagnostic[] = [];
  private warnings: SemanticDiagnostic[] = [];
  private symbols: Map<string, SymbolInfo> = new Map();

  // key: "scope::name" → SymbolInfo
  private scopeStack: string[] = ['global'];
  private insideFunction = false;
  // functionName → param count
  private functionSignatures: Map<string, number> = new Map();

  analyze(ast: AstNode): SemanticResult {
    this.visitProgram(ast);
    return {
      success: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      symbolTable: Array.from(this.symbols.values()),
    };
  }

  private currentScope(): string {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  private symbolKey(name: string, scope: string): string {
    return `${scope}::${name}`;
  }

  private declare(
    name: string,
    kind: SymbolInfo['kind'],
    inferredType: string,
    line?: number,
    column?: number,
  ): void {
    const scope = kind === 'function' ? 'global' : this.currentScope();
    const key = this.symbolKey(name, scope);
    if (this.symbols.has(key)) {
      const existing = this.symbols.get(key)!;
      if (existing.kind === 'function' && kind === 'function') {
        this.errors.push({
          message: `La función '${name}' ya fue definida en el ámbito '${scope}'`,
          line,
          column,
        });
      } else if (existing.kind !== 'function' && kind === 'variable') {
        // re-assignment: check type change
        if (existing.inferredType !== 'desconocido' && inferredType !== 'desconocido' && existing.inferredType !== inferredType) {
          this.warnings.push({
            message: `Variable '${name}' reasignada: tipo anterior '${existing.inferredType}', nuevo tipo '${inferredType}'`,
            line,
            column,
          });
        }
        existing.inferredType = inferredType;
      }
      return;
    }
    this.symbols.set(key, { name, kind, scope, inferredType, line, column, usages: 0 });
  }

  private resolve(name: string, line?: number, column?: number): SymbolInfo | null {
    // Look in current scope, then global, then builtins
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const key = this.symbolKey(name, this.scopeStack[i]);
      if (this.symbols.has(key)) {
        const sym = this.symbols.get(key)!;
        sym.usages++;
        return sym;
      }
    }
    if (BUILTINS.has(name)) return null; // known builtin, no error
    this.errors.push({
      message: `Nombre '${name}' no está definido`,
      line,
      column,
    });
    return null;
  }

  private visitProgram(node: AstNode): void {
    // First pass: register all top-level function names so calls can appear before defs
    for (const stmt of node.body ?? []) {
      if (stmt.type === 'FunctionDef' && stmt.name) {
        this.functionSignatures.set(stmt.name, (stmt.params ?? []).length);
        this.declare(stmt.name, 'function', 'función', stmt.line, stmt.column);
      }
    }
    for (const stmt of node.body ?? []) {
      this.visitStatement(stmt);
    }
  }

  private visitStatement(node: AstNode): void {
    if (!node) return;
    switch (node.type) {
      case 'FunctionDef':   return this.visitFunctionDef(node);
      case 'IfStatement':   return this.visitIf(node);
      case 'WhileStatement':return this.visitWhile(node);
      case 'ReturnStatement': return this.visitReturn(node);
      case 'Assignment':    return this.visitAssignment(node);
      case 'ExpressionStatement': this.visitExpression(node.expression); return;
    }
  }

  private visitFunctionDef(node: AstNode): void {
    this.scopeStack.push(node.name ?? 'anonymous');
    const wasInside = this.insideFunction;
    this.insideFunction = true;

    for (const param of node.params ?? []) {
      this.declare(param, 'parameter', 'desconocido');
    }

    this.visitBlock(node.body ?? []);

    this.insideFunction = wasInside;
    this.scopeStack.pop();
  }

  private visitIf(node: AstNode): void {
    this.visitExpression(node.test);
    this.visitBlock(node.body ?? []);
    for (const elif of node.elifs ?? []) {
      this.visitExpression(elif.test);
      this.visitBlock(elif.body ?? []);
    }
    if (node.orelse) this.visitBlock(node.orelse);
  }

  private visitWhile(node: AstNode): void {
    this.visitExpression(node.test);
    this.visitBlock(node.body ?? []);
  }

  private visitReturn(node: AstNode): void {
    if (!this.insideFunction) {
      this.errors.push({ message: "'return' fuera de una función", line: node.line, column: node.column });
    }
    if (node.value) this.visitExpression(node.value);
  }

  private visitAssignment(node: AstNode): void {
    const valueType = this.inferType(node.value);
    this.declare(node.target, 'variable', valueType);
    this.visitExpression(node.value);
  }

  private visitBlock(stmts: AstNode[]): void {
    let returned = false;
    for (const stmt of stmts) {
      if (returned) {
        this.warnings.push({ message: 'Código inalcanzable después de un return', line: stmt.line, column: stmt.column });
        break;
      }
      this.visitStatement(stmt);
      if (stmt?.type === 'ReturnStatement') returned = true;
    }
  }

  private visitExpression(node: AstNode): void {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        this.resolve(node.name, node.line, node.column);
        break;
      case 'BinaryExpression':
        this.visitExpression(node.left);
        this.visitExpression(node.right);
        this.checkDivisionByZero(node);
        this.checkTypeCompatibility(node);
        break;
      case 'UnaryExpression':
        this.visitExpression(node.argument);
        break;
      case 'CallExpression':
        this.visitCall(node);
        break;
      case 'Grouping':
        this.visitExpression(node.expression);
        break;
    }
  }

  private visitCall(node: AstNode): void {
    const callee = node.callee;
    if (callee?.type === 'Identifier') {
      const name: string = callee.name;
      if (!BUILTINS.has(name)) {
        this.resolve(name, callee.line, callee.column);
        if (this.functionSignatures.has(name)) {
          const expected = this.functionSignatures.get(name)!;
          const got = (node.args ?? []).length;
          if (got !== expected) {
            this.errors.push({
              message: `La función '${name}' espera ${expected} argumento(s) pero se le pasaron ${got}`,
              line: callee.line,
              column: callee.column,
            });
          }
        }
      }
    } else {
      this.visitExpression(callee);
    }
    for (const arg of node.args ?? []) {
      this.visitExpression(arg);
    }
  }

  private checkTypeCompatibility(node: AstNode): void {
    const ARITHMETIC_OPS = ['+', '-', '*', '/', '//', '%', '**'];
    if (!ARITHMETIC_OPS.includes(node.operator)) return;

    const left = this.inferType(node.left);
    const right = this.inferType(node.right);

    if (left === 'desconocido' || right === 'desconocido') return;

    const numeric = new Set(['int', 'float']);
    const leftNum = numeric.has(left);
    const rightNum = numeric.has(right);

    // str + str is valid (concatenation), str * int is valid (repetition)
    if (node.operator === '+' && left === 'str' && right === 'str') return;
    if (node.operator === '*' && ((left === 'str' && right === 'int') || (left === 'int' && right === 'str'))) return;

    if (leftNum !== rightNum || (left === 'str' && right !== 'str') || (right === 'str' && left !== 'str')) {
      this.errors.push({
        message: `Operación '${node.operator}' entre tipos incompatibles: '${left}' y '${right}'`,
        line: node.left?.line ?? node.right?.line,
        column: node.left?.column ?? node.right?.column,
      });
    }
  }

  private checkDivisionByZero(node: AstNode): void {
    if ((node.operator === '/' || node.operator === '//' || node.operator === '%') &&
        node.right?.type === 'NumberLiteral' &&
        Number(node.right.value) === 0) {
      this.errors.push({ message: 'División por cero detectada', line: node.right?.line, column: node.right?.column });
    }
  }

  private inferType(node: AstNode): string {
    if (!node) return 'desconocido';
    switch (node.type) {
      case 'NumberLiteral': return node.value?.includes('.') ? 'float' : 'int';
      case 'StringLiteral': return 'str';
      case 'Literal':
        if (node.value === 'True' || node.value === 'False') return 'bool';
        if (node.value === 'None') return 'NoneType';
        return 'desconocido';
      case 'BinaryExpression': {
        const l = this.inferType(node.left);
        const r = this.inferType(node.right);
        if (l === r) return l;
        if ((l === 'int' && r === 'float') || (l === 'float' && r === 'int')) return 'float';
        if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not', 'in', 'is'].includes(node.operator)) return 'bool';
        return 'desconocido';
      }
      case 'UnaryExpression':
        if (node.operator === 'not') return 'bool';
        return this.inferType(node.argument);
      case 'CallExpression': return 'desconocido';
      case 'Identifier': {
        // Try to look up from symbol table
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
          const key = this.symbolKey(node.name, this.scopeStack[i]);
          if (this.symbols.has(key)) return this.symbols.get(key)!.inferredType;
        }
        return 'desconocido';
      }
      default: return 'desconocido';
    }
  }
}

@Injectable()
export class SemanticService {
  constructor(private readonly syntaxService: SyntaxService) {}

  async analyze(code: string): Promise<SemanticResult> {
    const syntaxResult = await this.syntaxService.analyze(code);

    if (!syntaxResult.success || !syntaxResult.ast) {
      return {
        success: false,
        errors: [{ message: 'No se puede analizar semánticamente: el código tiene errores sintácticos' }],
        warnings: [],
        symbolTable: [],
      };
    }

    const analyzer = new SemanticAnalyzer();
    return analyzer.analyze(syntaxResult.ast as AstNode);
  }
}
