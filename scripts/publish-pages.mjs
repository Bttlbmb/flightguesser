import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || ''}`);
  return result.stdout?.trim() ?? '';
}
const git = (...args) => run('git', args);

// Publish only committed source, so the backup identifies the exact build.
if (git('branch', '--show-current') !== 'main') throw new Error('Publish from the main branch.');
if (git('status', '--porcelain')) throw new Error('Commit your source changes before publishing.');
const sourceCommit = git('rev-parse', 'HEAD');
for (const script of ['test', 'data:check', 'build']) {
  run('npm', ['run', script], { stdio: 'inherit' });
}

git('fetch', 'origin');
const parentResult = spawnSync('git', ['rev-parse', '--verify', 'refs/remotes/origin/gh-pages'], { cwd: root, encoding: 'utf8' });
const parent = parentResult.status === 0 ? parentResult.stdout.trim() : null;
const temporary = await mkdtemp(join(tmpdir(), 'flightguesser-pages-'));
try {
  // A separate index creates a website-only commit without switching branches
  // or altering the source checkout. Existing published history is preserved.
  const options = { cwd: output, env: { ...process.env,
    GIT_DIR: git('rev-parse', '--absolute-git-dir'),
    GIT_WORK_TREE: output, GIT_INDEX_FILE: join(temporary, 'index'),
  } };
  const websiteGit = (...args) => run('git', args, options);
  websiteGit('read-tree', '--empty');
  websiteGit('add', '--all', '--force', '--', '.');
  const tree = websiteGit('write-tree');
  // A normal push refuses a diverging source history; never overwrite it.
  git('push', 'origin', 'main');
  if (parent && git('rev-parse', `${parent}^{tree}`) === tree) {
    console.log('The published website already matches this build. Source backup updated.');
  } else {
    const commit = websiteGit('commit-tree', tree, ...(parent ? ['-p', parent] : []),
      '-m', `Publish static website from ${sourceCommit}`);
    // This also refuses a concurrent change to the publishing branch.
    git('push', 'origin', `${commit}:refs/heads/gh-pages`);
    console.log(`Published website commit ${commit.slice(0, 7)} to gh-pages.`);
  }
  console.log('Pages settings: Deploy from a branch → gh-pages → /(root).');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
