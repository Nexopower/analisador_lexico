import { Injectable } from '@nestjs/common';
import { LexerService } from '../lexer/lexer.service';

type Token = {
  type: string;
  lexeme: string;
  line?: number;
  column?: number;
};

type AstNode = {
  type: string;
  [key: string]: any;
};

type SyntaxResult = {
  success: boolean;
  ast?: AstNode;
  symbols: SymbolEntry[];
  errors: string[];
};

type SymbolEntry = {
  name: string;
  kind: 'function' | 'parameter' | 'variable';
  scope: string;
  line?: number;
  column?: number;
};

class Parser {
  private readonly tokens: Token[];
  private index = 0;
  public readonly errors: string[] = [];
  public readonly symbols: SymbolEntry[] = [];
  private scopeStack: string[] = ['global'];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseProgram(): AstNode {
    const body: AstNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd()) {
      if (this.matchLexeme('DEDENT')) {
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);

      this.consumeStatementTerminator();
      this.skipNewlines();
    }

    return { type: 'Program', body };
  }

  private parseStatement(): AstNode | null {
    const token = this.current();
    if (!token) return null;

    if (this.isKeyword('def')) return this.parseFunctionDef();
    if (this.isKeyword('if')) return this.parseIfStatement();
    if (this.isKeyword('while')) return this.parseWhileStatement();
    if (this.isKeyword('return')) return this.parseReturnStatement();

    return this.parseSimpleStatement();
  }

  private parseFunctionDef(): AstNode {
    const defToken = this.current();
    this.consumeKeyword('def');
    const name = this.consumeIdentifier('Se esperaba el nombre de la función después de def');
    if (name) {
      this.addSymbol(name.lexeme, 'function', 'global', name);
    }
    this.consumeLexeme('(');
    const params: string[] = [];
    if (!this.checkLexeme(')')) {
      do {
        const param = this.consumeIdentifier('Se esperaba un parámetro');
        if (param) {
          params.push(param.lexeme);
          this.addSymbol(param.lexeme, 'parameter', name?.lexeme ?? 'global', param);
        }
      } while (this.matchLexeme(','));
    }
    this.consumeLexeme(')');
    this.consumeLexeme(':');
    this.scopeStack.push(name?.lexeme ?? 'anonymous');
    const body = this.parseSuite();
    this.scopeStack.pop();
    return { type: 'FunctionDef', name: name?.lexeme ?? null, params, body, line: defToken?.line, column: defToken?.column };
  }

  private parseIfStatement(): AstNode {
    const ifToken = this.current();
    this.consumeKeyword('if');
    const test = this.parseExpression();
    this.consumeLexeme(':');
    const body = this.parseSuite();
    const elifs: AstNode[] = [];
    let orelse: AstNode[] | null = null;

    while (this.isKeyword('elif')) {
      this.consumeKeyword('elif');
      const elifTest = this.parseExpression();
      this.consumeLexeme(':');
      elifs.push({ type: 'Elif', test: elifTest, body: this.parseSuite() });
    }

    if (this.isKeyword('else')) {
      this.consumeKeyword('else');
      this.consumeLexeme(':');
      orelse = this.parseSuite();
    }

    return { type: 'IfStatement', test, body, elifs, orelse, line: ifToken?.line, column: ifToken?.column };
  }

  private parseWhileStatement(): AstNode {
    const whileToken = this.current();
    this.consumeKeyword('while');
    const test = this.parseExpression();
    this.consumeLexeme(':');
    const body = this.parseSuite();
    return { type: 'WhileStatement', test, body, line: whileToken?.line, column: whileToken?.column };
  }

  private parseReturnStatement(): AstNode {
    const retToken = this.current();
    this.consumeKeyword('return');
    if (this.isStatementTerminator()) {
      return { type: 'ReturnStatement', value: null, line: retToken?.line, column: retToken?.column };
    }
    const value = this.parseExpression();
    return { type: 'ReturnStatement', value, line: retToken?.line, column: retToken?.column };
  }

  private parseSimpleStatement(): AstNode | null {
    if (this.checkType('IDENTIFICADOR') && this.checkLexeme('=', 1)) {
      const target = this.advance();
      this.consumeLexeme('=');
      const value = this.parseExpression();
      if (target) {
        this.addSymbol(target.lexeme, 'variable', this.currentScope(), target);
      }
      return { type: 'Assignment', target: target?.lexeme ?? null, value, line: target?.line, column: target?.column };
    }

    const expr = this.parseExpression();
    return expr ? { type: 'ExpressionStatement', expression: expr } : null;
  }

  private parseSuite(): AstNode[] {
    if (this.matchLexeme('NEWLINE')) {
      this.consumeLexeme('INDENT');
      const body: AstNode[] = [];
      this.skipNewlines();
      while (!this.isAtEnd() && !this.checkLexeme('DEDENT')) {
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
        this.consumeStatementTerminator();
        this.skipNewlines();
      }
      this.consumeLexeme('DEDENT');
      return body;
    }

    const single = this.parseStatement();
    return single ? [single] : [];
  }

  private parseExpression(): AstNode {
    return this.parseOr();
  }

  private parseOr(): AstNode {
    let node = this.parseAnd();
    while (this.isKeyword('or')) {
      const op = this.advance();
      const right = this.parseAnd();
      node = { type: 'BinaryExpression', operator: op?.lexeme, left: node, right };
    }
    return node;
  }

  private parseAnd(): AstNode {
    let node = this.parseNot();
    while (this.isKeyword('and')) {
      const op = this.advance();
      const right = this.parseNot();
      node = { type: 'BinaryExpression', operator: op?.lexeme, left: node, right };
    }
    return node;
  }

  private parseNot(): AstNode {
    if (this.isKeyword('not')) {
      const op = this.advance();
      const argument = this.parseNot();
      return { type: 'UnaryExpression', operator: op?.lexeme, argument };
    }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    let node = this.parseTerm();
    while (this.isComparisonOperator()) {
      const op = this.advance();
      const right = this.parseTerm();
      node = { type: 'BinaryExpression', operator: op?.lexeme, left: node, right };
    }
    return node;
  }

  private parseTerm(): AstNode {
    let node = this.parseFactor();
    while (this.isLexeme('+') || this.isLexeme('-')) {
      const op = this.advance();
      const right = this.parseFactor();
      node = { type: 'BinaryExpression', operator: op?.lexeme, left: node, right };
    }
    return node;
  }

  private parseFactor(): AstNode {
    let node = this.parseUnary();
    while (
      this.isLexeme('*') ||
      this.isLexeme('/') ||
      this.isLexeme('%') ||
      this.isLexeme('//')
    ) {
      const op = this.advance();
      const right = this.parseUnary();
      node = { type: 'BinaryExpression', operator: op?.lexeme, left: node, right };
    }
    return node;
  }

  private parseUnary(): AstNode {
    if (this.isLexeme('+') || this.isLexeme('-')) {
      const op = this.advance();
      return { type: 'UnaryExpression', operator: op?.lexeme, argument: this.parseUnary() };
    }
    return this.parseCall();
  }

  private parseCall(): AstNode {
    let node = this.parsePrimary();
    while (this.matchLexeme('(')) {
      const args: AstNode[] = [];
      if (!this.checkLexeme(')')) {
        do {
          args.push(this.parseExpression());
        } while (this.matchLexeme(','));
      }
      this.consumeLexeme(')');
      node = { type: 'CallExpression', callee: node, args };
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const token = this.current();
    if (!token) {
      this.error('Se esperaba una expresión y se encontró EOF');
      return { type: 'Error' };
    }

    if (this.matchLexeme('(')) {
      const expr = this.parseExpression();
      this.consumeLexeme(')');
      return { type: 'Grouping', expression: expr };
    }

    if (this.checkType('IDENTIFICADOR')) {
      const t = this.advance();
      return { type: 'Identifier', name: t?.lexeme ?? '', line: t?.line, column: t?.column };
    }

    if (this.checkType('INT') || this.checkType('FLOAT')) {
      const t = this.advance();
      return { type: 'NumberLiteral', value: t?.lexeme ?? '', line: t?.line, column: t?.column };
    }

    if (this.checkType('STRING')) {
      const t = this.advance();
      return { type: 'StringLiteral', value: t?.lexeme ?? '', line: t?.line, column: t?.column };
    }

    if (this.isKeyword('True') || this.isKeyword('False') || this.isKeyword('None')) {
      const t = this.advance();
      return { type: 'Literal', value: t?.lexeme ?? '', line: t?.line, column: t?.column };
    }

    this.error(`Token inesperado en expresión: ${token.lexeme}`);
    this.advance();
    return { type: 'Error' };
  }

  private consumeStatementTerminator(): void {
    while (this.matchLexeme('NEWLINE') || this.matchLexeme(';')) {
      // consume terminators
    }
  }

  private skipNewlines(): void {
    while (this.matchLexeme('NEWLINE')) {
      // skip blank lines
    }
  }

  private consumeKeyword(name: string): Token | null {
    if (!this.isKeyword(name)) {
      this.error(`Se esperaba la palabra reservada '${name}'`);
      return null;
    }
    return this.advance();
  }

  private consumeIdentifier(message: string): Token | null {
    if (!this.checkType('IDENTIFICADOR')) {
      this.error(message);
      return null;
    }
    return this.advance();
  }

  private consumeLexeme(lexeme: string): Token | null {
    if (!this.matchLexeme(lexeme)) {
      this.error(`Se esperaba '${lexeme}'`);
      return null;
    }
    return this.previous();
  }

  private isComparisonOperator(): boolean {
    return ['==', '!=', '<', '<=', '>', '>='].includes(this.current()?.lexeme ?? '');
  }

  private isStatementTerminator(): boolean {
    return this.checkLexeme('NEWLINE') || this.checkLexeme('DEDENT') || this.isAtEnd();
  }

  private isKeyword(name: string): boolean {
    const token = this.current();
    return token?.type === 'KEYWORD' && token.lexeme === name;
  }

  private checkType(type: string, offset = 0): boolean {
    return this.peek(offset)?.type === type;
  }

  private checkLexeme(lexeme: string, offset = 0): boolean {
    return this.peek(offset)?.lexeme === lexeme;
  }

  private isLexeme(lexeme: string): boolean {
    return this.current()?.lexeme === lexeme;
  }

  private matchLexeme(lexeme: string): boolean {
    if (!this.checkLexeme(lexeme)) return false;
    this.advance();
    return true;
  }

  private current(): Token | null {
    return this.tokens[this.index] ?? null;
  }

  private previous(): Token | null {
    return this.tokens[this.index - 1] ?? null;
  }

  private peek(offset = 0): Token | null {
    return this.tokens[this.index + offset] ?? null;
  }

  private advance(): Token | null {
    if (!this.isAtEnd()) this.index++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private error(message: string): void {
    const token = this.current();
    const location = token ? ` (línea ${token.line ?? '?'}, columna ${token.column ?? '?'})` : '';
    this.errors.push(`${message}${location}`);
  }

  private addSymbol(name: string, kind: SymbolEntry['kind'], scope: string, token?: Token): void {
    if (!name) return;
    const exists = this.symbols.some((symbol) => symbol.name === name && symbol.kind === kind && symbol.scope === scope);
    if (exists) return;
    this.symbols.push({
      name,
      kind,
      scope,
      line: token?.line,
      column: token?.column,
    });
  }

  private currentScope(): string {
    return this.scopeStack[this.scopeStack.length - 1] ?? 'global';
  }
}

@Injectable()
export class SyntaxService {
  constructor(private readonly lexerService: LexerService) {}

  async analyze(code: string): Promise<SyntaxResult> {
    const tokens = (await this.lexerService.lex(code)) as Token[];
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();

    return {
      success: parser.errors.length === 0,
      ast,
      symbols: parser.symbols,
      errors: parser.errors,
    };
  }
}
