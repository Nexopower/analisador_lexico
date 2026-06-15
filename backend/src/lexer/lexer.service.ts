import { Injectable } from '@nestjs/common';
import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';
import { tmpdir } from 'os';
import { writeFile, unlink, access } from 'fs/promises';
import { join } from 'path';

const execFile = promisify(_execFile as any);

@Injectable()
export class LexerService {
  async lex(code: string): Promise<any[]> {
    const tmp = tmpdir();
    const inPath = join(tmp, `input_${Date.now()}.py`);
    try {
      await writeFile(inPath, code, 'utf8');
      // Try to run a built flex lexer binary. Search in backend/build and repo-root build.
      const cwd = process.cwd();
      const candidates = [
        join(cwd, 'build', 'lex.yy.exe'),
        join(cwd, 'build', 'lex.yy'),
        join(cwd, '..', 'build', 'lex.yy.exe'),
        join(cwd, '..', 'build', 'lex.yy'),
      ];
      for (const bin of candidates) {
        try {
          await access(bin);
          const { stdout } = await execFile(bin, [inPath], { timeout: 10000 });
          // Expect lexer to print one JSON object per line.
          const lines = String(stdout).split(/\r?\n/).filter(Boolean);
          return lines.map((l) => {
            try {
              return JSON.parse(l);
            } catch (error) {
              const m = l.match(/^(\S+)\s([\s\S]*)$/);
              if (m) return { type: m[1], lexeme: m[2] };
              const parts = l.split(/\s+/);
              return { type: parts[0] || 'UNKNOWN', lexeme: parts.slice(1).join(' ') || '' };
            }
          });
        } catch (e) {
          // try next candidate
        }
      }
      // Fallback: very simple whitespace/punctuation tokenizer
      const simple = code
        .split(/(\b|\s|[^\w\s])/)
        .filter((s) => s && !/^\s+$/.test(s));
      return simple.map((s) => ({
        type: /^[A-Za-z_]\w*$/.test(s) ? 'IDENT' : 'SYMBOL',
        lexeme: s,
        line: undefined,
        column: undefined,
      }));
    } finally {
      try {
        await unlink(inPath);
      } catch {}
    }
  }
}
