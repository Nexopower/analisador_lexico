import { Body, Controller, Post } from '@nestjs/common';
import { SyntaxService } from './syntax.service';

@Controller('syntax')
export class SyntaxController {
  constructor(private readonly syntaxService: SyntaxService) {}

  @Post('analyze')
  async analyze(@Body('code') code: string) {
    if (!code) return { error: 'No code provided' };
    return this.syntaxService.analyze(code);
  }
}
