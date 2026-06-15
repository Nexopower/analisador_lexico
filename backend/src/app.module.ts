import { Module } from '@nestjs/common';
import { LexerModule } from './lexer/lexer.module';

@Module({
  imports: [LexerModule],
})
export class AppModule {}
