import { Controller, Post, Body } from '@nestjs/common';
import { OptimizerService } from './optimizer.service';

@Controller('optimizer')
export class OptimizerController {
  constructor(private readonly optimizerService: OptimizerService) {}

  @Post('optimize')
  async optimize(@Body() body: { code: string }) {
    return this.optimizerService.optimize(body.code ?? '');
  }
}
