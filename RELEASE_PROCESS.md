# Release Process for get-cmake

This document describes the release process for the get-cmake action after a new CMake or Ninja version has been merged to the `main` branch.

## Overview

The get-cmake action uses two key reference points for users:
1. **`latest` branch** - Points to the most recent stable release
2. **Version tags** (e.g., `vX.Y.Z` or `ninja-vX.Y.Z`) - Allow users to pin to specific catalog snapshots

When a new stable CMake, CMake release candidate, or Ninja version is merged to `main` via automated PR, a release is performed automatically (or can be done manually). Release detection and notes use fixed rules, without an LLM.

### Release formats and tag policy

The shared publisher, `.github/scripts/publish-release.js`, compares these version markers:

| Component | Version marker | Title entry | Notes |
| --- | --- | --- | --- |
| Stable CMake | `.latest_cmake_version` | `CMake vX.Y.Z` | New `latest` CMake version and one-line action usage |
| CMake RC | `.latestrc_cmake_version` | `CMake vX.Y.Z-rcN` | New `latestrc` version and usage with `cmakeVersion: latestrc` |
| Ninja | `.latest_ninja_version` | `Ninja vX.Y.Z` | New Ninja version available through `@latest` |

Combined updates produce one release: title entries are joined with ` and `, and the notes contain a separate entry for each changed component. For example, `CMake v3.29.5 and CMake v3.30.0-rc1` follows the [historical combined format](https://github.com/lukka/get-cmake/releases/tag/v3.29.5). RC-only notes follow the [historical RC format](https://github.com/lukka/get-cmake/releases/tag/v4.2.0-rc1), rather than claiming the default CMake version changed.

Tag selection is deterministic:

1. If stable CMake changed, use `v<CMake version>`.
2. Otherwise, if Ninja changed, use `ninja-v<Ninja version>`. This also applies to combined Ninja + RC updates and avoids reusing an unchanged stable CMake tag.
3. Otherwise, use `v<CMake RC version>` and mark the release as a GitHub prerelease.

Combined updates containing stable CMake or Ninja are not marked as prereleases. An RC marker that resolves to the stable CMake version is not announced as a separate RC update. Without changed markers or an explicit matching recovery tag, the publisher makes no release, tag, or `latest` branch changes.

Release titles and tagged catalog versions describe the release target. Usage notes for `@latest` and `cmakeVersion: latestrc` use the markers from current `main`, which is where the moving `latest` branch is synchronized. When recovering an older catalog, notes distinguish its versions from the versions currently selected by those aliases.

## Release Steps

### Option 1: Automatic Release (Recommended)

The `auto-release.yml` workflow automatically handles releases when version markers change on `main`, including merged automated tool version PRs:

1. When a push to `main` changes any of the three version markers
2. The workflow automatically:
   - Compares all three markers between the push's `before` and `after` commits
   - Generates the title, notes, tag, and prerelease status using the rules above
   - Updates the `latest` branch to match `main`
   - Creates an annotated version tag at the exact pushed commit (if it doesn't exist)
   - Publishes a GitHub release with the generated title and notes

Detection does not depend on PR titles and covers merge commits, squash merges, multi-commit rebase merges, and direct version updates on `main`. Using the push's exact commit range prevents a later merge from changing the versions announced by a queued release. The moving `latest` branch still tracks current `main`.

Both release workflows share a concurrency group with `queue: max` and `cancel-in-progress: false`. Up to 100 pending runs are retained instead of newer pushes replacing pending version updates; runs beyond GitHub's queue limit are canceled and require manual recovery.

Existing tags and GitHub releases are preserved. If a tag exists but the GitHub release is missing, the workflow publishes the missing release after checking that the tagged versions match the planned update.

New stable releases are explicitly marked Latest only if there is no current Latest release or its tagged commit is a strict ancestor of the new release's tagged commit. Older backfills, releases at the same commit, and prereleases use `--latest=false`, preserving the existing GitHub Latest designation independently of the moving `latest` branch.

**No manual action needed** - the release happens automatically!

### Option 2: Manual Release (Override/Fallback)

If you need to manually trigger a release or override the automatic process:

1. Go to the Actions tab in GitHub
2. Select "Sync latest branch and create release tag" workflow
3. Click "Run workflow"
4. Optionally enter the tag name (e.g., `v4.4.4`, `v4.5.0-rc1`, or `ninja-v1.13.1`) and comparison base ref
5. Click "Run workflow" button

When a release or recovery is detected, the workflow will:
- Detect changed versions with the same shared publisher as automatic releases
- Validate that a supplied tag name matches the detected update
- Update the `latest` branch to match `main`
- Create the selected version tag and publish the release, unless they already exist

Without a tag input, the release target is the checked-out `main` commit. With an existing tag, the target is that tag's commit, not today's `main`. The comparison base defaults to the target's first parent; set `base_ref` to an earlier commit when recovering a combined update spanning multiple commits. Targets must belong to `main` history.

If there are no marker changes at the target but a supplied tag matches a version marker, the publisher can recover a release for that component. Existing GitHub releases are left unchanged. The publisher checks all pages of the releases listing for matching drafts and fails before creating tags, publishing releases, or updating `latest` if one exists; publish or remove that draft manually before retrying. Authentication, network, and other lookup failures also stop publication rather than being treated as a missing release.

### Option 3: Manual Command-Line Process (Advanced)

If you prefer to do this manually via command line:

```bash
# 1. Ensure you're on the main branch and up to date
git checkout main
git pull origin main

# 2. Get the current commit SHA
MAIN_SHA=$(git rev-parse HEAD)
echo "Main is at: $MAIN_SHA"

# 3. Read the version from the version file
CMAKE_VERSION=$(cat .latest_cmake_version)
echo "CMake version: $CMAKE_VERSION"

# 4. Update the latest branch to point to main
git push origin HEAD:refs/heads/latest --force

# 5. Create and push the version tag
git tag -a "v${CMAKE_VERSION}" -m "Release v${CMAKE_VERSION}"
git push origin "v${CMAKE_VERSION}"
```

These commands only synchronize the branch and create the tag. To publish the GitHub release with the standard notes, run the manual workflow from Option 2 using the same tag name; the existing tag will be preserved.

## Verification

After the release process:

1. **Verify the latest branch**:
   ```bash
   git fetch origin
   git log origin/latest --oneline -1
   git log origin/main --oneline -1
   # These should show the same commit
   ```

2. **Verify the tag was created**:
   ```bash
   git ls-remote --tags origin | grep "vX.Y.Z"
   ```

3. **Verify the GitHub release was published**:
   Visit the selected tag's release page. Confirm the title includes all changed components, RC notes show `cmakeVersion: latestrc`, and RC-only releases have the prerelease flag.

4. **Test the action**:
   Create a test workflow using:
   ```yaml
   - uses: lukka/get-cmake@latest
   - uses: lukka/get-cmake@vX.Y.Z  # Replace with actual version
   ```

## What Users See

After the release:

- **Users using `@latest`**: Receive the updated catalog, including new Ninja versions
- **Users selecting `cmakeVersion: latestrc`**: Receive the updated CMake RC through that catalog
- **Users using version tags**: Can pin to a specific catalog snapshot
- **Users using older tags**: Will continue to use their pinned version

## Background: How New Versions Are Detected

The `build-test-tmpl.yml` workflow:
1. Runs `npm run generate-catalog` to query GitHub for new CMake/Ninja releases
2. Compares `.latest_cmake_version`, `.latestrc_cmake_version`, and `.latest_ninja_version` against main
3. If any versions changed (including Ninja-only updates), creates an automated PR to main containing the markers, catalog source, and bundled action
4. When the PR is merged, the `auto-release.yml` workflow automatically creates the release

## Release Checklist

For manual releases or verification:

- [ ] Verify the PR with new CMake or Ninja versions was merged to `main`
- [ ] Check all changed version markers at the release commit
- [ ] Verify `latest` branch points to same commit as `main`
- [ ] Verify the version tag was created
- [ ] Verify the GitHub release was published with the standard title and notes
- [ ] Test the action using `@latest` reference
- [ ] Update any release notes or announcements if needed

## Troubleshooting

**Problem**: Tag already exists
- **Solution**: Both workflows skip tag creation but still sync the latest branch and publish a missing GitHub release. Existing tags and release notes are not overwritten.

**Problem**: Tag exists but no GitHub release is visible
- **Solution**: Rerun the failed release workflow, or use the manual workflow with the existing tag name. Publication uses the existing tag without recreating it. The workflow requires `contents: write` permission.

**Problem**: Publisher reports a matching draft release
- **Solution**: Publish or remove the draft manually before retrying. A draft can exist before its remote tag is created; the workflow deliberately leaves both drafts and refs unchanged.

**Problem**: Requested tag or existing tagged versions do not match the detected update
- **Solution**: Check the target commit and comparison base. Supply the correct tag and, for a multi-commit update, `base_ref`. The publisher fails instead of overwriting a tag or announcing versions absent from that tag.

**Problem**: Latest branch won't update
- **Solution**: Ensure you have write permissions to the repository. Check workflow logs in GitHub Actions.

**Problem**: Users not getting new version with `@latest`
- **Solution**: GitHub may cache action references. Users can try clearing cache or using a specific tag. Verify the latest branch is actually updated.

**Problem**: Auto-release workflow didn't trigger
- **Solution**: Check that the push to `main` changes a version marker. Pushes made with `GITHUB_TOKEN` do not trigger another workflow, so use the manual workflow if the merge was performed using that token.
