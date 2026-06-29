import { Controller, Post, Body } from '@nestjs/common';
import { TranslatorService } from './translator.service';

@Controller('translator')
export class TranslatorController {
  constructor(private readonly translatorService: TranslatorService) {}

  @Post('translate')
  async translate(@Body() body: { code: string }) {
    return this.translatorService.translate(body.code ?? '');
  }
}
