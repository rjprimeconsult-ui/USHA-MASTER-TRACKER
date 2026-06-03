/**
 * Minimal Node.js ESM loader that resolves extensionless relative imports
 * by appending .js. Used only for running tests in isolation.
 * Usage: node --import ./src/lib/test-loader.mjs --test src/lib/salesreport.test.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' + encodeURIComponent(`
    import { resolve as pathResolve } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { existsSync } from 'node:fs';

    export async function resolve(specifier, context, nextResolve) {
      // Only patch extensionless relative imports
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        if (!/\\.[a-z]+$/i.test(specifier)) {
          const parentDir = context.parentURL
            ? fileURLToPath(new URL('.', context.parentURL))
            : process.cwd();
          const candidate = pathResolve(parentDir, specifier + '.js');
          if (existsSync(candidate)) {
            return nextResolve(pathToFileURL(candidate).href, context);
          }
        }
      }
      return nextResolve(specifier, context);
    }
  `),
  pathToFileURL('./'),
);
