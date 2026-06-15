import { Module } from '@nestjs/common';
import { LexerController } from './lexer.controller';
import { LexerService } from './lexer.service';
import { SyntaxController } from '../syntax/syntax.controller';
import { SyntaxService } from '../syntax/syntax.service';

@Module({
  controllers: [LexerController, SyntaxController],
  providers: [LexerService, SyntaxService],
  exports: [LexerService],
})
export class LexerModule {}
