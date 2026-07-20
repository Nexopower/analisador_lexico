import { Injectable } from '@nestjs/common';
import { SyntaxService } from '../syntax/syntax.service';
import { TranslatorService } from '../translator/translator.service';
import { AstOptimizer } from '../optimizer/optimizer.service';
import { execFile, spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

type AstNode = { type: string; [key: string]: any };

export type StartResult = {
  success: boolean;
  stage: 'traduccion' | 'compilacion' | 'ejecucion';
  sessionId?: string;
  compilerOutput?: string;
  error?: string;
};

export type PollResult = {
  output: string;
  running: boolean;
  exitCode: number | null;
  timedOut: boolean;
  timeMs?: number;
};

type Session = {
  proc: ChildProcess;
  pending: string;       // salida acumulada aún no entregada al cliente
  running: boolean;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: number;
  endedAt?: number;
  lastPollAt: number;
};

const COMPILE_TIMEOUT_MS = 30000;
const MAX_RUN_MS = 10 * 60 * 1000;   // tope absoluto: 10 minutos
const ABANDON_MS = 30 * 1000;        // si el cliente deja de consultar, matar el proceso

@Injectable()
export class RunnerService {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly syntaxService: SyntaxService,
    private readonly translatorService: TranslatorService,
  ) {
    // Vigilante: mata procesos abandonados o que exceden el tope absoluto
    setInterval(() => {
      const now = Date.now();
      for (const [id, s] of this.sessions) {
        if (!s.running) {
          if (now - (s.endedAt ?? now) > 60_000) this.sessions.delete(id);
          continue;
        }
        if (now - s.lastPollAt > ABANDON_MS) {
          s.proc.kill();
        } else if (now - s.startedAt > MAX_RUN_MS) {
          s.timedOut = true;
          s.proc.kill();
        }
      }
    }, 10_000).unref();
  }

  private gxxPath(): string {
    const msys = 'C:\\msys64\\ucrt64\\bin\\g++.exe';
    return fs.existsSync(msys) ? msys : 'g++';
  }

  private workDir(): string {
    const dir = path.join(os.tmpdir(), 'compilador_runs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Borra artefactos de ejecuciones viejas (mejor esfuerzo, ignora archivos en uso)
  private cleanupOld(dir: string): void {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        try {
          if (now - fs.statSync(full).mtimeMs > 15 * 60 * 1000) fs.unlinkSync(full);
        } catch { /* en uso */ }
      }
    } catch { /* ignorar */ }
  }

  // El .exe descargado se ejecuta con doble clic: sin esta pausa, la ventana
  // de consola se cierra apenas termina el programa y no se ve la salida.
  private injectExitPause(cpp: string): string {
    let out = cpp;
    if (!out.includes('#include <iostream>')) {
      out = out.replace(
        '// Compilar con: g++ -std=c++20 archivo.cpp -o programa',
        '// Compilar con: g++ -std=c++20 archivo.cpp -o programa\n#include <iostream>',
      );
    }
    return out.replace(
      /\n    return 0;\n}\s*$/,
      '\n    std::cout << "\\n[Programa terminado] Presione Enter para salir..." << std::flush;\n    std::cin.get();\n    return 0;\n}',
    );
  }

  // Python → AST optimizado → C++ → g++ → .exe (común a ambos modos de ejecución)
  private async compileCode(code: string, pauseAtExit = false): Promise<{ ok: boolean; exeFile?: string; fail?: StartResult }> {
    const syntaxResult = await this.syntaxService.analyze(code);
    if (!syntaxResult.success || !syntaxResult.ast) {
      return { ok: false, fail: { success: false, stage: 'traduccion', error: 'El código tiene errores sintácticos.' } };
    }
    const { ast: optimizedAst } = new AstOptimizer().optimize(syntaxResult.ast as AstNode);
    const transl = this.translatorService.translateFromAst(optimizedAst);
    if (!transl.success) {
      return { ok: false, fail: { success: false, stage: 'traduccion', error: transl.error } };
    }

    const dir = this.workDir();
    this.cleanupOld(dir);
    const base = path.join(dir, `programa_${Date.now()}`);
    const cppFile = `${base}.cpp`;
    const exeFile = `${base}.exe`;
    const cppCode = pauseAtExit ? this.injectExitPause(transl.code) : transl.code;
    fs.writeFileSync(cppFile, cppCode, 'utf8');

    const compile = await new Promise<{ ok: boolean; output: string }>((resolve) => {
      execFile(
        this.gxxPath(),
        ['-std=c++20', '-static', cppFile, '-o', exeFile],
        { timeout: COMPILE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, _stdout, stderr) => resolve({ ok: !err, output: stderr ?? '' }),
      );
    });
    if (!compile.ok) {
      return { ok: false, fail: { success: false, stage: 'compilacion', compilerOutput: compile.output } };
    }
    return { ok: true, exeFile };
  }

  // Compila el código actual y devuelve la ruta del .exe (para descargarlo).
  // Con pausa al final: el .exe se abre con doble clic y debe esperar antes de cerrarse.
  async compileExe(code: string): Promise<{ ok: boolean; exeFile?: string; fail?: StartResult }> {
    return this.compileCode(code, true);
  }

  // Modo web: lanza el programa con E/S por tubería, manejada por sesión
  async start(code: string): Promise<StartResult> {
    const c = await this.compileCode(code);
    if (!c.ok) return c.fail!;

    const proc = spawn(c.exeFile!, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const session: Session = {
      proc,
      pending: '',
      running: true,
      exitCode: null,
      timedOut: false,
      startedAt: Date.now(),
      lastPollAt: Date.now(),
    };
    const id = randomUUID();
    this.sessions.set(id, session);

    proc.stdout!.on('data', d => { if (session.pending.length < 200_000) session.pending += d.toString(); });
    proc.stderr!.on('data', d => { if (session.pending.length < 200_000) session.pending += d.toString(); });
    proc.stdin!.on('error', () => { /* el programa no lee stdin */ });
    proc.on('error', () => {
      session.running = false;
      session.endedAt = Date.now();
    });
    proc.on('close', (exitCode) => {
      session.running = false;
      session.exitCode = exitCode;
      session.endedAt = Date.now();
    });

    return { success: true, stage: 'ejecucion', sessionId: id };
  }

  // Modo consola: compila el código actual y lo ejecuta en una ventana cmd real de Windows
  async runInConsole(code: string): Promise<StartResult> {
    const c = await this.compileCode(code);
    if (!c.ok) return c.fail!;

    // .bat: ejecuta el programa y espera una tecla antes de cerrar (estilo Code::Blocks)
    const batFile = c.exeFile!.replace(/\.exe$/, '.bat');
    fs.writeFileSync(
      batFile,
      `@echo off\r\n"${c.exeFile}"\r\necho.\r\necho ─── Proceso terminado con codigo %errorlevel% ───\r\npause\r\n`,
      'utf8',
    );
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', batFile], { detached: true, stdio: 'ignore' });
      child.unref();
      return { success: true, stage: 'ejecucion' };
    } catch (e: any) {
      return { success: false, stage: 'ejecucion', error: `No se pudo abrir la consola: ${e.message}` };
    }
  }

  // Entrega la salida nueva acumulada desde la última consulta
  poll(sessionId: string): PollResult {
    const s = this.sessions.get(sessionId);
    if (!s) return { output: '', running: false, exitCode: null, timedOut: false };
    s.lastPollAt = Date.now();
    const output = s.pending;
    s.pending = '';
    const result: PollResult = {
      output,
      running: s.running,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      timeMs: (s.endedAt ?? Date.now()) - s.startedAt,
    };
    if (!s.running && output === '') this.sessions.delete(sessionId);
    return result;
  }

  // Envía una línea al stdin del programa (lo que el usuario escribió en el terminal)
  writeStdin(sessionId: string, text: string): { success: boolean } {
    const s = this.sessions.get(sessionId);
    if (!s || !s.running) return { success: false };
    s.proc.stdin!.write(text + '\n');
    return { success: true };
  }

  stop(sessionId: string): { success: boolean } {
    const s = this.sessions.get(sessionId);
    if (!s || !s.running) return { success: false };
    s.proc.kill();
    return { success: true };
  }
}
