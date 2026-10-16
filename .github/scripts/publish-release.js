'use strict';

const { spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const MARKERS = {
  cmake: '.latest_cmake_version',
  rc: '.latestrc_cmake_version',
  ninja: '.latest_ninja_version'
};
const NUMBER = '(?:0|[1-9][0-9]*)';
const STABLE = `${NUMBER}\\.${NUMBER}\\.${NUMBER}`;
const VERSION = new RegExp(`^${STABLE}$`);
const RC_VERSION = new RegExp(`^${STABLE}(?:-rc${NUMBER})?$`);
const TAG = new RegExp(`^(?:v${STABLE}(?:-rc${NUMBER})?|ninja-v${STABLE})$`);
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const INTRO = 'The `get-cmake` action downloads and caches CMake and Ninja on your workflows. Versions can be specified using [semantic versioning ranges](https://docs.npmjs.com/about-semantic-versioning) using [`cmakeVersion`](https://github.com/lukka/get-cmake/blob/latest/action.yml#L13) and [`ninjaVersion`](https://github.com/lukka/get-cmake/blob/latest/action.yml#L16) inputs.';

function validateVersions(versions, allowMissing = false) {
  for (const key of Object.keys(MARKERS)) {
    if (allowMissing && versions[key] === undefined) continue;
    if (typeof versions[key] !== 'string' || /\s/.test(versions[key]) ||
        !(key === 'rc' ? RC_VERSION : VERSION).test(versions[key])) {
      throw new Error(`Invalid or missing ${key} marker version`);
    }
  }
}

function validateTag(tag) {
  if (typeof tag !== 'string' || /\s/.test(tag) || !TAG.test(tag)) {
    throw new Error('Invalid TAG_NAME: expected vX.Y.Z, vX.Y.Z-rcN or ninja-vX.Y.Z');
  }
}

function createPlan(before, after, requestedTag) {
  validateVersions(before, true);
  validateVersions(after);
  if (requestedTag !== undefined) validateTag(requestedTag);
  let changed = Object.keys(MARKERS).filter(key =>
    before[key] !== after[key] && !(key === 'rc' && after.rc === after.cmake));

  // An explicit matching tag permits recovery even when the comparison has no changes.
  if (!changed.length && requestedTag) {
    const key = requestedTag === `ninja-v${after.ninja}` ? 'ninja' :
      requestedTag === `v${after.cmake}` ? 'cmake' :
      requestedTag === `v${after.rc}` && after.rc !== after.cmake ? 'rc' : undefined;
    if (key) changed = [key];
  }
  if (!changed.length) {
    if (requestedTag) throw new Error('TAG_NAME does not match the marker versions');
    return null;
  }
  const primary = changed.includes('cmake') ? 'cmake' :
    changed.includes('ninja') ? 'ninja' : 'rc';
  const tag = `${primary === 'ninja' ? 'ninja-v' : 'v'}${after[primary]}`;
  if (requestedTag && requestedTag !== tag) {
    throw new Error(`TAG_NAME does not match the detected primary tag ${tag}`);
  }
  const title = changed.map(key =>
    `${key === 'ninja' ? 'Ninja' : 'CMake'} v${after[key]}`
  ).join(' and ');
  const changes = changed.map(key => {
    if (key === 'cmake') {
      return ` - \`latest\` is now using CMake version \`v${after.cmake}\`, use this one-liner e.g.:\n \`uses: lukka/get-cmake@latest\``;
    }
    if (key === 'rc') {
      return ` - \`latestrc\` is now using CMake version \`v${after.rc}\`, use e.g.:\n\n\`\`\`yaml\n- uses: lukka/get-cmake@latest\n  with:\n    cmakeVersion: latestrc\n\`\`\``;
    }
    return ` - \`latest\` is now using Ninja version \`v${after.ninja}\`.`;
  });
  return {
    changed, versions: { ...after }, tag, title,
    prerelease: changed.length === 1 && changed[0] === 'rc',
    notes: `${INTRO}\n\nChanges:\n${changes.join('\n\n')}\n\nEnjoy!\n`
  };
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function publishRelease(env = process.env, run = runCommand, appendSummary = appendFileSync) {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || /\s/.test(repository) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repository)) {
    throw new Error('Invalid GITHUB_REPOSITORY');
  }
  if (!env.GH_TOKEN) throw new Error('GH_TOKEN is required');
  const requestedTag = env.TAG_NAME || undefined;
  if (requestedTag) validateTag(requestedTag);

  const checked = (command, args) => {
    const result = run(command, args);
    if (result.status !== 0) {
      throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout || result.status}`);
    }
    return (result.stdout || '').trim();
  };
  const git = args => checked('git', args);
  const gh = args => checked('gh', args);
  const resolve = ref => {
    const sha = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    if (!SHA.test(sha)) throw new Error('Invalid resolved commit SHA');
    return sha;
  };
  const remoteTag = tag => {
    const ref = `refs/tags/${tag}`;
    const output = git(['ls-remote', '--tags', 'origin', ref]);
    if (!output) return null;
    const [sha, name, ...extra] = output.split(/\s+/);
    if (!SHA.test(sha) || name !== ref || extra.length) {
      throw new Error('Invalid remote tag response');
    }
    return sha;
  };
  const fetchTag = (tag, expectedSha) => {
    // Fetch only to FETCH_HEAD; never replace an existing local or remote tag.
    git(['fetch', '--no-tags', 'origin', `refs/tags/${tag}`]);
    const actualSha = git(['rev-parse', '--verify', '--end-of-options', 'FETCH_HEAD']);
    if (actualSha !== expectedSha) throw new Error('Remote tag changed while fetching');
    return resolve('FETCH_HEAD');
  };
  const onMain = commit => {
    git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  };
  const readVersions = (commit, allowMissing = false) => {
    const files = git(['ls-tree', '--name-only', commit, '--', ...Object.values(MARKERS)]).split('\n');
    const versions = {};
    for (const [key, file] of Object.entries(MARKERS)) {
      if (files.includes(file)) versions[key] = git(['show', `${commit}:${file}`]);
    }
    validateVersions(versions, allowMissing);
    return versions;
  };
  const summarize = text => {
    if (env.GITHUB_STEP_SUMMARY) appendSummary(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    return text;
  };

  git(['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  resolve('refs/remotes/origin/main');
  let existingTag;
  let tagCommit;
  if (!env.RELEASE_COMMIT && requestedTag) {
    existingTag = remoteTag(requestedTag);
    if (existingTag) tagCommit = fetchTag(requestedTag, existingTag);
  }
  const target = tagCommit || resolve(env.RELEASE_COMMIT || 'HEAD');
  onMain(target);
  const after = readVersions(target);
  const base = resolve(env.BASE_REF || `${target}^1`);
  git(['merge-base', '--is-ancestor', base, target]);
  const plan = createPlan(readVersions(base, true), after, requestedTag);
  if (!plan) return { skipped: true, summary: summarize('No marker changes; no release, tag or latest update needed.') };

  if (existingTag === undefined) existingTag = remoteTag(plan.tag);
  if (existingTag) {
    if (!tagCommit) tagCommit = fetchTag(plan.tag, existingTag);
    onMain(tagCommit);
    const taggedVersions = readVersions(tagCommit);
    for (const key of plan.changed) {
      if (taggedVersions[key] !== plan.versions[key]) {
        throw new Error(`Existing tag ${plan.tag} has a different ${key} marker version`);
      }
    }
  }

  const endpoint = `repos/${repository}/releases/tags/${plan.tag}`;
  const response = run('gh', ['api', endpoint]);
  let release;
  if (response.status === 0) {
    release = JSON.parse(response.stdout);
    if (!release || release.tag_name !== plan.tag || typeof release.draft !== 'boolean') {
      throw new Error('Invalid release response');
    }
    if (release.draft) throw new Error(`Release ${plan.tag} is still a draft; refusing to report it published`);
    if (!existingTag) throw new Error('Existing release has no matching remote tag');
  } else if (!/\(HTTP 404\)/.test(response.stderr || '')) {
    throw new Error(`Release lookup failed: ${response.stderr || response.stdout || response.status}`);
  }

  if (!existingTag) {
    const tagSha = gh([
      'api', '--method', 'POST', `repos/${repository}/git/tags`,
      '-f', `tag=${plan.tag}`, '-f', `message=Release ${plan.tag} - ${plan.title}`,
      '-f', `object=${target}`, '-f', 'type=commit', '--jq', '.sha'
    ]);
    if (!SHA.test(tagSha)) throw new Error('Invalid tag object SHA returned by GitHub');
    const ref = gh([
      'api', '--method', 'POST', `repos/${repository}/git/refs`,
      '-f', `ref=refs/tags/${plan.tag}`, '-f', `sha=${tagSha}`, '--jq', '.ref'
    ]);
    if (ref !== `refs/tags/${plan.tag}`) throw new Error('Invalid tag reference returned by GitHub');
  }
  if (!release) {
    gh([
      'release', 'create', plan.tag, '--repo', repository, '--verify-tag',
      '--title', plan.title, '--notes', plan.notes, ...(plan.prerelease ? ['--prerelease'] : [])
    ]);
  }
  git(['push', 'origin', 'refs/remotes/origin/main:refs/heads/latest', '--force']);
  const link = `https://github.com/${repository}/releases/tag/${plan.tag}`;
  const summary = summarize([
    `## ${plan.title}`, '',
    `- Tag \`${plan.tag}\` ${existingTag ? 'preserved' : 'created'}.`,
    `- [GitHub release](${link}) ${release ? 'already published; preserved unchanged' : 'published'}.`,
    '- Latest branch synced with origin/main.'
  ].join('\n'));
  return { ...plan, target, summary };
}

module.exports = { MARKERS, validateVersions, validateTag, createPlan, publishRelease, runCommand };

if (require.main === module) {
  try {
    console.log(publishRelease().summary);
  } catch (error) {
    console.error(`Release publishing failed: ${error.message}`);
    process.exitCode = 1;
  }
}
