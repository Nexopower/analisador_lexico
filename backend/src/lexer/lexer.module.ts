import { Module } from '@nestjs/common';
import { LexerController } from './lexer.controller';
import { LexerService } from './lexer.service';
import { SyntaxController } from '../syntax/syntax.controller';
import { SyntaxService } from '../syntax/syntax.service';
import { SemanticController } from '../semantic/semantic.controller';
import { SemanticService } from '../semantic/semantic.service';
import { TranslatorController } from '../translator/translator.controller';
import { TranslatorService } from '../translator/translator.service';
import { OptimizerController } from '../optimizer/optimizer.controller';
import { OptimizerService } from '../optimizer/optimizer.service';
import { CodegenController } from '../codegen/codegen.controller';
import { CodegenService } from '../codegen/codegen.service';

@Module({
  controllers: [LexerController, SyntaxController, SemanticController, TranslatorController, OptimizerController, CodegenController],
  providers: [LexerService, SyntaxService, SemanticService, TranslatorService, OptimizerService, CodegenService],
  exports: [LexerService],
})
export class LexerModule {}
