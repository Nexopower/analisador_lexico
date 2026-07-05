import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';

type AstNode = { type: string; [key: string]: any };

type SymbolInfo = {
  name: string;
  kind: 'function' | 'variable' | 'parameter' | 'class' | 'import';
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

const BUILTINS = new Set([
  'print', 'input', 'len', 'range', 'int', 'float', 'str', 'bool',
  'list', 'dict', 'set', 'tuple', 'type', 'isinstance', 'issubclass',
  'abs', 'max', 'min', 'sum', 'sorted', 'reversed', 'enumerate', 'zip',
  'map', 'filter', 'any', 'all', 'open', 'repr', 'id', 'hex', 'oct',
  'bin', 'round', 'pow', 'divmod', 'hash', 'chr', 'ord', 'format',
  'hasattr', 'getattr', 'setattr', 'delattr', 'callable', 'iter', 'next',
  'vars', 'dir', 'exec', 'eval', 'compile', 'globals', 'locals',
  'staticmethod', 'classmethod', 'property', 'super', 'object',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
  'AttributeError', 'NameError', 'RuntimeError', 'StopIteration',
  'NotImplementedError', 'OSError', 'IOError', 'FileNotFoundError',
  'ZeroDivisionError', 'OverflowError', 'MemoryError', 'RecursionError',
  '__name__', '__file__', '__doc__', '__package__', '__spec__',
  '__builtins__', '__main__', 'True', 'False', 'None', 'NotImplemented',
  'Ellipsis', '__import__', 'breakpoint',
]);

class SemanticAnalyzer {
  private errors: SemanticDiagnostic[] = [];
  private warnings: SemanticDiagnostic[] = [];
  private symbols: Map<string, SymbolInfo> = new Map();
  private scopeStack: string[] = ['global'];
  private insideFunction = false;
  private insideLoop = false;
  private functionSignatures: Map<string, { min: number; hasVarArgs: boolean }> = new Map();

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
    if (!name || typeof name !== 'string') return;
    const scope = kind === 'function' || kind === 'class' ? 'global' : this.currentScope();
    const key = this.symbolKey(name, scope);
    if (this.symbols.has(key)) {
      const existing = this.symbols.get(key)!;
      if ((existing.kind === 'function' && kind === 'function') ||
          (existing.kind === 'class' && kind === 'class')) {
        this.errors.push({
          message: `'${name}' ya fue definido en el ámbito '${scope}'`,
          line,
          column,
        });
      } else if (existing.kind === 'variable' && kind === 'variable') {
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
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const key = this.symbolKey(name, this.scopeStack[i]);
      if (this.symbols.has(key)) {
        const sym = this.symbols.get(key)!;
        sym.usages++;
        return sym;
      }
    }
    if (BUILTINS.has(name)) return null;
    this.errors.push({ message: `Nombre '${name}' no está definido`, line, column });
    return null;
  }

  private visitProgram(node: AstNode): void {
    // Pre-register top-level functions, classes, and imports for forward references
    for (const stmt of node.body ?? []) {
      if (stmt.type === 'FunctionDef') {
        const sig = this.buildSignature(stmt.params ?? []);
        this.functionSignatures.set(stmt.name, sig);
        this.declare(stmt.name, 'function', 'función', stmt.line, stmt.column);
      } else if (stmt.type === 'ClassDef') {
        this.declare(stmt.name, 'class', 'clase', stmt.line, stmt.column);
      } else if (stmt.type === 'ImportStatement') {
        for (const n of stmt.names ?? []) {
          const sym = n.alias ?? (n.name as string).split('.')[0];
          this.declare(sym, 'import', 'módulo', stmt.line);
        }
      } else if (stmt.type === 'FromImportStatement') {
        for (const n of stmt.names ?? []) {
          if (n.name === '*') continue;
          const sym = n.alias ?? n.name;
          this.declare(sym, 'import', 'import', stmt.line);
        }
      }
    }
    for (const stmt of node.body ?? []) {
      this.visitStatement(stmt);
    }
  }

  private buildSignature(params: AstNode[]): { min: number; hasVarArgs: boolean } {
    let min = 0;
    let hasVarArgs = false;
    for (const p of params) {
      const kind = p.kind ?? 'positional';
      if (kind === 'args' || kind === 'kwargs') { hasVarArgs = true; continue; }
      if (kind === 'bare_star') continue;
      if (p.default) continue; // optional
      min++;
    }
    return { min, hasVarArgs };
  }

  private visitStatement(node: AstNode): void {
    if (!node) return;
    switch (node.type) {
      case 'FunctionDef':          return this.visitFunctionDef(node);
      case 'ClassDef':             return this.visitClassDef(node);
      case 'IfStatement':          return this.visitIf(node);
      case 'WhileStatement':       return this.visitWhile(node);
      case 'ForStatement':         return this.visitFor(node);
      case 'TryStatement':         return this.visitTry(node);
      case 'WithStatement':        return this.visitWith(node);
      case 'ReturnStatement':      return this.visitReturn(node);
      case 'Assignment':           return this.visitAssignment(node);
      case 'AugmentedAssignment':  return this.visitAugAssignment(node);
      case 'AnnotatedAssignment':  return this.visitAnnotatedAssignment(node);
      case 'MultiAssignment':      return this.visitMultiAssignment(node);
      case 'ImportStatement':      return this.visitImport(node);
      case 'FromImportStatement':  return this.visitFromImport(node);
      case 'GlobalStatement':      return this.visitGlobal(node);
      case 'NonlocalStatement':    return this.visitNonlocal(node);
      case 'DeleteStatement':
        for (const t of node.targets ?? []) this.visitExpression(t);
        return;
      case 'AssertStatement':
        this.visitExpression(node.test);
        if (node.msg) this.visitExpression(node.msg);
        return;
      case 'RaiseStatement':
        if (node.exc) this.visitExpression(node.exc);
        if (node.cause) this.visitExpression(node.cause);
        return;
      case 'YieldExpression':
      case 'YieldFrom':
        if (node.value) this.visitExpression(node.value);
        return;
      case 'ExpressionStatement':
        this.visitExpression(node.expression);
        return;
      case 'PassStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'StatementList':
        for (const s of node.body ?? []) this.visitStatement(s);
        return;
    }
  }

  private visitFunctionDef(node: AstNode): void {
    this.scopeStack.push(node.name ?? 'anonymous');
    const wasInside = this.insideFunction;
    this.insideFunction = true;

    for (const param of node.params ?? []) {
      const paramName = typeof param === 'string' ? param : param.name;
      if (paramName) this.declare(paramName, 'parameter', 'desconocido', param.line);
    }

    // Pre-register nested functions
    for (const stmt of node.body ?? []) {
      if (stmt.type === 'FunctionDef') {
        const sig = this.buildSignature(stmt.params ?? []);
        this.functionSignatures.set(`${node.name}.${stmt.name}`, sig);
        this.declare(stmt.name, 'function', 'función', stmt.line, stmt.column);
      }
    }

    this.visitBlock(node.body ?? []);

    this.insideFunction = wasInside;
    this.scopeStack.pop();
  }

  private visitClassDef(node: AstNode): void {
    this.scopeStack.push(node.name ?? 'anonymous_class');
    for (const base of node.bases ?? []) this.visitExpression(base);
    for (const stmt of node.body ?? []) this.visitStatement(stmt);
    this.scopeStack.pop();
  }

  private visitIf(node: AstNode): void {
    this.visitExpression(node.test);
    this.visitBlock(node.body ?? []);
    for (const elif of node.elifs ?? []) {
      this.visitExpression(elif.test);
      this.visitBlock(elif.body ?? []);
    }
    if (node.orelse?.length) this.visitBlock(node.orelse);
  }

  private visitWhile(node: AstNode): void {
    this.visitExpression(node.test);
    const wasInLoop = this.insideLoop;
    this.insideLoop = true;
    this.visitBlock(node.body ?? []);
    this.insideLoop = wasInLoop;
    if (node.orelse?.length) this.visitBlock(node.orelse);
  }

  private visitFor(node: AstNode): void {
    this.visitExpression(node.iter);
    this.declareTarget(node.target);
    const wasInLoop = this.insideLoop;
    this.insideLoop = true;
    this.visitBlock(node.body ?? []);
    this.insideLoop = wasInLoop;
    if (node.orelse?.length) this.visitBlock(node.orelse);
  }

  private declareTarget(target: AstNode): void {
    if (!target) return;
    if (target.type === 'Identifier') {
      this.declare(target.name, 'variable', 'desconocido', target.line, target.column);
    } else if (target.type === 'Tuple' || target.type === 'ListExpression') {
      for (const el of target.elements ?? []) this.declareTarget(el);
    }
  }

  private visitTry(node: AstNode): void {
    this.visitBlock(node.body ?? []);
    for (const handler of node.handlers ?? []) {
      if (handler.type_) this.visitExpression(handler.type_);
      if (handler.name) this.declare(handler.name, 'variable', 'excepción', handler.line);
      this.visitBlock(handler.body ?? []);
    }
    if (node.orelse?.length) this.visitBlock(node.orelse);
    if (node.finalbody?.length) this.visitBlock(node.finalbody);
  }

  private visitWith(node: AstNode): void {
    for (const item of node.items ?? []) {
      this.visitExpression(item.context);
      if (item.target) this.declareTarget(item.target);
    }
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
    const name = typeof node.target === 'string' ? node.target : null;
    if (name) {
      this.declare(name, 'variable', valueType, node.line, node.column);
    } else if (node.targetNode) {
      this.declareTarget(node.targetNode);
    }
    this.visitExpression(node.value);
  }

  private visitAugAssignment(node: AstNode): void {
    if (node.target?.type === 'Identifier') {
      this.resolve(node.target.name, node.target.line, node.target.column);
    } else {
      this.visitExpression(node.target);
    }
    this.visitExpression(node.value);
    if ((node.operator === '/=' || node.operator === '//=') &&
        node.value?.type === 'NumberLiteral' && Number(node.value.value) === 0) {
      this.errors.push({ message: 'División por cero detectada', line: node.value.line });
    }
  }

  private visitAnnotatedAssignment(node: AstNode): void {
    const name = node.target?.type === 'Identifier' ? node.target.name : null;
    const valueType = node.value ? this.inferType(node.value) : 'desconocido';
    if (name) this.declare(name, 'variable', valueType, node.line);
    if (node.value) this.visitExpression(node.value);
  }

  private visitMultiAssignment(node: AstNode): void {
    const valueType = this.inferType(node.value);
    for (const tgt of node.targets ?? []) {
      if (tgt.type === 'Identifier') {
        this.declare(tgt.name, 'variable', valueType, tgt.line);
      }
    }
    this.visitExpression(node.value);
  }

  private visitImport(node: AstNode): void {
    for (const n of node.names ?? []) {
      const sym = n.alias ?? (n.name as string).split('.')[0];
      this.declare(sym, 'import', 'módulo', node.line);
    }
  }

  private visitFromImport(node: AstNode): void {
    for (const n of node.names ?? []) {
      if (n.name === '*') continue;
      const sym = n.alias ?? n.name;
      this.declare(sym, 'import', 'import', node.line);
    }
  }

  private visitGlobal(node: AstNode): void {
    for (const name of node.names ?? []) {
      if (!this.symbols.has(this.symbolKey(name, 'global'))) {
        this.declare(name, 'variable', 'desconocido', node.line);
      }
    }
  }

  private visitNonlocal(node: AstNode): void {
    // nonlocal just references an enclosing scope variable — resolve to check it exists
    for (const name of node.names ?? []) {
      let found = false;
      for (let i = this.scopeStack.length - 2; i >= 0; i--) {
        if (this.symbols.has(this.symbolKey(name, this.scopeStack[i]))) { found = true; break; }
      }
      if (!found) {
        this.warnings.push({ message: `'nonlocal ${name}': no se encontró en ámbitos superiores`, line: node.line });
      }
    }
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
        this.visitExpression(node.argument ?? node.operand);
        break;

      case 'CallExpression':
        this.visitCall(node);
        break;

      case 'Attribute':
        this.visitExpression(node.object);
        break;

      case 'Subscript':
        this.visitExpression(node.object);
        this.visitExpression(node.slice);
        break;

      case 'Slice':
        if (node.lower) this.visitExpression(node.lower);
        if (node.upper) this.visitExpression(node.upper);
        if (node.step)  this.visitExpression(node.step);
        break;

      case 'TernaryExpression':
        this.visitExpression(node.test);
        this.visitExpression(node.consequent ?? node.body);
        this.visitExpression(node.alternate ?? node.orelse);
        break;

      case 'Lambda': {
        this.scopeStack.push('lambda');
        for (const p of node.params ?? []) {
          const n = typeof p === 'string' ? p : p.name;
          if (n) this.declare(n, 'parameter', 'desconocido');
        }
        this.visitExpression(node.body);
        this.scopeStack.pop();
        break;
      }

      case 'NamedExpr': // walrus operator :=
        this.visitExpression(node.value);
        if (node.target?.type === 'Identifier') {
          this.declare(node.target.name, 'variable', this.inferType(node.value), node.target.line);
        }
        break;

      case 'Await':
        this.visitExpression(node.value);
        break;

      case 'StarExpression':
      case 'StarArg':
        this.visitExpression(node.value);
        break;

      case 'KeywordArg':
        this.visitExpression(node.value);
        break;

      case 'Grouping':
        this.visitExpression(node.expression);
        break;

      case 'Tuple':
      case 'ListExpression':
      case 'SetExpression':
        for (const el of node.elements ?? []) this.visitExpression(el);
        break;

      case 'DictExpression':
        for (const entry of node.entries ?? []) {
          if (entry.key) this.visitExpression(entry.key);
          this.visitExpression(entry.value);
        }
        break;

      case 'ListComprehension':
      case 'SetComprehension':
      case 'GeneratorExpression': {
        this.scopeStack.push('comprehension');
        for (const gen of node.generators ?? []) {
          this.visitExpression(gen.iter);
          this.declareTarget(gen.target);
          for (const cond of gen.ifs ?? []) this.visitExpression(cond);
        }
        this.visitExpression(node.elt ?? node.element);
        this.scopeStack.pop();
        break;
      }

      case 'DictComprehension': {
        this.scopeStack.push('comprehension');
        for (const gen of node.generators ?? []) {
          this.visitExpression(gen.iter);
          this.declareTarget(gen.target);
          for (const cond of gen.ifs ?? []) this.visitExpression(cond);
        }
        this.visitExpression(node.key);
        this.visitExpression(node.value);
        this.scopeStack.pop();
        break;
      }

      case 'NumberLiteral':
      case 'StringLiteral':
      case 'Literal':
      case 'AdjacentString':
        break; // primitives — nothing to check
    }
  }

  private visitCall(node: AstNode): void {
    const callee = node.callee;
    if (callee?.type === 'Identifier') {
      const name: string = callee.name;
      if (!BUILTINS.has(name)) {
        this.resolve(name, callee.line, callee.column);
        if (this.functionSignatures.has(name)) {
          const sig = this.functionSignatures.get(name)!;
          const positionalCount = (node.args ?? []).filter(
            (a: AstNode) => a.type !== 'StarArg' && a.type !== 'KeywordArg'
          ).length;
          if (!sig.hasVarArgs && positionalCount < sig.min) {
            this.errors.push({
              message: `La función '${name}' requiere al menos ${sig.min} argumento(s) pero se le pasaron ${positionalCount}`,
              line: callee.line,
              column: callee.column,
            });
          }
        }
      }
    } else {
      this.visitExpression(callee);
    }
    for (const arg of node.args ?? []) this.visitExpression(arg);
    for (const kw of node.keywords ?? []) this.visitExpression(kw.value);
  }

  private checkTypeCompatibility(node: AstNode): void {
    const ARITHMETIC_OPS = ['+', '-', '*', '/', '//', '%', '**'];
    if (!ARITHMETIC_OPS.includes(node.operator)) return;
    const left = this.inferType(node.left);
    const right = this.inferType(node.right);
    if (left === 'desconocido' || right === 'desconocido') return;
    const numeric = new Set(['int', 'float']);
    if (node.operator === '+' && left === 'str' && right === 'str') return;
    if (node.operator === '*' && ((left === 'str' && right === 'int') || (left === 'int' && right === 'str'))) return;
    if (numeric.has(left) !== numeric.has(right) || (left === 'str') !== (right === 'str')) {
      this.errors.push({
        message: `Operación '${node.operator}' entre tipos incompatibles: '${left}' y '${right}'`,
        line: node.left?.line ?? node.right?.line,
        column: node.left?.column ?? node.right?.column,
      });
    }
  }

  private checkDivisionByZero(node: AstNode): void {
    if ((node.operator === '/' || node.operator === '//' || node.operator === '%') &&
        node.right?.type === 'NumberLiteral' && Number(node.right.value) === 0) {
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
      case 'ListExpression':   return 'list';
      case 'DictExpression':   return 'dict';
      case 'SetExpression':    return 'set';
      case 'Tuple':            return 'tuple';
      case 'ListComprehension':return 'list';
      case 'DictComprehension':return 'dict';
      case 'SetComprehension': return 'set';
      case 'GeneratorExpression': return 'generator';
      case 'Lambda':           return 'function';
      case 'BinaryExpression': {
        const l = this.inferType(node.left);
        const r = this.inferType(node.right);
        if (l === r) return l;
        if ((l === 'int' && r === 'float') || (l === 'float' && r === 'int')) return 'float';
        if (['==','!=','<','<=','>','>=','and','or','not','in','is','not in','is not'].includes(node.operator)) return 'bool';
        return 'desconocido';
      }
      case 'UnaryExpression':
        if (node.operator === 'not') return 'bool';
        return this.inferType(node.argument ?? node.operand);
      case 'TernaryExpression': {
        const t = this.inferType(node.consequent ?? node.body);
        const f = this.inferType(node.alternate ?? node.orelse);
        return t === f ? t : 'desconocido';
      }
      case 'CallExpression': return 'desconocido';
      case 'Attribute':      return 'desconocido';
      case 'Subscript':      return 'desconocido';
      case 'Identifier': {
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

    try {
      const analyzer = new SemanticAnalyzer();
      return analyzer.analyze(syntaxResult.ast as AstNode);
    } catch (e: any) {
      return {
        success: false,
        errors: [{ message: `Error interno en análisis semántico: ${e.message}` }],
        warnings: [],
        symbolTable: [],
      };
    }
  }
}
