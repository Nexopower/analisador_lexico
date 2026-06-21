import { Module } from '@nestjs/common';
import { LexerController } from './lexer.controller';
import { LexerService } from './lexer.service';
import { SyntaxController } from '../syntax/syntax.controller';
import { SyntaxService } from '../syntax/syntax.service';
import { SemanticController } from '../semantic/semantic.controller';
import { SemanticService } from '../semantic/semantic.service';

@Module({
  controllers: [LexerController, SyntaxController, SemanticController],
  providers: [LexerService, SyntaxService, SemanticService],
  exports: [LexerService],
})
export class LexerModule {}
