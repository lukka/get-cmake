# Release Process for get-cmake

This document describes the release process for the get-cmake action after a new CMake or Ninja version has been merged to the `main` branch.

## Overview

The get-cmake action uses two key reference points for users:
1. **`latest` branch** - Points to the most recent stable release
2. **Version tags** (e.g., `vX.Y.Z`) - Allow users to pin to specific versions

When a new CMake version is detected and merged to `main` via automated PR, a release is performed automatically (or can be done manually) to make it available to users.

## Release Steps

### Option 1: Automatic Release (Recommended)

The `auto-release.yml` workflow automatically handles releases when automated CMake version PRs are merged:

1. When a PR with title matching `[Automated] Adding cmake-vX.Y.Z` is merged to main
2. The workflow automatically:
   - Reads the version from `.latest_cmake_version`
   - Updates the `latest` branch to match `main`
   - Creates and pushes the version tag (if it doesn't exist)
   - Publishes a GitHub release named `CMake vX.Y.Z`, with the same notes format as [CMake v4.4.2](https://github.com/lukka/get-cmake/releases/tag/v4.4.2)

Existing tags and GitHub releases are preserved. If the tag exists but the GitHub release is missing, the workflow publishes the missing release.

**No manual action needed** - the release happens automatically!

### Option 2: Manual Release (Override/Fallback)

If you need to manually trigger a release or override the automatic process:

1. Go to the Actions tab in GitHub
2. Select "Sync latest branch and create release tag" workflow
3. Click "Run workflow"
4. Enter the tag name (e.g., `v4.2.3`)
5. Click "Run workflow" button

The workflow will:
- Validate the tag name format
- Update the `latest` branch to match `main`
- Create and push the specified version tag, unless it already exists
- Publish the GitHub release with the standard CMake title and notes, unless it already exists

Tags with a prerelease suffix (e.g., `v4.2.3-rc1`) are published as GitHub prereleases.

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
   Visit `https://github.com/lukka/get-cmake/releases/tag/vX.Y.Z` and confirm the title is `CMake vX.Y.Z` and the notes describe the version used by `@latest`.

4. **Test the action**:
   Create a test workflow using:
   ```yaml
   - uses: lukka/get-cmake@latest
   - uses: lukka/get-cmake@vX.Y.Z  # Replace with actual version
   ```

## What Users See

After the release:

- **Users using `@latest`**: Will automatically get the new CMake version
- **Users using `@vX.Y.Z`**: Can pin to specific versions
- **Users using older tags**: Will continue to use their pinned version

## Background: How New Versions Are Detected

The `build-test-tmpl.yml` workflow:
1. Runs `npm run generate-catalog` to query GitHub for new CMake/Ninja releases
2. Compares with `.latest_cmake_version` and `.latestrc_cmake_version`
3. If new versions found, creates an automated PR to main
4. When the PR is merged, the `auto-release.yml` workflow automatically creates the release

## Release Checklist

For manual releases or verification:

- [ ] Verify the PR with new CMake version was merged to `main`
- [ ] Check the version in `.latest_cmake_version` on main branch
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

**Problem**: Latest branch won't update
- **Solution**: Ensure you have write permissions to the repository. Check workflow logs in GitHub Actions.

**Problem**: Users not getting new version with `@latest`
- **Solution**: GitHub may cache action references. Users can try clearing cache or using a specific tag. Verify the latest branch is actually updated.

**Problem**: Auto-release workflow didn't trigger
- **Solution**: Check that the PR title matches the pattern `[Automated] Adding cmake-vX.Y.Z`. If needed, use the manual workflow as a fallback.
