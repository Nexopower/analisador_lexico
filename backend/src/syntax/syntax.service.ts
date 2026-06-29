import { Injectable } from '@nestjs/common';
import { LexerService } from '../lexer/lexer.service';

type Token = { type: string; lexeme: string; line?: number; column?: number };
type AstNode = { type: string; [key: string]: any };

type SyntaxResult = {
  success: boolean;
  ast?: AstNode;
  symbols: SymbolEntry[];
  errors: string[];
};

type SymbolEntry = {
  name: string;
  kind: 'function' | 'parameter' | 'variable' | 'class' | 'import';
  scope: string;
  line?: number;
  column?: number;
};

const AUG_OPS = new Set(['+=','-=','*=','/=','//=','**=','%=','&=','|=','^=','<<=','>>=','@=']);
const CMP_OPS = new Set(['==','!=','<','<=','>','>=']);

class Parser {
  private readonly tokens: Token[];
  private index = 0;
  public readonly errors: string[] = [];
  public readonly symbols: SymbolEntry[] = [];
  private scopeStack: string[] = ['global'];

  constructor(tokens: Token[]) { this.tokens = tokens; }

  // ── Program ───────────────────────────────────────────────────────

  parseProgram(): AstNode {
    const body: AstNode[] = [];
    this.skipNewlines();
    while (!this.isAtEnd()) {
      if (this.matchLexeme('DEDENT')) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    return { type: 'Program', body };
  }

  // ── Statements ────────────────────────────────────────────────────

  private parseStatement(): AstNode | null {
    if (this.isLexeme('@'))          return this.parseDecorated();
    if (this.isKeyword('async'))     return this.parseAsync([]);
    if (this.isKeyword('def'))       return this.parseFunctionDef([]);
    if (this.isKeyword('class'))     return this.parseClassDef([]);
    if (this.isKeyword('if'))        return this.parseIfStatement();
    if (this.isKeyword('while'))     return this.parseWhileStatement();
    if (this.isKeyword('for'))       return this.parseForStatement();
    if (this.isKeyword('try'))       return this.parseTryStatement();
    if (this.isKeyword('with'))      return this.parseWithStatement();
    return this.parseSimpleStatement();
  }

  private parseDecorated(): AstNode {
    const decorators: AstNode[] = [];
    while (this.isLexeme('@')) {
      this.advance();
      decorators.push(this.parsePostfix());
      this.consumeNewline();
      this.skipNewlines();
    }
    if (this.isKeyword('async')) return this.parseAsync(decorators);
    if (this.isKeyword('class')) return this.parseClassDef(decorators);
    return this.parseFunctionDef(decorators);
  }

  private parseAsync(decorators: AstNode[]): AstNode {
    const t = this.current();
    this.consumeKeyword('async');
    if (this.isKeyword('def'))  return { ...this.parseFunctionDef(decorators), isAsync: true, line: t?.line };
    if (this.isKeyword('for'))  return { ...this.parseForStatement(),   isAsync: true };
    if (this.isKeyword('with')) return { ...this.parseWithStatement(),  isAsync: true };
    this.error("Se esperaba 'def', 'for' o 'with' después de 'async'");
    return { type: 'Error' };
  }

  private parseFunctionDef(decorators: AstNode[]): AstNode {
    const defTok = this.current();
    this.consumeKeyword('def');
    const name = this.consumeIdentifier('Se esperaba el nombre de la función');
    if (name) this.addSymbol(name.lexeme, 'function', 'global', name);

    this.consumeLexeme('(');
    const params = this.parseParamList();
    this.consumeLexeme(')');

    let returnAnnotation: AstNode | null = null;
    if (this.isLexeme('->')) { this.advance(); returnAnnotation = this.parseTestExpr(); }

    this.consumeLexeme(':');
    this.scopeStack.push(name?.lexeme ?? 'anonymous');
    for (const p of params) {
      if (p.name) this.addSymbol(p.name, 'parameter', this.currentScope(), { line: p.line });
    }
    const body = this.parseSuite();
    this.scopeStack.pop();

    return { type: 'FunctionDef', name: name?.lexeme ?? null, decorators, params, returnAnnotation, body, line: defTok?.line, column: defTok?.column };
  }

  private parseParamList(): AstNode[] {
    const params: AstNode[] = [];
    if (this.checkLexeme(')')) return params;
    let seenStarStar = false;
    do {
      if (this.checkLexeme(')') || seenStarStar) break;
      if (this.isLexeme('**')) {
        this.advance();
        const n = this.consumeIdentifier('Se esperaba nombre para **kwargs');
        params.push({ type: 'Parameter', name: n?.lexeme, kind: 'kwargs', line: n?.line });
        seenStarStar = true;
        continue;
      }
      if (this.isLexeme('*')) {
        this.advance();
        if (this.checkLexeme(',') || this.checkLexeme(')')) {
          params.push({ type: 'Parameter', name: null, kind: 'bare_star' });
          continue;
        }
        const n = this.consumeIdentifier('Se esperaba nombre para *args');
        params.push({ type: 'Parameter', name: n?.lexeme, kind: 'args', line: n?.line });
        continue;
      }
      const n = this.consumeIdentifier('Se esperaba nombre de parámetro');
      let annotation: AstNode | null = null;
      if (this.isLexeme(':'))  { this.advance(); annotation = this.parseTestExpr(); }
      let defaultVal: AstNode | null = null;
      if (this.isLexeme('=')) { this.advance(); defaultVal = this.parseTestExpr(); }
      params.push({ type: 'Parameter', name: n?.lexeme, kind: 'positional', annotation, default: defaultVal, line: n?.line });
    } while (this.matchLexeme(','));
    return params;
  }

  private parseClassDef(decorators: AstNode[]): AstNode {
    const t = this.current();
    this.consumeKeyword('class');
    const name = this.consumeIdentifier('Se esperaba el nombre de la clase');
    if (name) this.addSymbol(name.lexeme, 'class', 'global', name);

    const bases: AstNode[] = [];
    const keywords: AstNode[] = [];
    if (this.matchLexeme('(')) {
      if (!this.checkLexeme(')')) {
        do {
          if (this.checkLexeme(')')) break;
          if (this.isLexeme('**')) { this.advance(); keywords.push({ type: 'KeywordArg', key: '**', value: this.parseTestExpr() }); }
          else if (this.checkType('IDENTIFICADOR') && this.checkLexeme('=', 1)) {
            const k = this.advance(); this.advance();
            keywords.push({ type: 'KeywordArg', key: k?.lexeme, value: this.parseTestExpr() });
          } else { bases.push(this.parseTestExpr()); }
        } while (this.matchLexeme(','));
      }
      this.consumeLexeme(')');
    }
    this.consumeLexeme(':');
    this.scopeStack.push(name?.lexeme ?? 'anonymous_class');
    const body = this.parseSuite();
    this.scopeStack.pop();
    return { type: 'ClassDef', name: name?.lexeme, decorators, bases, keywords, body, line: t?.line };
  }

  private parseIfStatement(): AstNode {
    const t = this.current();
    this.consumeKeyword('if');
    const test = this.parseTestExpr();
    this.consumeLexeme(':');
    const body = this.parseSuite();
    const elifs: AstNode[] = [];
    let orelse: AstNode[] | null = null;
    while (this.isKeyword('elif')) {
      const et = this.current();
      this.consumeKeyword('elif');
      elifs.push({ type: 'Elif', test: this.parseTestExpr(), body: (this.consumeLexeme(':'), this.parseSuite()), line: et?.line });
    }
    if (this.isKeyword('else')) { this.consumeKeyword('else'); this.consumeLexeme(':'); orelse = this.parseSuite(); }
    return { type: 'IfStatement', test, body, elifs, orelse, line: t?.line, column: t?.column };
  }

  private parseWhileStatement(): AstNode {
    const t = this.current();
    this.consumeKeyword('while');
    const test = this.parseTestExpr();
    this.consumeLexeme(':');
    const body = this.parseSuite();
    let orelse: AstNode[] | null = null;
    if (this.isKeyword('else')) { this.consumeKeyword('else'); this.consumeLexeme(':'); orelse = this.parseSuite(); }
    return { type: 'WhileStatement', test, body, orelse, line: t?.line, column: t?.column };
  }

  private parseForStatement(): AstNode {
    const t = this.current();
    this.consumeKeyword('for');
    const target = this.parseTargetList();
    this.consumeKeyword('in');
    const iter = this.parseStarExprList();
    this.consumeLexeme(':');
    const body = this.parseSuite();
    let orelse: AstNode[] | null = null;
    if (this.isKeyword('else')) { this.consumeKeyword('else'); this.consumeLexeme(':'); orelse = this.parseSuite(); }
    return { type: 'ForStatement', target, iter, body, orelse, line: t?.line };
  }

  private parseTryStatement(): AstNode {
    const t = this.current();
    this.consumeKeyword('try'); this.consumeLexeme(':');
    const body = this.parseSuite();
    const handlers: AstNode[] = [];
    let orelse: AstNode[] | null = null;
    let finalbody: AstNode[] | null = null;

    while (this.isKeyword('except')) {
      const et = this.current(); this.consumeKeyword('except');
      let excType: AstNode | null = null;
      let excName: string | null = null;
      if (!this.checkLexeme(':')) {
        if (this.isLexeme('*')) { this.advance(); } // Python 3.11+ except*
        excType = this.parseTestExpr();
        if (this.isKeyword('as')) {
          this.consumeKeyword('as');
          const n = this.consumeIdentifier('Se esperaba nombre después de as');
          excName = n?.lexeme ?? null;
          if (n) this.addSymbol(excName!, 'variable', this.currentScope(), n);
        }
      }
      this.consumeLexeme(':');
      handlers.push({ type: 'ExceptHandler', excType, name: excName, body: this.parseSuite(), line: et?.line });
    }
    if (this.isKeyword('else'))    { this.consumeKeyword('else');    this.consumeLexeme(':'); orelse    = this.parseSuite(); }
    if (this.isKeyword('finally')) { this.consumeKeyword('finally'); this.consumeLexeme(':'); finalbody = this.parseSuite(); }

    if (handlers.length === 0 && finalbody === null) this.error("Se esperaba 'except' o 'finally'");
    return { type: 'TryStatement', body, handlers, orelse, finalbody, line: t?.line };
  }

  private parseWithStatement(): AstNode {
    const t = this.current();
    this.consumeKeyword('with');
    const items: AstNode[] = [];
    do {
      const ctx = this.parseTestExpr();
      let asVar: AstNode | null = null;
      if (this.isKeyword('as')) { this.consumeKeyword('as'); asVar = this.parseTarget(); }
      items.push({ type: 'WithItem', context: ctx, optional_vars: asVar });
    } while (this.matchLexeme(','));
    this.consumeLexeme(':');
    const body = this.parseSuite();
    return { type: 'WithStatement', items, body, line: t?.line };
  }

  // ── Simple statements ─────────────────────────────────────────────

  private parseSimpleStatement(): AstNode | null {
    const stmts: AstNode[] = [];
    const s = this.parseOneSimpleStmt();
    if (s) stmts.push(s);
    while (this.matchLexeme(';')) {
      this.skipNewlines();
      if (this.isStatementTerminator()) break;
      const s2 = this.parseOneSimpleStmt();
      if (s2) stmts.push(s2);
    }
    this.consumeStatementTerminator();
    if (stmts.length === 0) return null;
    if (stmts.length === 1) return stmts[0];
    return { type: 'StatementList', body: stmts };
  }

  private parseOneSimpleStmt(): AstNode | null {
    if (this.isKeyword('pass'))     { const t = this.current(); this.advance(); return { type: 'PassStatement',     line: t?.line }; }
    if (this.isKeyword('break'))    { const t = this.current(); this.advance(); return { type: 'BreakStatement',    line: t?.line }; }
    if (this.isKeyword('continue')) { const t = this.current(); this.advance(); return { type: 'ContinueStatement', line: t?.line }; }
    if (this.isKeyword('return'))   return this.parseReturn();
    if (this.isKeyword('raise'))    return this.parseRaise();
    if (this.isKeyword('yield'))    return this.parseYield();
    if (this.isKeyword('assert'))   return this.parseAssert();
    if (this.isKeyword('del'))      return this.parseDel();
    if (this.isKeyword('global'))   return this.parseGlobal();
    if (this.isKeyword('nonlocal')) return this.parseNonlocal();
    if (this.isKeyword('import'))   return this.parseImport();
    if (this.isKeyword('from'))     return this.parseFromImport();
    return this.parseExpressionStatement();
  }

  private parseReturn(): AstNode {
    const t = this.current(); this.consumeKeyword('return');
    const value = this.isStatementTerminator() ? null : this.parseStarExprList();
    return { type: 'ReturnStatement', value, line: t?.line, column: t?.column };
  }

  private parseRaise(): AstNode {
    const t = this.current(); this.consumeKeyword('raise');
    if (this.isStatementTerminator()) return { type: 'RaiseStatement', exc: null, cause: null, line: t?.line };
    const exc = this.parseTestExpr();
    let cause: AstNode | null = null;
    if (this.isKeyword('from')) { this.advance(); cause = this.parseTestExpr(); }
    return { type: 'RaiseStatement', exc, cause, line: t?.line };
  }

  private parseYield(): AstNode {
    const t = this.current(); this.consumeKeyword('yield');
    if (this.isKeyword('from')) { this.advance(); return { type: 'YieldFrom', value: this.parseTestExpr(), line: t?.line }; }
    const value = this.isStatementTerminator() ? null : this.parseStarExprList();
    return { type: 'YieldExpression', value, line: t?.line };
  }

  private parseAssert(): AstNode {
    const t = this.current(); this.consumeKeyword('assert');
    const test = this.parseTestExpr();
    let msg: AstNode | null = null;
    if (this.matchLexeme(',')) msg = this.parseTestExpr();
    return { type: 'AssertStatement', test, msg, line: t?.line };
  }

  private parseDel(): AstNode {
    const t = this.current(); this.consumeKeyword('del');
    const targets = [this.parsePostfix()];
    while (this.matchLexeme(',') && !this.isStatementTerminator()) targets.push(this.parsePostfix());
    return { type: 'DeleteStatement', targets, line: t?.line };
  }

  private parseGlobal(): AstNode {
    const t = this.current(); this.consumeKeyword('global');
    const names: string[] = [];
    do { const n = this.consumeIdentifier('Se esperaba nombre de variable'); if (n) names.push(n.lexeme); } while (this.matchLexeme(','));
    return { type: 'GlobalStatement', names, line: t?.line };
  }

  private parseNonlocal(): AstNode {
    const t = this.current(); this.consumeKeyword('nonlocal');
    const names: string[] = [];
    do { const n = this.consumeIdentifier('Se esperaba nombre de variable'); if (n) names.push(n.lexeme); } while (this.matchLexeme(','));
    return { type: 'NonlocalStatement', names, line: t?.line };
  }

  private parseImport(): AstNode {
    const t = this.current(); this.consumeKeyword('import');
    const names: AstNode[] = [];
    do {
      const dotted = this.parseDottedName();
      let alias: string | null = null;
      if (this.isKeyword('as')) { this.advance(); const a = this.consumeIdentifier('Se esperaba alias'); alias = a?.lexeme ?? null; if (a) this.addSymbol(alias!, 'import', this.currentScope(), a); }
      else if (dotted.length > 0) this.addSymbol(dotted[0], 'import', this.currentScope(), t ?? undefined);
      names.push({ type: 'ImportName', name: dotted.join('.'), alias });
    } while (this.matchLexeme(','));
    return { type: 'ImportStatement', names, line: t?.line };
  }

  private parseFromImport(): AstNode {
    const t = this.current(); this.consumeKeyword('from');
    let dots = 0;
    while (this.isLexeme('.') || this.isLexeme('...')) { dots += this.current()?.lexeme === '...' ? 3 : 1; this.advance(); }
    const module = this.isKeyword('import') ? '' : this.parseDottedName().join('.');
    this.consumeKeyword('import');
    const names: AstNode[] = [];
    if (this.isLexeme('*')) { this.advance(); names.push({ type: 'ImportName', name: '*', alias: null }); }
    else {
      const paren = this.matchLexeme('(');
      do {
        if (this.checkLexeme(')')) break;
        const n = this.consumeIdentifier('Se esperaba nombre a importar');
        let alias: string | null = null;
        if (this.isKeyword('as')) { this.advance(); const a = this.consumeIdentifier('Se esperaba alias'); alias = a?.lexeme ?? null; if (a) this.addSymbol(alias!, 'import', this.currentScope(), a); }
        else if (n) this.addSymbol(n.lexeme, 'import', this.currentScope(), n);
        names.push({ type: 'ImportName', name: n?.lexeme ?? '', alias });
      } while (this.matchLexeme(','));
      if (paren) this.consumeLexeme(')');
    }
    return { type: 'FromImportStatement', dots, module, names, line: t?.line };
  }

  private parseExpressionStatement(): AstNode | null {
    const expr = this.parseStarExprList();
    if (!expr) return null;

    // Augmented assignment:  x += val
    const cur = this.current();
    if (cur && AUG_OPS.has(cur.lexeme)) {
      this.advance();
      const value = this.parseStarExprList();
      const name = this.nameOf(expr);
      if (name) this.addSymbol(name, 'variable', this.currentScope(), { line: expr.line });
      return { type: 'AugmentedAssignment', operator: cur.lexeme, target: expr, value, line: expr.line };
    }

    // Annotated assignment:  x: int [= val]
    if (this.isLexeme(':') && !this.checkLexeme('=', 1)) {
      this.advance();
      const annotation = this.parseTestExpr();
      let value: AstNode | null = null;
      if (this.isLexeme('=')) { this.advance(); value = this.parseStarExprList(); }
      const name = this.nameOf(expr);
      if (name) this.addSymbol(name, 'variable', this.currentScope(), { line: expr.line });
      return { type: 'AnnotatedAssignment', target: expr, annotation, value, line: expr.line };
    }

    // Assignment(s):  a [= b]* = val
    if (this.isLexeme('=')) {
      const targets: AstNode[] = [expr];
      while (this.isLexeme('=')) { this.advance(); targets.push(this.parseStarExprList()); }
      const value = targets.pop()!;
      for (const tgt of targets) { const n = this.nameOf(tgt); if (n) this.addSymbol(n, 'variable', this.currentScope(), { line: tgt.line }); }
      return targets.length === 1
        ? { type: 'Assignment', target: this.nameOf(targets[0]) ?? targets[0], targetNode: targets[0], value, line: targets[0].line }
        : { type: 'MultiAssignment', targets, value, line: targets[0].line };
    }

    return { type: 'ExpressionStatement', expression: expr, line: expr.line };
  }

  private nameOf(node: AstNode): string | null {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'Tuple') return null;
    return null;
  }

  // ── Suite ─────────────────────────────────────────────────────────

  private parseSuite(): AstNode[] {
    // Inline:  if x: pass
    if (!this.checkLexeme('NEWLINE')) {
      const s = this.parseOneSimpleStmt();
      this.consumeStatementTerminator();
      return s ? [s] : [];
    }
    this.matchLexeme('NEWLINE');
    this.skipNewlines();
    if (!this.matchLexeme('INDENT')) { this.error('Se esperaba un bloque indentado'); return []; }
    const body: AstNode[] = [];
    this.skipNewlines();
    while (!this.isAtEnd() && !this.checkLexeme('DEDENT')) {
      if (this.matchLexeme('NEWLINE')) continue;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    this.matchLexeme('DEDENT');
    return body;
  }

  // ── Expressions ───────────────────────────────────────────────────

  // Comma list with optional trailing comma → tuple or single
  private parseStarExprList(): AstNode {
    const first = this.parseTestExpr();
    if (!this.isLexeme(',')) return first;
    const elems: AstNode[] = [first];
    while (this.matchLexeme(',')) {
      if (this.isStatementTerminator() || this.checkLexeme(')') || this.checkLexeme(']') || this.checkLexeme('}')) break;
      elems.push(this.parseTestExpr());
    }
    return { type: 'Tuple', elements: elems, line: first.line };
  }

  private parseTestExpr(): AstNode {
    if (this.isKeyword('lambda')) return this.parseLambda();
    const expr = this.parseOr();
    // Ternary:  value if cond else alt
    if (this.isKeyword('if')) {
      this.advance();
      const test = this.parseOr();
      this.consumeKeyword('else');
      const alt = this.parseTestExpr();
      return { type: 'TernaryExpression', test, consequent: expr, alternate: alt, line: expr.line };
    }
    return expr;
  }

  private parseLambda(): AstNode {
    const t = this.current(); this.consumeKeyword('lambda');
    const params: AstNode[] = [];
    while (!this.checkLexeme(':') && !this.isAtEnd()) {
      const n = this.consumeIdentifier('Se esperaba parámetro lambda');
      let def: AstNode | null = null;
      if (this.isLexeme('=')) { this.advance(); def = this.parseTestExpr(); }
      params.push({ type: 'Parameter', name: n?.lexeme, kind: 'positional', default: def });
      if (!this.matchLexeme(',')) break;
    }
    this.consumeLexeme(':');
    return { type: 'Lambda', params, body: this.parseTestExpr(), line: t?.line };
  }

  private parseOr(): AstNode {
    let n = this.parseAnd();
    while (this.isKeyword('or'))  { const op = this.advance(); n = { type:'BinaryExpression', operator: op?.lexeme, left: n, right: this.parseAnd(), line: n.line }; }
    return n;
  }

  private parseAnd(): AstNode {
    let n = this.parseNot();
    while (this.isKeyword('and')) { const op = this.advance(); n = { type:'BinaryExpression', operator: op?.lexeme, left: n, right: this.parseNot(), line: n.line }; }
    return n;
  }

  private parseNot(): AstNode {
    if (this.isKeyword('not')) { const t = this.advance(); return { type:'UnaryExpression', operator:'not', argument: this.parseNot(), line: t?.line }; }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    let node = this.parseBitOr();
    const ops: string[] = [];
    const comparators: AstNode[] = [];
    while (true) {
      let op: string | null = null;
      if (CMP_OPS.has(this.current()?.lexeme ?? ''))           { op = this.advance()!.lexeme; }
      else if (this.isKeyword('in'))                           { op = 'in';     this.advance(); }
      else if (this.isKeyword('not') && this.checkKeyword('in', 1))  { this.advance(); this.advance(); op = 'not in'; }
      else if (this.isKeyword('is') && this.checkKeyword('not', 1))  { this.advance(); this.advance(); op = 'is not'; }
      else if (this.isKeyword('is'))                           { op = 'is';     this.advance(); }
      else break;
      ops.push(op); comparators.push(this.parseBitOr());
    }
    if (ops.length === 0) return node;
    if (ops.length === 1) return { type:'BinaryExpression', operator: ops[0], left: node, right: comparators[0], line: node.line };
    return { type:'ChainedComparison', left: node, ops, comparators, line: node.line };
  }

  private parseBitOr():  AstNode { let n = this.parseBitXor(); while (this.isLexeme('|'))  { const op=this.advance(); n={type:'BinaryExpression',operator:op?.lexeme,left:n,right:this.parseBitXor(),line:n.line}; } return n; }
  private parseBitXor(): AstNode { let n = this.parseBitAnd(); while (this.isLexeme('^'))  { const op=this.advance(); n={type:'BinaryExpression',operator:op?.lexeme,left:n,right:this.parseBitAnd(),line:n.line}; } return n; }
  private parseBitAnd(): AstNode { let n = this.parseShift();  while (this.isLexeme('&'))  { const op=this.advance(); n={type:'BinaryExpression',operator:op?.lexeme,left:n,right:this.parseShift(),line:n.line};  } return n; }
  private parseShift():  AstNode { let n = this.parseSum();    while (this.isLexeme('<<') || this.isLexeme('>>')) { const op=this.advance(); n={type:'BinaryExpression',operator:op?.lexeme,left:n,right:this.parseSum(),line:n.line};   } return n; }
  private parseSum():    AstNode { let n = this.parseTerm();   while (this.isLexeme('+')  || this.isLexeme('-'))  { const op=this.advance(); n={type:'BinaryExpression',operator:op?.lexeme,left:n,right:this.parseTerm(),line:n.line};  } return n; }

  private parseTerm(): AstNode {
    let n = this.parsePower();
    while (this.isLexeme('*') || this.isLexeme('/') || this.isLexeme('%') || this.isLexeme('//') || this.isLexeme('@')) {
      const op = this.advance(); n = { type:'BinaryExpression', operator: op?.lexeme, left: n, right: this.parsePower(), line: n.line };
    }
    return n;
  }

  private parsePower(): AstNode {
    const base = this.parseUnary();
    if (this.isLexeme('**')) { const op=this.advance(); return { type:'BinaryExpression', operator:'**', left: base, right: this.parsePower(), line: base.line }; }
    return base;
  }

  private parseUnary(): AstNode {
    if (this.isLexeme('+') || this.isLexeme('-') || this.isLexeme('~')) {
      const op = this.advance(); return { type:'UnaryExpression', operator: op?.lexeme, argument: this.parseUnary(), line: op?.line };
    }
    if (this.isKeyword('await')) { const t=this.advance(); return { type:'AwaitExpression', argument: this.parseUnary(), line: t?.line }; }
    return this.parsePostfix();
  }

  // Attribute access  a.b,  subscript  a[i],  call  f(args)
  private parsePostfix(): AstNode {
    let node = this.parseAtom();
    while (true) {
      if (this.matchLexeme('.')) {
        const attr = this.consumeIdentifier('Se esperaba nombre de atributo después de .');
        node = { type:'Attribute', object: node, attr: attr?.lexeme, line: node.line };
      } else if (this.matchLexeme('[')) {
        const slice = this.parseSubscript();
        this.consumeLexeme(']');
        node = { type:'Subscript', object: node, slice, line: node.line };
      } else if (this.checkLexeme('(')) {
        this.advance();
        const { args, keywords } = this.parseCallArgs();
        this.consumeLexeme(')');
        node = { type:'CallExpression', callee: node, args, keywords, line: node.line };
      } else break;
    }
    return node;
  }

  private parseSubscript(): AstNode {
    if (this.checkLexeme(':')) return this.buildSlice(null);
    const first = this.parseTestExpr();
    if (this.isLexeme(':')) return this.buildSlice(first);
    return first;
  }

  private buildSlice(lower: AstNode | null): AstNode {
    this.consumeLexeme(':');
    let upper: AstNode | null = null;
    let step:  AstNode | null = null;
    if (!this.checkLexeme(':') && !this.checkLexeme(']')) upper = this.parseTestExpr();
    if (this.matchLexeme(':') && !this.checkLexeme(']'))  step  = this.parseTestExpr();
    return { type:'Slice', lower, upper, step };
  }

  private parseCallArgs(): { args: AstNode[]; keywords: AstNode[] } {
    const args: AstNode[] = [];
    const keywords: AstNode[] = [];
    if (this.checkLexeme(')')) return { args, keywords };
    do {
      if (this.checkLexeme(')')) break;
      if (this.isLexeme('**'))  { this.advance(); keywords.push({ type:'KeywordArg', key:'**',      value: this.parseTestExpr() }); }
      else if (this.isLexeme('*')) { this.advance(); args.push({ type:'StarArg', value: this.parseTestExpr() }); }
      else if (this.checkType('IDENTIFICADOR') && this.checkLexeme('=', 1)) {
        const k = this.advance(); this.advance();
        keywords.push({ type:'KeywordArg', key: k?.lexeme, value: this.parseTestExpr() });
      } else {
        const e = this.parseTestExpr();
        // generator expression inside call
        if (this.isKeyword('for')) { const comp = this.parseComprehensionTail(); args.push({ type:'GeneratorExpression', elt: e, generators: comp, line: e.line }); }
        else args.push(e);
      }
    } while (this.matchLexeme(','));
    return { args, keywords };
  }

  // ── Atom (primary literal / grouped expressions) ──────────────────

  private parseAtom(): AstNode {
    const tok = this.current();
    if (!tok) { this.error('Se esperaba una expresión'); return { type:'Error' }; }

    if (this.isKeyword('yield')) return this.parseYield();

    // ( ... )  grouping, tuple, generator
    if (this.matchLexeme('(')) {
      if (this.checkLexeme(')')) { this.advance(); return { type:'Tuple', elements:[], line: tok.line }; }
      const first = this.parseTestExpr();
      if (this.isKeyword('for')) {
        const comp = this.parseComprehensionTail();
        this.consumeLexeme(')');
        return { type:'GeneratorExpression', elt: first, generators: comp, line: tok.line };
      }
      if (this.matchLexeme(',')) {
        const elems = [first];
        while (!this.checkLexeme(')') && !this.isAtEnd()) { elems.push(this.parseTestExpr()); if (!this.matchLexeme(',')) break; }
        this.consumeLexeme(')');
        return { type:'Tuple', elements: elems, line: tok.line };
      }
      this.consumeLexeme(')');
      return { type:'Grouping', expression: first, line: tok.line };
    }

    // [ ... ]  list / list comprehension
    if (this.matchLexeme('[')) {
      if (this.checkLexeme(']')) { this.advance(); return { type:'List', elements:[], line: tok.line }; }
      const first = this.parseTestExpr();
      if (this.isKeyword('for')) {
        const comp = this.parseComprehensionTail();
        this.consumeLexeme(']');
        return { type:'ListComprehension', elt: first, generators: comp, line: tok.line };
      }
      const elems = [first];
      while (this.matchLexeme(',') && !this.checkLexeme(']')) elems.push(this.parseTestExpr());
      this.consumeLexeme(']');
      return { type:'List', elements: elems, line: tok.line };
    }

    // { ... }  dict / set / comprehensions
    if (this.matchLexeme('{')) {
      if (this.checkLexeme('}')) { this.advance(); return { type:'Dict', keys:[], values:[], line: tok.line }; }
      if (this.isLexeme('**')) {
        // {**d} dict unpack
        this.advance();
        const val = this.parseTestExpr();
        const items: AstNode[] = [{ type:'DictUnpack', value: val }];
        while (this.matchLexeme(',') && !this.checkLexeme('}')) {
          if (this.matchLexeme('**')) items.push({ type:'DictUnpack', value: this.parseTestExpr() });
          else { const k = this.parseTestExpr(); this.consumeLexeme(':'); items.push({ type:'DictItem', key: k, value: this.parseTestExpr() }); }
        }
        this.consumeLexeme('}');
        return { type:'DictExpression', items, line: tok.line };
      }
      const first = this.parseTestExpr();
      if (this.isLexeme(':')) {
        // dict or dict comprehension
        this.advance();
        const fv = this.parseTestExpr();
        if (this.isKeyword('for')) { const comp = this.parseComprehensionTail(); this.consumeLexeme('}'); return { type:'DictComprehension', key: first, value: fv, generators: comp, line: tok.line }; }
        const keys=[first], vals=[fv];
        while (this.matchLexeme(',') && !this.checkLexeme('}')) { keys.push(this.parseTestExpr()); this.consumeLexeme(':'); vals.push(this.parseTestExpr()); }
        this.consumeLexeme('}');
        return { type:'Dict', keys, values: vals, line: tok.line };
      }
      // set or set comprehension
      if (this.isKeyword('for')) { const comp = this.parseComprehensionTail(); this.consumeLexeme('}'); return { type:'SetComprehension', elt: first, generators: comp, line: tok.line }; }
      const elems=[first];
      while (this.matchLexeme(',') && !this.checkLexeme('}')) elems.push(this.parseTestExpr());
      this.consumeLexeme('}');
      return { type:'Set', elements: elems, line: tok.line };
    }

    // IDENTIFICADOR  (with walrus :=)
    if (this.checkType('IDENTIFICADOR')) {
      const t = this.advance()!;
      if (this.isLexeme(':=')) { this.advance(); return { type:'WalrusExpression', target: t.lexeme, value: this.parseTestExpr(), line: t.line }; }
      return { type:'Identifier', name: t.lexeme, line: t.line, column: t.column };
    }

    if (this.checkType('INT') || this.checkType('FLOAT')) {
      const t = this.advance()!;
      return { type:'NumberLiteral', value: t.lexeme, line: t.line, column: t.column };
    }

    // String (including adjacent string concatenation)
    if (this.checkType('STRING')) {
      const first = this.current()!;
      const parts: string[] = [];
      while (this.checkType('STRING')) parts.push(this.advance()!.lexeme);
      return { type:'StringLiteral', value: parts.join(''), line: first.line, column: first.column };
    }

    if (this.isKeyword('True') || this.isKeyword('False') || this.isKeyword('None')) {
      const t = this.advance()!;
      return { type:'Literal', value: t.lexeme, line: t.line, column: t.column };
    }

    // *expr  star expression
    if (this.isLexeme('*')) { const t=this.advance(); return { type:'StarExpression', value: this.parseTestExpr(), line: t?.line }; }

    // Ellipsis (may come as single ... token or as OPERADOR)
    if (this.isLexeme('...')) { const t=this.advance(); return { type:'Literal', value:'...', line: t?.line }; }

    this.error(`Token inesperado: '${tok.lexeme}'`);
    this.advance();
    return { type:'Error', line: tok.line };
  }

  // ── Comprehension helpers ─────────────────────────────────────────

  private parseComprehensionTail(): AstNode[] {
    const generators: AstNode[] = [];
    while (this.isKeyword('for') || (this.isKeyword('async') && this.checkKeyword('for', 1))) {
      const isAsync = this.isKeyword('async');
      if (isAsync) this.advance();
      this.consumeKeyword('for');
      const target = this.parseTargetList();
      this.consumeKeyword('in');
      const iter = this.parseOr();
      const ifs: AstNode[] = [];
      while (this.isKeyword('if')) { this.advance(); ifs.push(this.parseOr()); }
      generators.push({ type:'Comprehension', target, iter, ifs, isAsync });
    }
    return generators;
  }

  private parseTargetList(): AstNode {
    const first = this.parseTarget();
    if (!this.isLexeme(',')) return first;
    const elems = [first];
    while (this.matchLexeme(',')) {
      if (this.isKeyword('in') || this.isStatementTerminator()) break;
      elems.push(this.parseTarget());
    }
    return { type:'Tuple', elements: elems, line: first.line };
  }

  private parseTarget(): AstNode {
    if (this.isLexeme('*')) { const t=this.advance(); return { type:'StarExpression', value: this.parsePostfix(), line: t?.line }; }
    if (this.isLexeme('(')) { this.advance(); const inner=this.parseTargetList(); this.consumeLexeme(')'); return inner; }
    if (this.isLexeme('[')) { this.advance(); const inner=this.parseTargetList(); this.consumeLexeme(']'); return inner; }
    return this.parsePostfix();
  }

  private parseDottedName(): string[] {
    const parts: string[] = [];
    const n = this.consumeIdentifier('Se esperaba nombre de módulo');
    if (n) parts.push(n.lexeme);
    while (this.isLexeme('.') && this.checkType('IDENTIFICADOR', 1)) { this.advance(); const n2=this.consumeIdentifier('Se esperaba nombre'); if (n2) parts.push(n2.lexeme); }
    return parts;
  }

  // ── Utilities ─────────────────────────────────────────────────────

  private consumeStatementTerminator(): void { while (this.matchLexeme('NEWLINE') || this.matchLexeme(';')) { /* */ } }
  private consumeNewline():  void { this.matchLexeme('NEWLINE'); }
  private skipNewlines():    void { while (this.matchLexeme('NEWLINE')) { /* */ } }

  private consumeKeyword(name: string): Token | null {
    if (!this.isKeyword(name)) { this.error(`Se esperaba la palabra reservada '${name}'`); return null; }
    return this.advance();
  }
  private consumeIdentifier(msg: string): Token | null {
    if (!this.checkType('IDENTIFICADOR')) { this.error(msg); return null; }
    return this.advance();
  }
  private consumeLexeme(lex: string): Token | null {
    if (!this.matchLexeme(lex)) { this.error(`Se esperaba '${lex}'`); return null; }
    return this.previous();
  }

  private isKeyword(name: string):                 boolean { const t=this.current(); return t?.type==='KEYWORD' && t.lexeme===name; }
  private checkKeyword(name: string, off: number): boolean { const t=this.peek(off); return t?.type==='KEYWORD' && t.lexeme===name; }
  private checkType(type: string, off=0):          boolean { return this.peek(off)?.type === type; }
  private checkLexeme(lex: string, off=0):         boolean { return this.peek(off)?.lexeme === lex; }
  private isLexeme(lex: string):                   boolean { return this.current()?.lexeme === lex; }
  private matchLexeme(lex: string): boolean { if (!this.checkLexeme(lex)) return false; this.advance(); return true; }
  private isStatementTerminator(): boolean { return this.checkLexeme('NEWLINE') || this.checkLexeme('DEDENT') || this.checkLexeme(';') || this.isAtEnd(); }

  private current():  Token | null { return this.tokens[this.index] ?? null; }
  private previous(): Token | null { return this.tokens[this.index-1] ?? null; }
  private peek(off=0):Token | null { return this.tokens[this.index+off] ?? null; }
  private advance():  Token | null { if (!this.isAtEnd()) this.index++; return this.previous(); }
  private isAtEnd():  boolean      { return this.index >= this.tokens.length; }

  private error(msg: string): void {
    const t = this.current();
    this.errors.push(`${msg}${t ? ` (línea ${t.line??'?'}, columna ${t.column??'?'})` : ''}`);
  }

  private addSymbol(name: string, kind: SymbolEntry['kind'], scope: string, token?: { line?: number; column?: number }): void {
    if (!name) return;
    if (!this.symbols.some(s => s.name===name && s.scope===scope && s.kind===kind))
      this.symbols.push({ name, kind, scope, line: token?.line, column: token?.column });
  }

  private currentScope(): string { return this.scopeStack[this.scopeStack.length-1] ?? 'global'; }
}

@Injectable()
export class SyntaxService {
  constructor(private readonly lexerService: LexerService) {}

  async analyze(code: string): Promise<SyntaxResult> {
    const tokens = (await this.lexerService.lex(code)) as Token[];
    const parser = new Parser(tokens);
    const ast    = parser.parseProgram();
    return { success: parser.errors.length === 0, ast, symbols: parser.symbols, errors: parser.errors };
  }
}
