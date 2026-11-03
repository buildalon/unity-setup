'use strict';

// Stands in for @actions/glob, which @actions/cache uses to resolve cache paths.
// @actions/glob pins a minimatch with a published advisory (GHSA-g3hv-75wg-m249), and its fix needs minimatch 11, which @actions/glob can't run on.
// Covers the part @actions/cache uses: newline separated patterns, `!` excludes, `#` comments and the implicitDescendants/matchDirectories options.

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

async function match(patterns, options) {
  const lines = patterns.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
  const include = lines.filter(line => !line.startsWith('!'));
  const ignore = lines.filter(line => line.startsWith('!')).map(line => line.substring(1).trim());
  if (include.length === 0) { return []; }
  const matchDirectories = options.matchDirectories ?? true;
  const implicitDescendants = options.implicitDescendants ?? true;
  const globOptions = {
    absolute: true,
    dot: true,
    ignore: ignore.flatMap(pattern => [pattern, `${pattern}/**`]),
    // backslashes are path separators on Windows, as in @actions/glob
    windowsPathsNoEscape: true
  };
  const found = new Set(await glob(include, globOptions));
  if (implicitDescendants) {
    for (const descendant of await glob(include.map(pattern => `${pattern}/**`), globOptions)) {
      found.add(descendant);
    }
  }
  const results = [];
  for (const file of found) {
    if (!matchDirectories) {
      try {
        if ((await fs.promises.stat(file)).isDirectory()) { continue; }
      } catch {
        continue;
      }
    }
    results.push(path.resolve(file));
  }
  return results.sort();
}

async function create(patterns, options = {}) {
  return {
    glob: () => match(patterns, options),
    globGenerator: async function* () {
      yield* await match(patterns, options);
    }
  };
}

module.exports = { create };
