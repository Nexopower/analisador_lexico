import { Module } from '@nestjs/common';
import { LexerController } from './lexer.controller';
import { LexerService } from './lexer.service';
import { SyntaxController } from '../syntax/syntax.controller';
import { SyntaxService } from '../syntax/syntax.service';
import { SemanticController } from '../semantic/semantic.controller';
import { SemanticService } from '../semantic/semantic.service';
import { TranslatorController } from '../translator/translator.controller';
import { TranslatorService } from '../translator/translator.service';

@Module({
  controllers: [LexerController, SyntaxController, SemanticController, TranslatorController],
  providers: [LexerService, SyntaxService, SemanticService, TranslatorService],
  exports: [LexerService],
})
export class LexerModule {}
