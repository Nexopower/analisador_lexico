import { Controller, Post, Body } from '@nestjs/common';
import { LexerService } from './lexer.service';

@Controller('lexer')
export class LexerController {
  constructor(private readonly lexerService: LexerService) {}

  @Post('lex')
  async lex(@Body('code') code: string) {
    if (!code) return { error: 'No code provided' };
    const tokens = await this.lexerService.lex(code);
    return { tokens };
  }
}
