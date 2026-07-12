import { Controller, Post, Body } from '@nestjs/common';
import { CodegenService } from './codegen.service';

@Controller('codegen')
export class CodegenController {
  constructor(private readonly codegenService: CodegenService) {}

  @Post('generate')
  async generate(@Body() body: { code: string }) {
    return this.codegenService.generate(body.code ?? '');
  }
}
