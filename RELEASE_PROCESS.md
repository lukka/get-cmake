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
- Create and push the specified version tag

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

3. **Test the action**:
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
- [ ] Test the action using `@latest` reference
- [ ] Update any release notes or announcements if needed

## Troubleshooting

**Problem**: Tag already exists
- **Solution**: The auto-release workflow will skip tag creation but still sync the latest branch. For manual workflow, check if release was already done. If tag is incorrect, delete it first:
  ```bash
  git push origin :refs/tags/vX.Y.Z
  git tag -d vX.Y.Z
  ```

**Problem**: Latest branch won't update
- **Solution**: Ensure you have write permissions to the repository. Check workflow logs in GitHub Actions.

**Problem**: Users not getting new version with `@latest`
- **Solution**: GitHub may cache action references. Users can try clearing cache or using a specific tag. Verify the latest branch is actually updated.

**Problem**: Auto-release workflow didn't trigger
- **Solution**: Check that the PR title matches the pattern `[Automated] Adding cmake-vX.Y.Z`. If needed, use the manual workflow as a fallback.
