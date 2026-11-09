import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const braces = require('@dieub/braces-depth-guard');
const archive = resolve('vendor/braces-depth-guard-3.0.3-pn.3.tgz');

interface AstNode {
  type: string;
  nodes?: AstNode[];
  parent?: AstNode;
}

interface DependencyNode {
  path: string;
  dependencies?: Record<string, DependencyNode>;
  devDependencies?: Record<string, DependencyNode>;
  optionalDependencies?: Record<string, DependencyNode>;
}

function nestedAst(depth: number): AstNode {
  let node: AstNode = { type: 'text', nodes: [] };
  for (let index = 0; index < depth; index++) {
    node = { type: 'brace', nodes: [node] };
  }
  return { type: 'root', nodes: [node] };
}

describe('dependency security mitigations', () => {
  it('retains the reviewed archive bytes and canonical fork identity', () => {
    expect(createHash('sha512').update(readFileSync(archive)).digest('base64')).toBe(
      'QY+Uq4s42STyIMPoRkBuUZfYyvz0uZuwuUburLwMx5N+lWqnHHaBxcKPtgKVKjTyFnS1q4ivKu9Wxi4VG7FE9Q==',
    );
    expect(require('@dieub/braces-depth-guard/package.json')).toMatchObject({
      name: '@dieub/braces-depth-guard',
      version: '3.0.3-pn.3',
      license: 'MIT',
    });
  });

  it('routes every installed braces consumer to the guarded module', () => {
    // Inspect the active graph; pnpm may retain unused previous versions on disk.
    const graph: DependencyNode[] = JSON.parse(
      execFileSync('pnpm', ['list', 'braces', '--depth', 'Infinity', '--json'], {
        encoding: 'utf8',
        timeout: 10000,
      }),
    );
    const consumers = new Set<string>();
    const visit = (node: DependencyNode) => {
      for (const dependencies of [
        node.dependencies,
        node.devDependencies,
        node.optionalDependencies,
      ]) {
        for (const [name, child] of Object.entries(dependencies ?? {})) {
          if (name === 'braces') consumers.add(node.path);
          visit(child);
        }
      }
    };
    expect(Array.isArray(graph)).toBe(true);
    graph.forEach(visit);
    // No installed package depends on braces today; the override still guards future consumers.
    for (const path of consumers) {
      const consumerRequire = createRequire(resolve(path, 'consumer.cjs'));
      expect(consumerRequire('braces')).toBe(braces);
      expect(consumerRequire('braces/package.json').name).toBe('@streaming-chatbot/braces-compat');
    }
  });

  it('preserves ordinary alternatives, ranges, escaping and quotes', () => {
    expect(braces.expand('src/{app,components}/*.{ts,tsx}')).toEqual([
      'src/app/*.ts',
      'src/app/*.tsx',
      'src/components/*.ts',
      'src/components/*.tsx',
    ]);
    expect(braces.expand('{1..3}')).toEqual(['1', '2', '3']);
    expect(braces.expand('\\{a,b\\}')).toEqual(['{a,b}']);
    expect(braces.expand('"{a,b}"')).toEqual(['{a,b}']);
    expect(() => braces.expand('{1..1001}')).toThrow(/range limit/);
    expect(braces.expand(')}{a,b}')).toEqual([')}a', ')}b']);
  });

  it('rejects brace and parenthesis nesting before exhausting the stack', () => {
    for (const [open, close] of [
      ['{', '}'],
      ['(', ')'],
    ]) {
      const input = `${open.repeat(1500)}x${close.repeat(1500)}`;
      for (const maxDepth of [undefined, Infinity, NaN, 100000]) {
        expect(() => braces(input, { maxDepth })).toThrow(/exceeds max depth/);
      }
      expect(() => braces(`${open.repeat(3)}x${close.repeat(3)}`, { maxDepth: 2 })).toThrow(
        /exceeds max depth/,
      );
    }
  });

  it('bounds recursive AST operations and rejects parent cycles', () => {
    for (const operation of ['compile', 'expand', 'stringify']) {
      expect(() => braces[operation](nestedAst(150))).toThrow(/exceeds max depth/);
    }
    const cyclic: AstNode = { type: 'paren', nodes: [] };
    cyclic.parent = cyclic;
    expect(() => braces.expand(cyclic)).toThrow(/parent chain contains a cycle/);
  });

  it('bounds even acyclic ancestor chains using the configured depth', () => {
    const ast: AstNode = { type: 'paren', nodes: [] };
    let ancestor = ast;
    for (let index = 0; index < 5; index++) {
      ancestor.parent = { type: 'paren', nodes: [] };
      ancestor = ancestor.parent;
    }
    ancestor.parent = { type: 'root', nodes: [] };
    expect(() => braces.expand(ast, { maxDepth: 2 })).toThrow(/parent depth.*exceeds max depth/);
  });

  it('keeps Prisma configuration merges compatible with the patched deepmerge', () => {
    const configRequire = createRequire(require.resolve('@prisma/config'));
    const { deepmerge } = configRequire('deepmerge-ts');
    expect(deepmerge({ database: { host: 'localhost' } }, { database: { port: 5432 } })).toEqual({
      database: { host: 'localhost', port: 5432 },
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => deepmerge(cyclic, cyclic)).not.toThrow();
    const prismaRequire = createRequire(require.resolve('prisma/package.json'));
    expect(prismaRequire('mysql2/package.json').version).toBe('3.24.5');
  });
});
