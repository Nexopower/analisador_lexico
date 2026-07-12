import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';
import { TranslatorService } from '../translator/translator.service';

type AstNode = { type: string; [key: string]: any };
type ConstEnv = Map<string, AstNode>;

export type OptimizationChange = {
  pass: string;
  description: string;
  line?: number;
};

export type OptimizerResult = {
  success: boolean;
  optimizedCpp: string;
  changes: OptimizationChange[];
  totalChanges: number;
  passesRun: number;
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// AST Optimizer — applies classic compiler optimization passes on the AST
// ─────────────────────────────────────────────────────────────────────────────
export class AstOptimizer {
  private changes: OptimizationChange[] = [];

  optimize(ast: AstNode): { ast: AstNode; changes: OptimizationChange[]; passesRun: number } {
    this.changes = [];
    let passesRun = 0;
    let prev = '';
    let curr = JSON.stringify(ast);

    while (prev !== curr && passesRun < 8) {
      prev = curr;
      passesRun++;
      const body = this.optimizeStmts(ast.body ?? [], new Map());
      ast = { ...ast, body };
      curr = JSON.stringify(ast);
    }

    return { ast, changes: this.changes, passesRun };
  }

  // ── Statement list ────────────────────────────────────────────────────────

  private optimizeStmts(stmts: AstNode[], env: ConstEnv): AstNode[] {
    const result: AstNode[] = [];
    let stopped = false;

    for (let i = 0; i < stmts.length && !stopped; i++) {
      const stmt = stmts[i];

      // ── static if branch elimination ──────────────────────────────────────
      if (stmt.type === 'IfStatement') {
        const test = this.optimizeExpr(stmt.test, env);
        if (this.isAlwaysTrue(test)) {
          this.addChange('Eliminación de código muerto',
            `'if True:' → se conserva solo la rama verdadera`, stmt.line);
          result.push(...this.optimizeStmts(stmt.body ?? [], new Map(env)));
          continue;
        }
        if (this.isAlwaysFalse(test)) {
          if (stmt.orelse?.length) {
            this.addChange('Eliminación de código muerto',
              `'if False:' → se conserva solo la rama 'else'`, stmt.line);
            result.push(...this.optimizeStmts(stmt.orelse, new Map(env)));
          } else {
            this.addChange('Eliminación de código muerto',
              `'if False:' sin else → bloque eliminado`, stmt.line);
          }
          continue;
        }
        result.push(this.optimizeIfStmt(stmt, test, env));
        continue;
      }

      // ── static while elimination ──────────────────────────────────────────
      if (stmt.type === 'WhileStatement') {
        // Variables modified inside the loop cannot be treated as constants in the condition
        const mutated = this.collectMutatedVars(stmt.body ?? []);
        const condEnv = new Map(env);
        for (const v of mutated) condEnv.delete(v);

        const test = this.optimizeExpr(stmt.test, condEnv);
        if (this.isAlwaysFalse(test)) {
          this.addChange('Eliminación de código muerto',
            `'while False:' → bucle eliminado`, stmt.line);
          continue;
        }
        // After the loop the mutated variables have unknown values — invalidate them
        for (const v of mutated) env.delete(v);
        result.push({ ...stmt, test, body: this.optimizeStmts(stmt.body ?? [], new Map()) });
        continue;
      }

      // ── for loop ─────────────────────────────────────────────────────────
      if (stmt.type === 'ForStatement') {
        const mutated = this.collectMutatedVars(stmt.body ?? []);
        const iter = this.optimizeExpr(stmt.iter, env);
        const loopVar = typeof stmt.target === 'string' ? stmt.target : stmt.target?.name;
        if (loopVar) env.delete(loopVar);
        for (const v of mutated) env.delete(v);
        result.push({ ...stmt, iter, body: this.optimizeStmts(stmt.body ?? [], new Map()) });
        continue;
      }

      // ── all other statements ──────────────────────────────────────────────
      const opt = this.optimizeStmt(stmt, env);
      result.push(opt);
      this.updateEnv(opt, env);

      // Dead code after unconditional jump
      if (['ReturnStatement', 'RaiseStatement', 'BreakStatement', 'ContinueStatement'].includes(opt.type)) {
        const remaining = stmts.length - i - 1;
        if (remaining > 0) {
          this.addChange('Eliminación de código muerto',
            `${remaining} sentencia(s) inalcanzable(s) eliminada(s) después de '${opt.type.replace('Statement', '').toLowerCase()}'`,
            stmts[i + 1]?.line);
          stopped = true;
        }
      }
    }

    return result;
  }

  private optimizeIfStmt(node: AstNode, optTest: AstNode, env: ConstEnv): AstNode {
    return {
      ...node,
      test: optTest,
      body: this.optimizeStmts(node.body ?? [], new Map(env)),
      elifs: (node.elifs ?? []).map((e: AstNode) => ({
        ...e,
        test: this.optimizeExpr(e.test, env),
        body: this.optimizeStmts(e.body ?? [], new Map(env)),
      })),
      orelse: node.orelse?.length ? this.optimizeStmts(node.orelse, new Map(env)) : node.orelse,
    };
  }

  private optimizeStmt(node: AstNode, env: ConstEnv): AstNode {
    if (!node) return node;
    switch (node.type) {
      case 'FunctionDef':
        return {
          ...node,
          body: this.optimizeStmts(node.body ?? [], new Map()), // new scope, fresh env
        };
      case 'ClassDef':
        return { ...node, body: this.optimizeStmts(node.body ?? [], new Map()) };
      case 'TryStatement':
        return {
          ...node,
          body: this.optimizeStmts(node.body ?? [], new Map(env)),
          handlers: (node.handlers ?? []).map((h: AstNode) => ({
            ...h, body: this.optimizeStmts(h.body ?? [], new Map(env)),
          })),
          orelse: node.orelse ? this.optimizeStmts(node.orelse, new Map(env)) : node.orelse,
          finalbody: node.finalbody ? this.optimizeStmts(node.finalbody, new Map(env)) : node.finalbody,
        };
      case 'WithStatement':
        return {
          ...node,
          items: (node.items ?? []).map((it: AstNode) => ({
            ...it, context: this.optimizeExpr(it.context, env),
          })),
          body: this.optimizeStmts(node.body ?? [], new Map(env)),
        };
      case 'ReturnStatement':
        return { ...node, value: node.value ? this.optimizeExpr(node.value, env) : null };
      case 'Assignment':
        return { ...node, value: this.optimizeExpr(node.value, env) };
      case 'AugmentedAssignment':
        return { ...node, value: this.optimizeExpr(node.value, env) };
      case 'AnnotatedAssignment':
        return { ...node, value: node.value ? this.optimizeExpr(node.value, env) : null };
      case 'ExpressionStatement':
        return { ...node, expression: this.optimizeExpr(node.expression, env) };
      case 'RaiseStatement':
        return { ...node, exc: node.exc ? this.optimizeExpr(node.exc, env) : null };
      case 'AssertStatement':
        return {
          ...node,
          test: this.optimizeExpr(node.test, env),
          msg: node.msg ? this.optimizeExpr(node.msg, env) : null,
        };
      case 'DeleteStatement':
        return { ...node, targets: (node.targets ?? []).map((t: AstNode) => this.optimizeExpr(t, env)) };
      default:
        return node;
    }
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  private optimizeExpr(node: AstNode, env: ConstEnv): AstNode {
    if (!node) return node;

    switch (node.type) {
      // ── Constant propagation ──────────────────────────────────────────────
      case 'Identifier': {
        if (env.has(node.name)) {
          const val = env.get(node.name)!;
          this.addChange('Propagación de constantes',
            `'${node.name}' sustituido por ${this.literalStr(val)}`, node.line);
          return { ...val, line: node.line };
        }
        return node;
      }

      // ── Binary expression: fold + simplify ───────────────────────────────
      case 'BinaryExpression': {
        let left  = this.optimizeExpr(node.left,  env);
        let right = this.optimizeExpr(node.right, env);
        let result: AstNode = { ...node, left, right };

        // Constant folding
        const folded = this.foldBinary(result);
        if (folded !== result) return folded;

        // Algebraic simplification
        const simplified = this.algebraicSimplify(result);
        return simplified;
      }

      // ── Unary expression ──────────────────────────────────────────────────
      case 'UnaryExpression': {
        const arg = this.optimizeExpr(node.argument ?? node.operand, env);
        const result: AstNode = { ...node, argument: arg, operand: arg };
        const folded = this.foldUnary(result);
        return folded;
      }

      // ── Call expression ───────────────────────────────────────────────────
      case 'CallExpression':
        return {
          ...node,
          callee: this.optimizeExpr(node.callee, env),
          args: (node.args ?? []).map((a: AstNode) => this.optimizeExpr(a, env)),
          keywords: (node.keywords ?? []).map((k: AstNode) => ({ ...k, value: this.optimizeExpr(k.value, env) })),
        };

      // ── Attribute / Subscript ─────────────────────────────────────────────
      case 'Attribute':
        return { ...node, object: this.optimizeExpr(node.object, env) };
      case 'Subscript':
        return { ...node, object: this.optimizeExpr(node.object, env), slice: this.optimizeExpr(node.slice, env) };

      // ── Containers ───────────────────────────────────────────────────────
      case 'ListExpression':
      case 'SetExpression':
      case 'Tuple':
        return { ...node, elements: (node.elements ?? []).map((e: AstNode) => this.optimizeExpr(e, env)) };
      case 'DictExpression':
        return {
          ...node,
          entries: (node.entries ?? []).map((e: AstNode) => ({
            ...e,
            key: e.key ? this.optimizeExpr(e.key, env) : null,
            value: this.optimizeExpr(e.value, env),
          })),
        };

      // ── Ternary ───────────────────────────────────────────────────────────
      case 'TernaryExpression': {
        const test = this.optimizeExpr(node.test, env);
        const consequent = node.consequent ?? node.body;
        const alternate  = node.alternate  ?? node.orelse;
        if (this.isAlwaysTrue(test)) {
          this.addChange('Eliminación de código muerto',
            `Expresión ternaria con condición verdadera → valor 'if'`, node.line);
          return this.optimizeExpr(consequent, env);
        }
        if (this.isAlwaysFalse(test)) {
          this.addChange('Eliminación de código muerto',
            `Expresión ternaria con condición falsa → valor 'else'`, node.line);
          return this.optimizeExpr(alternate, env);
        }
        return { ...node, test, consequent: this.optimizeExpr(consequent, env), alternate: this.optimizeExpr(alternate, env) };
      }

      // ── Comprehensions ───────────────────────────────────────────────────
      case 'ListComprehension':
      case 'SetComprehension':
      case 'GeneratorExpression':
        return {
          ...node,
          elt: node.elt ? this.optimizeExpr(node.elt, env) : node.elt,
          generators: (node.generators ?? []).map((g: AstNode) => ({
            ...g,
            iter: this.optimizeExpr(g.iter, env),
            ifs: (g.ifs ?? []).map((c: AstNode) => this.optimizeExpr(c, env)),
          })),
        };

      // ── Lambda ────────────────────────────────────────────────────────────
      case 'Lambda':
        return { ...node, body: this.optimizeExpr(node.body, new Map()) };

      default:
        return node;
    }
  }

  // ── Constant folding ──────────────────────────────────────────────────────

  private foldBinary(node: AstNode): AstNode {
    const { left: l, right: r, operator: op, line } = node;

    // Number OP Number
    if (l.type === 'NumberLiteral' && r.type === 'NumberLiteral') {
      const lv = parseFloat(l.value);
      const rv = parseFloat(r.value);
      const bothInt = Number.isInteger(lv) && Number.isInteger(rv);

      let numResult: number | undefined;
      let boolResult: boolean | undefined;

      if (op === '+')  numResult = lv + rv;
      else if (op === '-')  numResult = lv - rv;
      else if (op === '*')  numResult = lv * rv;
      else if (op === '/' && rv !== 0)  numResult = lv / rv;
      else if (op === '//' && rv !== 0) numResult = Math.trunc(lv / rv);
      else if (op === '%'  && rv !== 0) numResult = ((lv % rv) + rv) % rv;
      else if (op === '**') numResult = Math.pow(lv, rv);
      else if (op === '==') boolResult = lv === rv;
      else if (op === '!=') boolResult = lv !== rv;
      else if (op === '<')  boolResult = lv <  rv;
      else if (op === '<=') boolResult = lv <= rv;
      else if (op === '>')  boolResult = lv >  rv;
      else if (op === '>=') boolResult = lv >= rv;

      if (boolResult !== undefined) {
        this.addChange('Plegado de constantes', `${l.value} ${op} ${r.value} → ${boolResult}`, line ?? l.line);
        return { type: 'Literal', value: boolResult ? 'True' : 'False', line };
      }
      if (numResult !== undefined && isFinite(numResult)) {
        const str = (bothInt && Number.isInteger(numResult)) ? String(numResult) : String(numResult);
        this.addChange('Plegado de constantes', `${l.value} ${op} ${r.value} → ${str}`, line ?? l.line);
        return { type: 'NumberLiteral', value: str, line };
      }
    }

    // Bool AND/OR
    if (l.type === 'Literal' && r.type === 'Literal') {
      const lv = l.value === 'True';
      const rv = r.value === 'True';
      if (op === 'and') {
        this.addChange('Plegado de constantes', `${l.value} and ${r.value} → ${lv && rv}`, line);
        return { type: 'Literal', value: (lv && rv) ? 'True' : 'False', line };
      }
      if (op === 'or') {
        this.addChange('Plegado de constantes', `${l.value} or ${r.value} → ${lv || rv}`, line);
        return { type: 'Literal', value: (lv || rv) ? 'True' : 'False', line };
      }
      if (op === '==') {
        const eq = l.value === r.value;
        this.addChange('Plegado de constantes', `${l.value} == ${r.value} → ${eq}`, line);
        return { type: 'Literal', value: eq ? 'True' : 'False', line };
      }
    }

    // Unary not folding on bool
    if (op === 'not' && l.type === 'Literal') {
      const v = l.value !== 'True';
      this.addChange('Plegado de constantes', `not ${l.value} → ${v}`, line);
      return { type: 'Literal', value: v ? 'True' : 'False', line };
    }

    return node;
  }

  private foldUnary(node: AstNode): AstNode {
    const arg = node.argument ?? node.operand;
    const op  = node.operator;
    if (!arg) return node;

    if (op === '-' && arg.type === 'NumberLiteral') {
      const v = -parseFloat(arg.value);
      this.addChange('Plegado de constantes', `-${arg.value} → ${v}`, node.line ?? arg.line);
      return { type: 'NumberLiteral', value: String(v), line: node.line };
    }
    if (op === '+' && arg.type === 'NumberLiteral') {
      return arg; // +x is just x
    }
    if (op === 'not' && arg.type === 'Literal') {
      const v = arg.value !== 'True';
      this.addChange('Plegado de constantes', `not ${arg.value} → ${v}`, node.line);
      return { type: 'Literal', value: v ? 'True' : 'False', line: node.line };
    }
    // not (not x) → x
    if (op === 'not' && arg.type === 'UnaryExpression' && arg.operator === 'not') {
      const inner = arg.argument ?? arg.operand;
      this.addChange('Simplificación algebraica', `not not expr → expr`, node.line);
      return inner;
    }

    return node;
  }

  // ── Algebraic simplification ──────────────────────────────────────────────

  private algebraicSimplify(node: AstNode): AstNode {
    const { left: l, right: r, operator: op, line } = node;
    const lv = this.numericValue(l);
    const rv = this.numericValue(r);

    // Multiplication
    if (op === '*') {
      if (lv === 0) { this.addChange('Simplificación algebraica', `0 * expr → 0`, line); return { type: 'NumberLiteral', value: '0', line }; }
      if (rv === 0) { this.addChange('Simplificación algebraica', `expr * 0 → 0`, line); return { type: 'NumberLiteral', value: '0', line }; }
      if (lv === 1) { this.addChange('Simplificación algebraica', `1 * expr → expr`, line); return r; }
      if (rv === 1) { this.addChange('Simplificación algebraica', `expr * 1 → expr`, line); return l; }
    }

    // Addition
    if (op === '+') {
      if (lv === 0) { this.addChange('Simplificación algebraica', `0 + expr → expr`, line); return r; }
      if (rv === 0) { this.addChange('Simplificación algebraica', `expr + 0 → expr`, line); return l; }
    }

    // Subtraction
    if (op === '-') {
      if (rv === 0) { this.addChange('Simplificación algebraica', `expr - 0 → expr`, line); return l; }
      // x - x → 0 (only if same identifier)
      if (l.type === 'Identifier' && r.type === 'Identifier' && l.name === r.name) {
        this.addChange('Simplificación algebraica', `${l.name} - ${l.name} → 0`, line);
        return { type: 'NumberLiteral', value: '0', line };
      }
    }

    // Power
    if (op === '**') {
      if (rv === 0)  { this.addChange('Simplificación algebraica', `expr ** 0 → 1`, line); return { type: 'NumberLiteral', value: '1', line }; }
      if (rv === 1)  { this.addChange('Simplificación algebraica', `expr ** 1 → expr`, line); return l; }
      if (lv === 1)  { this.addChange('Simplificación algebraica', `1 ** expr → 1`, line); return { type: 'NumberLiteral', value: '1', line }; }
      if (lv === 0)  { this.addChange('Simplificación algebraica', `0 ** expr → 0`, line); return { type: 'NumberLiteral', value: '0', line }; }
      // Strength reduction: x ** 2 → x * x (only for simple identifiers)
      if (rv === 2 && l.type === 'Identifier') {
        this.addChange('Reducción de potencia', `${l.name} ** 2 → ${l.name} * ${l.name}`, line);
        return { type: 'BinaryExpression', operator: '*', left: { ...l }, right: { ...l }, line };
      }
    }

    // Division / floor division
    if ((op === '/' || op === '//') && rv === 1) {
      this.addChange('Simplificación algebraica', `expr ${op} 1 → expr`, line);
      return l;
    }

    // Modulo
    if (op === '%' && lv === 0) {
      this.addChange('Simplificación algebraica', `0 % expr → 0`, line);
      return { type: 'NumberLiteral', value: '0', line };
    }

    // Boolean identity
    if (op === 'and') {
      if (this.isAlwaysTrue(l))  { this.addChange('Simplificación algebraica', `True and expr → expr`, line); return r; }
      if (this.isAlwaysTrue(r))  { this.addChange('Simplificación algebraica', `expr and True → expr`, line); return l; }
      if (this.isAlwaysFalse(l)) { this.addChange('Simplificación algebraica', `False and expr → False`, line); return { type: 'Literal', value: 'False', line }; }
      if (this.isAlwaysFalse(r)) { this.addChange('Simplificación algebraica', `expr and False → False`, line); return { type: 'Literal', value: 'False', line }; }
    }
    if (op === 'or') {
      if (this.isAlwaysFalse(l)) { this.addChange('Simplificación algebraica', `False or expr → expr`, line); return r; }
      if (this.isAlwaysFalse(r)) { this.addChange('Simplificación algebraica', `expr or False → expr`, line); return l; }
      if (this.isAlwaysTrue(l))  { this.addChange('Simplificación algebraica', `True or expr → True`, line); return { type: 'Literal', value: 'True', line }; }
      if (this.isAlwaysTrue(r))  { this.addChange('Simplificación algebraica', `expr or True → True`, line); return { type: 'Literal', value: 'True', line }; }
    }

    return node;
  }

  // ── Constant propagation environment update ───────────────────────────────

  private updateEnv(stmt: AstNode, env: ConstEnv): void {
    if (stmt.type === 'Assignment') {
      const name = typeof stmt.target === 'string' ? stmt.target : stmt.targetNode?.name ?? null;
      if (name) {
        if (this.isLiteralNode(stmt.value)) {
          env.set(name, stmt.value);
        } else {
          env.delete(name);
        }
      }
    } else if (stmt.type === 'AugmentedAssignment') {
      if (stmt.target?.type === 'Identifier') env.delete(stmt.target.name);
    } else if (stmt.type === 'AnnotatedAssignment') {
      const name = stmt.target?.type === 'Identifier' ? stmt.target.name : null;
      if (name) {
        if (stmt.value && this.isLiteralNode(stmt.value)) env.set(name, stmt.value);
        else if (name) env.delete(name);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isAlwaysTrue(node: AstNode): boolean {
    if (!node) return false;
    if (node.type === 'Literal' && node.value === 'True')  return true;
    if (node.type === 'NumberLiteral' && node.value !== '0') return true;
    if (node.type === 'StringLiteral') return true; // non-empty string
    return false;
  }

  private isAlwaysFalse(node: AstNode): boolean {
    if (!node) return false;
    if (node.type === 'Literal'  && node.value === 'False') return true;
    if (node.type === 'Literal'  && node.value === 'None')  return true;
    if (node.type === 'NumberLiteral' && node.value === '0') return true;
    return false;
  }

  private isLiteralNode(node: AstNode): boolean {
    if (!node) return false;
    return node.type === 'NumberLiteral' || node.type === 'StringLiteral' || node.type === 'Literal';
  }

  private numericValue(node: AstNode): number | null {
    if (node?.type === 'NumberLiteral') return parseFloat(node.value);
    if (node?.type === 'Literal') {
      if (node.value === 'True')  return 1;
      if (node.value === 'False') return 0;
    }
    return null;
  }

  private literalStr(node: AstNode): string {
    if (node?.type === 'NumberLiteral') return node.value;
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'Literal') return node.value;
    return '?';
  }

  private collectMutatedVars(stmts: AstNode[]): Set<string> {
    const vars = new Set<string>();
    for (const stmt of stmts) {
      if (stmt.type === 'Assignment') {
        const name = typeof stmt.target === 'string' ? stmt.target : (stmt.targetNode?.name ?? null);
        if (name) vars.add(name);
      } else if (stmt.type === 'AugmentedAssignment' && stmt.target?.type === 'Identifier') {
        vars.add(stmt.target.name);
      }
      for (const key of ['body', 'orelse', 'finalbody'] as const) {
        if (Array.isArray((stmt as any)[key]))
          for (const v of this.collectMutatedVars((stmt as any)[key])) vars.add(v);
      }
      if (Array.isArray(stmt.elifs)) {
        for (const elif of stmt.elifs)
          if (Array.isArray(elif.body))
            for (const v of this.collectMutatedVars(elif.body)) vars.add(v);
      }
    }
    return vars;
  }

  private addChange(pass: string, description: string, line?: number): void {
    this.changes.push({ pass, description, line });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NestJS Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class OptimizerService {
  constructor(
    private readonly syntaxService: SyntaxService,
    private readonly translatorService: TranslatorService,
  ) {}

  async optimize(code: string): Promise<OptimizerResult> {
    const syntaxResult = await this.syntaxService.analyze(code);

    if (!syntaxResult.success || !syntaxResult.ast) {
      return {
        success: false,
        optimizedCpp: '',
        changes: [],
        totalChanges: 0,
        passesRun: 0,
        error: 'No se puede optimizar: el código tiene errores sintácticos.',
      };
    }

    try {
      const optimizer = new AstOptimizer();
      const { ast: optimizedAst, changes, passesRun } = optimizer.optimize(syntaxResult.ast as AstNode);
      const translatorResult = this.translatorService.translateFromAst(optimizedAst);

      if (!translatorResult.success) {
        return {
          success: false,
          optimizedCpp: '',
          changes,
          totalChanges: changes.length,
          passesRun,
          error: translatorResult.error,
        };
      }

      return {
        success: true,
        optimizedCpp: translatorResult.code,
        changes,
        totalChanges: changes.length,
        passesRun,
      };
    } catch (e: any) {
      return {
        success: false,
        optimizedCpp: '',
        changes: [],
        totalChanges: 0,
        passesRun: 0,
        error: `Error interno en el optimizador: ${e.message}`,
      };
    }
  }
}
