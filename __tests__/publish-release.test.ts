import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  MARKERS, createPlan, publishRelease, validateTag, validateVersions
} = require('../.github/scripts/publish-release');

type Versions = { cmake?: string; rc?: string; ninja?: string };
type Result = { status: number; stdout: string; stderr: string };
type Failure = (command: string, args: string[]) => Result | undefined;
type Release = { tag_name: string; draft: boolean; prerelease?: boolean; name?: string; body?: string };

const BASE = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);
const TAGGED = 'd'.repeat(40);
const TAG_OBJECT = 'e'.repeat(40);
const LATEST_TAG_OBJECT = 'f'.repeat(40);
const before = { cmake: '4.1.0', rc: '4.2.0-rc1', ninja: '1.12.0' };
const updated = { cmake: '4.1.1', rc: '4.2.0-rc2', ninja: '1.13.0' };
const ok = (stdout = ''): Result => ({ status: 0, stdout, stderr: '' });
const fail = (stderr: string, status = 1): Result => ({ status, stdout: '', stderr });

// Model read-only Git state and GitHub responses; every write is recorded, never executed.
function fixture(options: {
  before?: Versions;
  after?: Versions;
  main?: Versions;
  tagged?: Versions;
  existingTag?: boolean;
  release?: Release;
  releasePages?: Release[][];
  latestRelease?: Release;
  latestCommit?: string;
  latestIsAncestor?: boolean;
  failure?: Failure;
  env?: { [key: string]: string | undefined };
} = {}) {
  const after = options.after || { ...before, cmake: updated.cmake };
  const commits: { [sha: string]: Versions } = {
    [BASE]: options.before || before,
    [TARGET]: after,
    [MAIN]: options.main || after,
    [TAGGED]: options.tagged || after
  };
  let fetchedTag = '';
  let createdTag = '';
  const env = {
    GH_TOKEN: 'test-token', GITHUB_REPOSITORY: 'lukka/get-cmake',
    RELEASE_COMMIT: TARGET, ...options.env
  };
  const run = jest.fn((command: string, args: string[]): Result => {
    const failure = options.failure && options.failure(command, args);
    if (failure) return failure;
    if (command === 'git') {
      switch (args[0]) {
        case 'fetch':
          if (args.includes('--no-tags')) fetchedTag = args[3];
          return ok();
        case 'rev-parse': {
          expect(args.slice(1, 4)).toEqual(['--verify', '--end-of-options', args[3]]);
          const ref = args[3];
          const latestFetched = options.latestRelease &&
            fetchedTag === `refs/tags/${options.latestRelease.tag_name}`;
          if (ref === 'FETCH_HEAD') return ok(latestFetched ? LATEST_TAG_OBJECT : TAG_OBJECT);
          const revisions: { [ref: string]: string } = {
            'refs/remotes/origin/main^{commit}': MAIN,
            'HEAD^{commit}': MAIN,
            'FETCH_HEAD^{commit}': latestFetched ? options.latestCommit || BASE : fetchedTag ? TAGGED : '',
            [`${TARGET}^{commit}`]: TARGET,
            [`${BASE}^{commit}`]: BASE,
            [`${TARGET}^1^{commit}`]: BASE,
            [`${MAIN}^1^{commit}`]: BASE,
            [`${TAGGED}^1^{commit}`]: BASE
          };
          return revisions[ref] ? ok(revisions[ref]) : fail('fatal: Needed a single revision');
        }
        case 'merge-base':
          expect(args[1]).toBe('--is-ancestor');
          if (args[3] === 'refs/remotes/origin/main') {
            expect([TARGET, MAIN, TAGGED]).toContain(args[2]);
          } else if (options.latestRelease && args[2] === (options.latestCommit || BASE)) {
            expect([TARGET, MAIN, TAGGED]).toContain(args[3]);
            return options.latestIsAncestor === false ? fail('', 1) : ok();
          } else {
            expect(args[2]).toBe(BASE);
            expect([TARGET, MAIN, TAGGED]).toContain(args[3]);
          }
          return ok();
        case 'ls-tree': {
          const versions = commits[args[2]];
          if (!versions) return fail('unknown tree');
          return ok(Object.keys(MARKERS)
            .filter(key => versions[key as keyof Versions] !== undefined)
            .map(key => MARKERS[key]).join('\n'));
        }
        case 'show': {
          const [sha, path] = args[1].split(':');
          const key = Object.keys(MARKERS).find(key => MARKERS[key] === path) as keyof Versions;
          const version = commits[sha] && commits[sha][key];
          return version === undefined ? fail('missing marker') : ok(`${version}\n`);
        }
        case 'ls-remote':
          expect(args.slice(1, 3)).toEqual(['--tags', 'origin']);
          if (options.latestRelease && args[3] === `refs/tags/${options.latestRelease.tag_name}`) {
            return ok(`${LATEST_TAG_OBJECT}\t${args[3]}\n`);
          }
          return ok(options.existingTag ? `${TAG_OBJECT}\t${args[3]}\n` : '');
        case 'push':
          return ok();
      }
    }
    if (command === 'gh') {
      if (args[0] === 'api' && args[1] === 'repos/lukka/get-cmake/releases?per_page=100') {
        expect(args.slice(2)).toEqual(['--paginate', '--jq', '[.[] | {tag_name, draft}] | @json']);
        return ok((options.releasePages || [options.release ? [options.release] : []])
          .map(page => JSON.stringify(page.map(({ tag_name, draft }) => ({ tag_name, draft })))).join('\n'));
      }
      if (args[0] === 'api' && args[1] === 'repos/lukka/get-cmake/releases/latest') {
        return options.latestRelease ? ok(JSON.stringify(options.latestRelease)) : fail('gh: Not Found (HTTP 404)');
      }
      if (args[0] === 'api' && args[1].startsWith('repos/lukka/get-cmake/releases/tags/')) {
        // Like GitHub, the tag endpoint cannot find a draft's pending tag.
        return options.release && !options.release.draft
          ? ok(JSON.stringify(options.release)) : fail('gh: Not Found (HTTP 404)');
      }
      if (args[0] === 'api' && args[3].endsWith('/git/tags')) {
        createdTag = args.find(arg => arg.startsWith('tag='))!.slice(4);
        return ok(TAG_OBJECT);
      }
      if (args[0] === 'api' && args[3].endsWith('/git/refs')) {
        return ok(`refs/tags/${createdTag}`);
      }
      if (args[0] === 'release' && args[1] === 'create') {
        return ok(`https://github.com/lukka/get-cmake/releases/tag/${args[2]}`);
      }
    }
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  const summary = jest.fn();
  return {
    env, run, summary,
    publish: () => publishRelease(env, run, summary),
    mutations: () => run.mock.calls.filter(([command, args]) =>
      (command === 'git' && args[0] === 'push') ||
      (command === 'gh' && (args.includes('POST') || args[0] === 'release')))
  };
}

describe('deterministic release plan', () => {
  const cases = [
    { changed: ['cmake'], tag: 'v4.1.1', title: 'CMake v4.1.1' },
    { changed: ['rc'], tag: 'v4.2.0-rc2', title: 'CMake v4.2.0-rc2' },
    { changed: ['ninja'], tag: 'ninja-v1.13.0', title: 'Ninja v1.13.0' },
    { changed: ['cmake', 'rc'], tag: 'v4.1.1', title: 'CMake v4.1.1 and CMake v4.2.0-rc2' },
    { changed: ['cmake', 'ninja'], tag: 'v4.1.1', title: 'CMake v4.1.1 and Ninja v1.13.0' },
    { changed: ['rc', 'ninja'], tag: 'ninja-v1.13.0', title: 'CMake v4.2.0-rc2 and Ninja v1.13.0' },
    { changed: ['cmake', 'rc', 'ninja'], tag: 'v4.1.1', title: 'CMake v4.1.1 and CMake v4.2.0-rc2 and Ninja v1.13.0' }
  ];

  test.each(cases)('$changed selects $tag and the complete ordered title', ({ changed, tag, title }) => {
    const after = { ...before };
    for (const key of changed) after[key as keyof Versions] = updated[key as keyof Versions];
    const plan = createPlan(before, after);
    expect(plan).toMatchObject({ changed, tag, title, prerelease: changed.join() === 'rc' });
    expect(plan.notes).toContain('The `get-cmake` action downloads and caches CMake and Ninja');
    expect(plan.notes).toContain('https://docs.npmjs.com/about-semantic-versioning');
    expect(plan.notes.endsWith('\n\nEnjoy!\n')).toBe(true);
    expect(plan.notes.includes('`latest` is now using CMake')).toBe(changed.includes('cmake'));
    expect(plan.notes.includes('`latestrc` is now using CMake')).toBe(changed.includes('rc'));
    expect(plan.notes.includes('`latest` is now using Ninja')).toBe(changed.includes('ninja'));
    const f = fixture({ after });
    expect(f.publish()).toMatchObject({ tag, title, target: TARGET });
    const release = f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
    expect(release.includes('--prerelease')).toBe(changed.join() === 'rc');
  });

  test('preserves stable note formatting and gives RC an actionable YAML example', () => {
    const plan = createPlan(before, updated);
    expect(plan.notes).toContain(' - `latest` is now using CMake version `v4.1.1`, use this one-liner e.g.:\n `uses: lukka/get-cmake@latest`');
    expect(plan.notes).toContain('```yaml\n- uses: lukka/get-cmake@latest\n  with:\n    cmakeVersion: latestrc\n```');
    expect(plan.notes).toContain(' - `latest` is now using Ninja version `v1.13.0`.');
  });

  test('matches historical combined stable and RC release titles', () => {
    const historicalBefore = { cmake: '3.29.4', rc: '3.29.4', ninja: '1.12.0' };
    const historicalAfter = { cmake: '3.29.5', rc: '3.30.0-rc1', ninja: '1.12.0' };
    const f = fixture({ before: historicalBefore, after: historicalAfter });
    expect(f.publish()).toMatchObject({
      tag: 'v3.29.5',
      title: 'CMake v3.29.5 and CMake v3.30.0-rc1',
      prerelease: false
    });
    const create = f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
    expect(create[create.indexOf('--title') + 1]).toBe('CMake v3.29.5 and CMake v3.30.0-rc1');
  });

  test('matches historical RC-only release titles without an extra RC label', () => {
    const historicalBefore = { cmake: '4.1.3', rc: '4.1.3', ninja: '1.13.1' };
    const f = fixture({ before: historicalBefore, after: { ...historicalBefore, rc: '4.2.0-rc1' } });
    expect(f.publish()).toMatchObject({
      tag: 'v4.2.0-rc1', title: 'CMake v4.2.0-rc1', prerelease: true
    });
    const create = f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
    expect(create[create.indexOf('--title') + 1]).toBe('CMake v4.2.0-rc1');
    expect(create).toContain('--prerelease');
  });

  test('does nothing when markers are unchanged', () => {
    expect(createPlan(before, before)).toBeNull();
    const f = fixture({ after: before });
    expect(f.publish()).toMatchObject({ skipped: true });
    expect(f.mutations()).toEqual([]);
    expect(f.run.mock.calls.some(([cmd]) => cmd === 'gh')).toBe(false);
  });

  test('does not release a changed RC alias that falls back to current stable', () => {
    const after = { ...before, rc: before.cmake };
    expect(createPlan(before, after)).toBeNull();
    const f = fixture({ after });
    expect(f.publish().skipped).toBe(true);
    expect(f.mutations()).toEqual([]);
    const plan = createPlan(before, { ...updated, rc: updated.cmake });
    expect(plan.changed).toEqual(['cmake', 'ninja']);
    expect(plan.title).not.toContain('RC');
    expect(plan.notes).not.toContain('latestrc');
  });

  test('permits stable numeric RC markers but not duplicate RC recovery', () => {
    expect(createPlan(before, { ...before, rc: '4.0.9' }).prerelease).toBe(true);
    expect(createPlan(before, { ...before, rc: before.cmake }, `v${before.cmake}`).changed).toEqual(['cmake']);
    expect(() => createPlan(before, before, `v${updated.rc}`)).toThrow('does not match');
  });

  test('new marker files count as changed, but missing target markers fail', () => {
    expect(createPlan({}, updated).changed).toEqual(['cmake', 'rc', 'ninja']);
    expect(() => createPlan(before, { cmake: updated.cmake })).toThrow('missing rc');
    const f = fixture({ after: { cmake: updated.cmake } });
    expect(f.publish).toThrow('missing rc');
    expect(f.mutations()).toEqual([]);
  });

  test.each([
    '4.1', 'v4.1.0', '04.1.0', '4.01.0', '4.1.00', '4.1.0-beta1', '4.1.0+build',
    '4.1.0; touch owned', '$(echo owned)', '--help', '4.1.0\n# injected', '4.1.0\n'
  ])('rejects unsafe or noncanonical marker version %j', version => {
    expect(() => validateVersions({ ...before, cmake: version })).toThrow();
    expect(() => validateVersions({ ...before, ninja: version })).toThrow();
    const f = fixture({ after: { ...before, cmake: version } });
    // A conventional trailing marker newline is intentionally trimmed when reading Git blobs.
    if (version !== '4.1.0\n') {
      expect(f.publish).toThrow('marker version');
      expect(f.mutations()).toEqual([]);
    }
  });

  test.each(['4.1.0-rc', '4.1.0-rc01', '4.1.0-rc1;echo bad', '4.1.0-rc1\nmore'])(
    'rejects malformed RC %j', rc => {
      expect(() => validateVersions({ ...before, rc })).toThrow();
    }
  );

  test.each(['v4.1.0;echo bad', 'v4.1.0\n', 'ninja-v1.2.3-rc1', '-v4.1.0', 'v04.1.0', 'v4.1.0-anything'])(
    'rejects invalid manual tag %j before any commands', tag => {
      expect(() => validateTag(tag)).toThrow();
      const f = fixture({ env: { TAG_NAME: tag } });
      expect(f.publish).toThrow('Invalid TAG_NAME');
      expect(f.run).not.toHaveBeenCalled();
    }
  );

  test('manual tags must match primary changes even when matching another marker', () => {
    expect(() => createPlan(before, updated, `ninja-v${updated.ninja}`)).toThrow('detected primary tag');
    expect(() => createPlan(before, updated, `v${updated.rc}`)).toThrow('detected primary tag');
    const f = fixture({ env: { TAG_NAME: 'v9.9.9' } });
    expect(f.publish).toThrow('detected primary tag');
    expect(f.mutations()).toEqual([]);
  });

  test.each([
    ['cmake', 'v4.1.0'], ['rc', 'v4.2.0-rc1'], ['ninja', 'ninja-v1.12.0']
  ])('infers explicit %s recovery when there are no changes', (key, tag) => {
    expect(createPlan(before, before, tag).changed).toEqual([key]);
  });
});

describe('publisher targeting, preservation and failure handling', () => {
  test('tags the exact merge commit while latest follows fetched main', () => {
    const f = fixture({ env: { GITHUB_STEP_SUMMARY: 'release-summary' } });
    const result = f.publish();
    const object = f.run.mock.calls.find(([cmd, args]) =>
      cmd === 'gh' && args.includes(`object=${TARGET}`));
    expect(object).toBeDefined();
    expect(f.run).toHaveBeenCalledWith('git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', TARGET, 'refs/remotes/origin/main']);
    expect(f.run).toHaveBeenCalledWith('git', ['push', 'origin', 'refs/remotes/origin/main:refs/heads/latest', '--force']);
    expect(result.title).toBe('CMake v4.1.1');
    expect(result.summary).toContain('https://github.com/lukka/get-cmake/releases/tag/v4.1.1');
    expect(f.summary).toHaveBeenCalledWith('release-summary', `${result.summary}\n`);
  });

  test('without a manual existing tag or RELEASE_COMMIT, targets HEAD', () => {
    const f = fixture({ env: { RELEASE_COMMIT: undefined } });
    expect(f.publish().target).toBe(MAIN);
    expect(f.run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']);
    expect(f.run.mock.calls.some(([, args]) => args.includes(`object=${MAIN}`))).toBe(true);
  });

  test('manual existing tag uses its historical target, not current HEAD', () => {
    const f = fixture({
      existingTag: true,
      env: { RELEASE_COMMIT: undefined, TAG_NAME: 'v4.1.1' }
    });
    expect(f.publish().target).toBe(TAGGED);
    expect(f.run.mock.calls.some(([, args]) => args.includes('HEAD^{commit}'))).toBe(false);
    expect(f.run.mock.calls.some(([, args]) => args.includes('POST'))).toBe(false);
    expect(f.run).toHaveBeenCalledWith('git', ['fetch', '--no-tags', 'origin', 'refs/tags/v4.1.1']);
  });

  test.each([
    { key: 'cmake', tag: 'v4.1.1', component: 'CMake', alias: 'latest' },
    { key: 'rc', tag: 'v4.2.0-rc2', component: 'CMake RC', alias: 'latestrc' },
    { key: 'ninja', tag: 'ninja-v1.13.0', component: 'Ninja', alias: 'latest' }
  ])('manual $key recovery advertises aliases from current main, not the tag', ({ key, tag, component, alias }) => {
    const main = { cmake: '9.0.0', rc: '9.1.0-rc1', ninja: '9.0.0' };
    const f = fixture({
      after: { ...before, [key]: updated[key as keyof Versions] }, main, existingTag: true,
      env: { RELEASE_COMMIT: undefined, TAG_NAME: tag }
    });
    const result = f.publish();
    expect(result.target).toBe(TAGGED);
    expect(result.tag).toBe(tag);
    expect(result.notes).toContain(`This tagged catalog includes ${component} version \`v${updated[key as keyof Versions]}\``);
    expect(result.notes).toContain(`\`${alias}\` currently uses ${key === 'ninja' ? 'Ninja' : 'CMake'} version \`v${main[key as keyof Versions]}\``);
    expect(result.notes).not.toContain(`is now using ${key === 'ninja' ? 'Ninja' : 'CMake'} version \`v${updated[key as keyof Versions]}\``);
  });

  test('queued combined updates retain target versions but advertise current alias versions', () => {
    const main = { cmake: '9.0.0', rc: '9.1.0-rc1', ninja: '9.0.0' };
    const f = fixture({ after: updated, main });
    const result = f.publish();
    expect(result.title).toBe('CMake v4.1.1 and CMake v4.2.0-rc2 and Ninja v1.13.0');
    expect(result.notes).toContain('`latest` currently uses CMake version `v9.0.0`');
    expect(result.notes).toContain('`latestrc` currently uses CMake version `v9.1.0-rc1`');
    expect(result.notes).toContain('`latest` currently uses Ninja version `v9.0.0`');
  });

  test('preserves an existing tag and published release but still syncs latest', () => {
    const release = { tag_name: 'v4.1.1', draft: false, name: 'Hand edited title', body: 'Keep these notes' };
    const f = fixture({ existingTag: true, release });
    expect(f.publish().summary).toContain('already published; preserved unchanged');
    expect(f.mutations()).toEqual([
      ['git', ['push', 'origin', 'refs/remotes/origin/main:refs/heads/latest', '--force']]
    ]);
    expect(release).toEqual({ tag_name: 'v4.1.1', draft: false, name: 'Hand edited title', body: 'Keep these notes' });
  });

  test('publishes a missing release for an existing tag with --verify-tag', () => {
    const f = fixture({ existingTag: true });
    f.publish();
    expect(f.run.mock.calls.some(([, args]) => args.includes('POST'))).toBe(false);
    const create = f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
    expect(create.slice(0, 6)).toEqual(['release', 'create', 'v4.1.1', '--repo', 'lukka/get-cmake', '--verify-tag']);
  });

  test('allows explicit no-change tag-only recovery against an explicit base', () => {
    const f = fixture({
      before, after: before, existingTag: true,
      env: { RELEASE_COMMIT: undefined, TAG_NAME: 'ninja-v1.12.0', BASE_REF: BASE }
    });
    expect(f.publish()).toMatchObject({ target: TAGGED, changed: ['ninja'], tag: 'ninja-v1.12.0' });
    expect(f.run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--end-of-options', `${BASE}^{commit}`]);
  });

  test('publishes all changes across an explicit push range when the final commit changes no markers', () => {
    const immediateParent = { ...updated };
    const finalCommit = { ...immediateParent };
    expect(createPlan(immediateParent, finalCommit)).toBeNull();
    const f = fixture({
      before, after: finalCommit,
      env: { RELEASE_COMMIT: TARGET, BASE_REF: BASE },
      failure: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse' && args[3] === `${TARGET}^1^{commit}`
        ? fail('must compare the full push range, not only the final commit') : undefined
    });
    expect(f.publish()).toMatchObject({
      target: TARGET,
      changed: ['cmake', 'rc', 'ninja'],
      tag: 'v4.1.1',
      title: 'CMake v4.1.1 and CMake v4.2.0-rc2 and Ninja v1.13.0',
      prerelease: false
    });
    expect(f.run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--end-of-options', `${BASE}^{commit}`]);
    expect(f.run).not.toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--end-of-options', `${TARGET}^1^{commit}`]);
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', BASE, TARGET]);
    const create = f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
    expect(create[create.indexOf('--title') + 1]).toBe('CMake v4.1.1 and CMake v4.2.0-rc2 and Ninja v1.13.0');
    const notes = create[create.indexOf('--notes') + 1];
    expect(notes).toContain('`latest` is now using CMake version `v4.1.1`');
    expect(notes).toContain('`latestrc` is now using CMake version `v4.2.0-rc2`');
    expect(notes).toContain('`latest` is now using Ninja version `v1.13.0`');
  });

  test.each([false, true])('refuses a draft before any writes (existing tag: %s)', existingTag => {
    const f = fixture({ existingTag, release: { tag_name: 'v4.1.1', draft: true } });
    expect(f.publish).toThrow('still a draft');
    expect(f.mutations()).toEqual([]);
    expect(f.run.mock.calls.some(([, args]) => args[1].includes('/releases/tags/'))).toBe(false);
  });

  test('finds a matching draft on a later page even if a published release also matches', () => {
    const f = fixture({
      existingTag: true,
      releasePages: [
        [{ tag_name: 'v4.1.1', draft: false }, { tag_name: 'v4.2.0', draft: true }],
        [{ tag_name: 'v4.1.1', draft: true }]
      ]
    });
    expect(f.publish).toThrow('still a draft');
    expect(f.mutations()).toEqual([]);
  });

  test('preserves a published release found after the first page and ignores unrelated drafts', () => {
    const f = fixture({
      existingTag: true,
      releasePages: [
        [{ tag_name: 'v4.2.0', draft: true }],
        [{ tag_name: 'v4.1.1', draft: false }]
      ]
    });
    expect(f.publish().summary).toContain('already published; preserved unchanged');
    expect(f.mutations()).toEqual([
      ['git', ['push', 'origin', 'refs/remotes/origin/main:refs/heads/latest', '--force']]
    ]);
  });

  test.each(['null', '{}', '[null]', '[{"tag_name":"v4.1.1"}]', 'not JSON', ''])(
    'rejects malformed release listing %j before writes', output => {
      const f = fixture({
        failure: (cmd, args) => cmd === 'gh' && args[1].includes('/releases?')
          ? ok(output) : undefined
      });
      expect(f.publish).toThrow();
      expect(f.mutations()).toEqual([]);
    }
  );

  test('refuses a published release without its remote tag', () => {
    const f = fixture({ release: { tag_name: 'v4.1.1', draft: false } });
    expect(f.publish).toThrow('Existing release has no matching remote tag');
    expect(f.mutations()).toEqual([]);
  });

  test.each(['cmake', 'rc', 'ninja'])('refuses existing tags with a differing changed %s marker', key => {
    const f = fixture({
      after: updated, existingTag: true, tagged: { ...updated, [key]: before[key as keyof Versions] }
    });
    expect(f.publish).toThrow(`different ${key} marker version`);
    expect(f.mutations()).toEqual([]);
  });

  test.each([
    'gh: Bad credentials (HTTP 401)', 'gh: Resource not accessible (HTTP 403)', 'gh: Not Found (HTTP 404)',
    'gh: API rate limit exceeded (HTTP 429)', 'gh: Internal Server Error (HTTP 500)',
    'error connecting to api.github.com: network unreachable'
  ])('does not treat release lookup error %j as absence', stderr => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'gh' && args[0] === 'api' && args[1].startsWith('repos/')
        ? fail(stderr) : undefined
    });

    expect(f.publish).toThrow('Release lookup failed');
    expect(f.mutations()).toEqual([]);
  });

  test('does not ignore a failure fetching a later release-listing page', () => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'gh' && args[1].includes('/releases?')
        ? { ...fail('gh: Internal Server Error (HTTP 500)'), stdout: '[]\n' } : undefined
    });
    expect(f.publish).toThrow('Release lookup failed');
    expect(f.mutations()).toEqual([]);
  });

  test.each(['fetch', 'ls-remote'])('propagates git %s failures before mutations', operation => {
    const f = fixture({ failure: (cmd, args) => cmd === 'git' && args[0] === operation ? fail('remote unavailable') : undefined });
    expect(f.publish).toThrow('remote unavailable');
    expect(f.mutations()).toEqual([]);
  });

  test.each(['RELEASE_COMMIT', 'BASE_REF'])('safely rejects invalid/injection %s refs', variable => {
    const ref = '--help;$(echo owned)';
    const f = fixture({ env: { [variable]: ref } });
    expect(f.publish).toThrow('Needed a single revision');
    expect(f.run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    expect(f.mutations()).toEqual([]);
  });

  test('validates the default first parent as an ancestor of the target', () => {
    const f = fixture();
    f.publish();
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', BASE, TARGET]);
  });

  test.each(['HEAD', BASE])('rejects non-ancestor comparison base %s before any mutation', baseRef => {
    const f = fixture({
      env: { BASE_REF: baseRef },
      failure: (cmd, args) => cmd === 'git' && args[0] === 'merge-base' && args[3] === TARGET
        ? fail('comparison base is not an ancestor') : undefined
    });
    expect(f.publish).toThrow('comparison base is not an ancestor');
    expect(f.run).toHaveBeenCalledWith('git', [
      'merge-base', '--is-ancestor', baseRef === 'HEAD' ? MAIN : BASE, TARGET
    ]);
    expect(f.mutations()).toEqual([]);
    expect(f.summary).not.toHaveBeenCalled();
    expect(f.run.mock.calls.some(([cmd]) => cmd === 'gh')).toBe(false);
  });

  test('rejects targets outside main, including an existing remote tag', () => {
    for (const existingTag of [false, true]) {
      const f = fixture({
        existingTag,
        env: existingTag ? { RELEASE_COMMIT: undefined, TAG_NAME: 'v4.1.1' } : {},
        failure: (cmd, args) => cmd === 'git' && args[0] === 'merge-base' ? fail('not an ancestor') : undefined
      });
      expect(f.publish).toThrow('not an ancestor');
      expect(f.mutations()).toEqual([]);
    }
  });

  test('detects a tag moving between ls-remote and fetch without overwriting it', () => {
    const f = fixture({
      existingTag: true,
      failure: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse' && args[3] === 'FETCH_HEAD' ? ok('f'.repeat(40)) : undefined
    });
    expect(f.publish).toThrow('Remote tag changed');
    expect(f.mutations()).toEqual([]);
  });

  test('rejects malformed ls-remote data rather than considering the tag absent', () => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'git' && args[0] === 'ls-remote' ? ok('bad-sha refs/tags/v4.1.1') : undefined
    });
    expect(f.publish).toThrow('Invalid remote tag');
    expect(f.mutations()).toEqual([]);
  });

  test.each([
    ['tag object', '/git/tags', 'null', 'Invalid tag object SHA'],
    ['tag ref', '/git/refs', 'refs/tags/wrong', 'Invalid tag reference']
  ])('validates the returned %s before publishing', (_name, endpoint, output, error) => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'gh' && args.includes('POST') && args[3].endsWith(endpoint) ? ok(output) : undefined
    });
    expect(f.publish).toThrow(error);
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'release' || args[0] === 'push')).toBe(false);
  });

  test('reports publication failure without claiming success or syncing latest', () => {
    const f = fixture({
      env: { GITHUB_STEP_SUMMARY: 'release-summary' },
      failure: (cmd, args) => cmd === 'gh' && args[0] === 'release' ? fail('publication failed') : undefined
    });
    expect(f.publish).toThrow('publication failed');
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false);
    expect(f.summary).not.toHaveBeenCalled();
  });

  test('reports latest push failure rather than writing a successful summary', () => {
    const f = fixture({
      env: { GITHUB_STEP_SUMMARY: 'release-summary' },
      failure: (cmd, args) => cmd === 'git' && args[0] === 'push' ? fail('push rejected') : undefined
    });
    expect(f.publish).toThrow('push rejected');
    expect(f.summary).not.toHaveBeenCalled();
  });
});

describe('GitHub Latest designation', () => {
  const latestRelease = { tag_name: 'v4.1.0', draft: false, prerelease: false };
  const createArgs = (f: ReturnType<typeof fixture>) =>
    f.run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];

  test('promotes the first stable release when the Latest endpoint returns 404', () => {
    const f = fixture();
    f.publish();
    expect(createArgs(f)).toContain('--latest=true');
  });

  test.each([
    { after: { ...before, cmake: updated.cmake }, tag: 'v4.1.1', latest: 'ninja-v1.12.0' },
    { after: { ...before, ninja: updated.ninja }, tag: 'ninja-v1.13.0', latest: 'v4.1.0' }
  ])('promotes a newer $tag across component tag namespaces', ({ after, latest }) => {
    const f = fixture({ after, latestRelease: { ...latestRelease, tag_name: latest } });
    f.publish();
    expect(createArgs(f)).toContain('--latest=true');
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', BASE, TARGET]);
  });

  test('accepts an existing Latest release with a nonstandard tag name', () => {
    const tag = 'fix-issue-165';
    const f = fixture({ latestRelease: { ...latestRelease, tag_name: tag } });
    f.publish();
    expect(f.run).toHaveBeenCalledWith('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
    expect(createArgs(f)).toContain('--latest=true');
  });

  test.each([
    { name: 'manual recovery', existingTag: true, env: { RELEASE_COMMIT: undefined, TAG_NAME: 'v4.1.1' }, commit: TAGGED },
    { name: 'automatic rerun with an existing tag', existingTag: true, env: {}, commit: TAGGED },
    { name: 'automatic delayed publication with no tag', existingTag: false, env: {}, commit: TARGET }
  ])('does not replace a newer Latest during $name', ({ existingTag, env, commit }) => {
    const f = fixture({
      existingTag, env, latestRelease: { ...latestRelease, tag_name: 'ninja-v9.0.0' },
      latestCommit: MAIN, latestIsAncestor: false
    });
    f.publish();
    expect(createArgs(f)).toContain('--latest=false');
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', MAIN, commit]);
    expect(f.run).toHaveBeenCalledWith('git', ['push', 'origin', 'refs/remotes/origin/main:refs/heads/latest', '--force']);
  });

  test('does not replace Latest with another tag at the same preserved tag commit', () => {
    const f = fixture({ existingTag: true, latestRelease, latestCommit: TAGGED });
    f.publish();
    expect(createArgs(f)).toContain('--latest=false');
    expect(f.run).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', TAGGED, TAGGED]);
  });

  test('never promotes a prerelease or looks up Latest for it', () => {
    const f = fixture({ after: { ...before, rc: updated.rc }, latestRelease });
    f.publish();
    expect(createArgs(f)).toContain('--prerelease');
    expect(createArgs(f)).toContain('--latest=false');
    expect(f.run).not.toHaveBeenCalledWith('gh', ['api', 'repos/lukka/get-cmake/releases/latest']);
  });

  test('does not inspect or change Latest when preserving an already published release', () => {
    const f = fixture({
      existingTag: true, release: { tag_name: 'v4.1.1', draft: false },
      failure: (cmd, args) => cmd === 'gh' && args[1].endsWith('/releases/latest')
        ? fail('Latest must not be queried') : undefined
    });
    expect(f.publish().summary).toContain('already published; preserved unchanged');
    expect(f.run).not.toHaveBeenCalledWith('gh', ['api', 'repos/lukka/get-cmake/releases/latest']);
  });

  test.each([
    'gh: Bad credentials (HTTP 401)', 'gh: Resource not accessible (HTTP 403)',
    'gh: API rate limit exceeded (HTTP 429)', 'gh: Internal Server Error (HTTP 500)',
    'error connecting to api.github.com: network unreachable'
  ])('does not treat Latest lookup error %j as no Latest release', stderr => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'gh' && args[1].endsWith('/releases/latest')
        ? fail(stderr) : undefined
    });
    expect(f.publish).toThrow('Latest release lookup failed');
    expect(f.mutations()).toEqual([]);
  });

  test.each([
    null, {}, { ...latestRelease, draft: true }, { ...latestRelease, prerelease: true },
    { ...latestRelease, tag_name: '' }, { ...latestRelease, tag_name: 'v4.1.0\n' }
  ])('rejects invalid Latest response %j before writes', response => {
    const f = fixture({
      failure: (cmd, args) => cmd === 'gh' && args[1].endsWith('/releases/latest')
        ? ok(JSON.stringify(response)) : undefined
    });
    expect(f.publish).toThrow('Invalid latest release response');
    expect(f.mutations()).toEqual([]);
  });

  test('refuses a Latest release without its remote tag', () => {
    const f = fixture({
      latestRelease,
      failure: (cmd, args) => cmd === 'git' && args[0] === 'ls-remote' && args[3] === 'refs/tags/v4.1.0'
        ? ok() : undefined
    });
    expect(f.publish).toThrow('Latest release has no matching remote tag');
    expect(f.mutations()).toEqual([]);
  });

  test('propagates ancestry errors rather than promoting or silently demoting the release', () => {
    const f = fixture({
      latestRelease, latestCommit: MAIN,
      failure: (cmd, args) => cmd === 'git' && args[0] === 'merge-base' && args[2] === MAIN && args[3] === TARGET
        ? fail('invalid ancestry comparison', 128) : undefined
    });
    expect(f.publish).toThrow('Latest release comparison failed');
    expect(f.mutations()).toEqual([]);
  });
});

describe('publisher with real Git repositories', () => {
  test.each([
    { tag: 'v4.1.1', latestTag: 'ninja-v1.13.0', promote: false },
    { tag: 'ninja-v1.13.0', latestTag: 'v4.1.1', promote: true }
  ])('recovers $tag without moving tags and sets Latest to $promote', ({ tag, latestTag, promote }) => {
    const directory = mkdtempSync(join(tmpdir(), 'get-cmake-release-'));
    const work = join(directory, 'work');
    const origin = join(directory, 'origin.git');
    mkdirSync(work);
    const runGit = (args: string[]): Result => {
      const result = spawnSync('git', args, { cwd: work, encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status === null) throw new Error('Git command was terminated');
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const git = (args: string[]) => {
      const result = runGit(args);
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    const commit = (versions: Versions) => {
      for (const key of Object.keys(MARKERS)) {
        writeFileSync(join(work, MARKERS[key]), `${versions[key as keyof Versions]}\n`);
      }
      git(['add', '.']);
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'Update versions']);
      return git(['rev-parse', 'HEAD']);
    };
    try {
      git(['init', '--bare', origin]);
      git(['init', '--initial-branch=main']);
      git(['config', 'user.name', 'Release test']);
      git(['config', 'user.email', 'release-test@example.invalid']);
      git(['remote', 'add', 'origin', origin]);
      commit(before);
      const stable = commit({ ...before, cmake: updated.cmake });
      git(['-c', 'tag.gpgsign=false', 'tag', '-a', 'v4.1.1', '-m', 'Stable release']);
      const ninja = commit({ ...before, cmake: updated.cmake, ninja: updated.ninja });
      git(['-c', 'tag.gpgsign=false', 'tag', 'ninja-v1.13.0']);
      git(['push', 'origin', 'main', '--tags']);
      const originalTags = git(['--git-dir', origin, 'show-ref', '--tags']);
      const latestRelease = { tag_name: latestTag, draft: false, prerelease: false };
      const run = jest.fn((command: string, args: string[]): Result => {
        if (command === 'git') return runGit(args);
        if (command === 'gh' && args[0] === 'api') {
          if (args[1].includes('/releases?')) return ok(JSON.stringify([latestRelease]));
          if (args[1].endsWith('/releases/latest')) return ok(JSON.stringify(latestRelease));
        }
        if (command === 'gh' && args[0] === 'release' && args[1] === 'create') return ok();
        throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
      });
      const result = publishRelease({
        GH_TOKEN: 'test-token', GITHUB_REPOSITORY: 'lukka/get-cmake', TAG_NAME: tag
      }, run);
      expect(result.target).toBe(tag === 'v4.1.1' ? stable : ninja);
      const create = run.mock.calls.find(([cmd, args]) => cmd === 'gh' && args[0] === 'release')![1];
      expect(create).toContain(`--latest=${promote}`);
      expect(create).toContain('--verify-tag');
      expect(git(['--git-dir', origin, 'rev-parse', 'refs/heads/latest'])).toBe(ninja);
      expect(git(['--git-dir', origin, 'show-ref', '--tags'])).toBe(originalTags);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe.each(['auto-release.yml', 'sync-latest-and-tag.yml'])('release workflow queuing in %s', workflow => {
  test.each(['\n', '\r\n'])('preserves pending release runs with %j line endings', newline => {
    const source = readFileSync(join(__dirname, '..', '.github', 'workflows', workflow), 'utf8')
      .replace(/\r?\n/g, newline);
    expect(source).toMatch(/^concurrency:\r?\n  group: release-workflow\r?\n  cancel-in-progress: false\r?\n  queue: max$/m);
  });
});
export {};
