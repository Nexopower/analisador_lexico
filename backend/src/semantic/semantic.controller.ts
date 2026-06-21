import { Controller, Post, Body } from '@nestjs/common';
import { SemanticService } from './semantic.service';

@Controller('semantic')
export class SemanticController {
  constructor(private readonly semanticService: SemanticService) {}

  @Post('analyze')
  async analyze(@Body() body: { code: string }) {
    return this.semanticService.analyze(body.code ?? '');
  }
}
