# Release Process for get-cmake

This document describes the release process for the get-cmake action after a new CMake or Ninja version has been merged to the `main` branch.

## Overview

The get-cmake action uses two key reference points for users:
1. **`latest` branch** - Points to the most recent stable release
2. **Version tags** (e.g., `v4.2.3`) - Allow users to pin to specific versions

When a new CMake version is detected and merged to `main` via automated PR, a release should be performed to make it available to users.

## Current State

Based on the latest analysis:
- **Main branch**: Contains CMake v4.2.3 (merged via PR #232)
- **Latest branch**: Currently at CMake v4.2.2 (needs to be updated)
- **Latest tag**: v4.2.2 (needs new tag v4.2.3)

## Release Steps

### Option 1: Using GitHub Actions Workflow (Recommended)

A workflow file `.github/workflows/sync-latest-and-tag.yml` has been created to automate this process.

1. Go to the Actions tab in GitHub
2. Select "Sync latest branch and create release tag" workflow
3. Click "Run workflow"
4. Enter the tag name (e.g., `v4.2.3`)
5. Click "Run workflow" button

The workflow will:
- Update the `latest` branch to match `main`
- Create and push the specified version tag

### Option 2: Manual Process (Advanced)

If you prefer to do this manually or the workflow is not available:

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
   git ls-remote --tags origin | grep v4.2.3
   ```

3. **Test the action**:
   Create a test workflow using:
   ```yaml
   - uses: lukka/get-cmake@latest
   - uses: lukka/get-cmake@v4.2.3
   ```

## What Users See

After the release:

- **Users using `@latest`**: Will automatically get CMake v4.2.3
- **Users using `@v4.2.3`**: Can pin to this specific version
- **Users using `@v4.2.2`**: Will continue to use v4.2.2

## Background: How New Versions Are Detected

The `build-test-tmpl.yml` workflow:
1. Runs `npm run generate-catalog` to query GitHub for new CMake/Ninja releases
2. Compares with `.latest_cmake_version` and `.latestrc_cmake_version`
3. If new versions found, creates an automated PR to main
4. After PR is merged, a manual release should be performed (this document)

## Release Checklist

For each release:

- [ ] Verify the PR with new CMake version was merged to `main`
- [ ] Check the version in `.latest_cmake_version` on main branch
- [ ] Run the sync workflow or manual commands
- [ ] Verify `latest` branch points to same commit as `main`
- [ ] Verify the version tag was created
- [ ] Test the action using `@latest` reference
- [ ] Update any release notes or announcements if needed

## Troubleshooting

**Problem**: Tag already exists
- **Solution**: Check if release was already done. If tag is incorrect, delete it first:
  ```bash
  git push origin :refs/tags/v4.2.3
  git tag -d v4.2.3
  ```

**Problem**: Latest branch won't update
- **Solution**: Ensure you have write permissions to the repository

**Problem**: Users not getting new version with `@latest`
- **Solution**: GitHub may cache action references. Users can try clearing cache or using a specific tag.
