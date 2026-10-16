const {
  MARKERS, createPlan, publishRelease, validateTag, validateVersions
} = require('../.github/scripts/publish-release');

type Versions = { cmake?: string; rc?: string; ninja?: string };
type Result = { status: number; stdout: string; stderr: string };
type Failure = (command: string, args: string[]) => Result | undefined;

const BASE = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);
const TAGGED = 'd'.repeat(40);
const TAG_OBJECT = 'e'.repeat(40);
const before = { cmake: '4.1.0', rc: '4.2.0-rc1', ninja: '1.12.0' };
const updated = { cmake: '4.1.1', rc: '4.2.0-rc2', ninja: '1.13.0' };
const ok = (stdout = ''): Result => ({ status: 0, stdout, stderr: '' });
const fail = (stderr: string, status = 1): Result => ({ status, stdout: '', stderr });

// Model read-only Git state and GitHub responses; every write is recorded, never executed.
function fixture(options: {
  before?: Versions;
  after?: Versions;
  tagged?: Versions;
  existingTag?: boolean;
  release?: { tag_name: string; draft: boolean; name?: string; body?: string };
  failure?: Failure;
  env?: { [key: string]: string | undefined };
} = {}) {
  const after = options.after || { ...before, cmake: updated.cmake };
  const commits: { [sha: string]: Versions } = {
    [BASE]: options.before || before,
    [TARGET]: after,
    [MAIN]: { cmake: '9.0.0', rc: '9.1.0-rc1', ninja: '9.0.0' },
    [TAGGED]: options.tagged || after
  };
  let fetchedTag = false;
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
          if (args.includes('--no-tags')) fetchedTag = true;
          return ok();
        case 'rev-parse': {
          expect(args.slice(1, 4)).toEqual(['--verify', '--end-of-options', args[3]]);
          const ref = args[3];
          if (ref === 'FETCH_HEAD') return ok(TAG_OBJECT);
          const revisions: { [ref: string]: string } = {
            'refs/remotes/origin/main^{commit}': MAIN,
            'HEAD^{commit}': MAIN,
            'FETCH_HEAD^{commit}': fetchedTag ? TAGGED : '',
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
          return ok(options.existingTag ? `${TAG_OBJECT}\t${args[3]}\n` : '');
        case 'push':
          return ok();
      }
    }
    if (command === 'gh') {
      if (args[0] === 'api' && args[1].startsWith('repos/')) {
        return options.release ? ok(JSON.stringify(options.release)) : fail('gh: Not Found (HTTP 404)');
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

  test('refuses a draft without publishing it or mutating any refs', () => {
    const f = fixture({ existingTag: true, release: { tag_name: 'v4.1.1', draft: true } });
    expect(f.publish).toThrow('still a draft');
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
    'gh: Bad credentials (HTTP 401)', 'gh: Resource not accessible (HTTP 403)',
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
export {};
