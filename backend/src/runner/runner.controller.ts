import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RunnerService } from './runner.service';

@Controller('runner')
export class RunnerController {
  constructor(private readonly runnerService: RunnerService) {}

  @Post('start')
  async start(@Body() body: { code: string }) {
    return this.runnerService.start(body.code ?? '');
  }

  @Post('poll')
  poll(@Body() body: { sessionId: string }) {
    return this.runnerService.poll(body.sessionId ?? '');
  }

  @Post('stdin')
  stdin(@Body() body: { sessionId: string; text: string }) {
    return this.runnerService.writeStdin(body.sessionId ?? '', body.text ?? '');
  }

  @Post('stop')
  stop(@Body() body: { sessionId: string }) {
    return this.runnerService.stop(body.sessionId ?? '');
  }

  @Post('run-console')
  async runConsole(@Body() body: { code: string }) {
    return this.runnerService.runInConsole(body.code ?? '');
  }

  @Post('download')
  async download(@Body() body: { code: string }, @Res() res: Response) {
    const r = await this.runnerService.compileExe(body.code ?? '');
    if (!r.ok) {
      res.status(400).json(r.fail);
      return;
    }
    res.download(r.exeFile!, 'programa.exe');
  }
}
