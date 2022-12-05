[![Action Status](https://github.com/lukka/get-cmake/workflows/build-test/badge.svg)](https://github.com/lukka/get-cmake/actions)

[![Coverage Status](https://coveralls.io/repos/github/lukka/get-cmake/badge.svg?branch=main)](https://coveralls.io/github/lukka/get-cmake?branch=main)

- [The **get-cmake** action installs as fast as possible your desired versions of CMake and Ninja](#the-get-cmake-action-installs-as-fast-as-possible-your-desired-versions-of-cmake-and-ninja)
  - [Quickstart](#quickstart)
    - [If you want to use  **latest stable** you can use this one-liner:](#if-you-want-to-use--latest-stable-you-can-use-this-one-liner)
    - [If you want to **pin** the workflow to **specific range of versions** of CMake and Ninja:](#if-you-want-to-pin-the-workflow-to-specific-range-of-versions-of-cmake-and-ninja)
  - [Action reference: all input/output parameters](#action-reference-all-inputoutput-parameters)
  - [Who is using `get-cmake`](#who-is-using-get-cmake)
- [Developers information](#developers-information)
  - [Prerequisites](#prerequisites)
  - [Build and lint](#build-and-lint)
  - [Generate the catalog of CMake releases](#generate-the-catalog-of-cmake-releases)
  - [Packaging](#packaging)
  - [Testing](#testing)
  - [Contributing](#contributing)
- [License](#license)

<br>

# [The **get-cmake** action installs as fast as possible your desired versions of CMake and Ninja](https://github.com/marketplace/actions/get-cmake)
The action restores from the GitHub cloud based cache, or downloads and caches, both CMake and Ninja. You can select your desired version using [semantic versioning ranges](https://docs.npmjs.com/about-semantic-versioning), and also use `install` or `installrc` special versions to install the [latest stable](./.latest_cmake_version) or [release candidate](./.latest_ninja_version).

Works for Linux/macOS/Windows.

Steps of `get-cmake`:
  1. If a cache hit occurs, CMake and Ninja are restored from cache in less than 1 second.
  2. If a cache miss occurs:
     1. the action downloads and installs the desired versions of CMake and Ninja.
     2. then it pushes both CMake and Ninja on the [cloud based GitHub cache](https://www.npmjs.com/package/@actions/cache). This is beneficial for the next run of the workflow.
  3. Adds to the PATH environment variable the paths to CMake and Ninja executables.
  
<br>

## Quickstart
### If you want to use  **latest stable** you can use this one-liner:
```yaml
  # Option 1: using 'latest' branch, the most recent CMake and ninja are installed.
    - uses: lukka/get-cmake@latest    # <--= Just this one-liner suffices.
```
or there is another option:
```yaml
  # Option 2: specify 'latest' or 'latestrc' in the input version arguments:
    - name: Get latest CMake and Ninja
      uses: lukka/get-cmake@latest
      with:
        cmakeVersion: latestrc     # <--= optional, use the latest release candidate (notice the 'rc' suffix).
        ninjaVersion: latest       # <--= optional, use the latest release (non candidate).
```

<br>

### If you want to **pin** the workflow to **specific range of versions** of CMake and Ninja:
```yaml
  # Option 1: specify in a input parameter the desired version using ranges.
  - uses: lukka/get-cmake@latest
    with:
      cmakeVersion: "~3.25.0"  # <--= optional, use most recent 3.25.x version
      ninjaVersion: "^1.11.1"  # <--= optional, use most recent 1.x version
    
  # or using a specific version (no range)
  - uses: lukka/get-cmake@latest
    with:
      cmakeVersion: 3.25.1     # <--= optional, stick to exactly 3.25.1 version
      ninjaVersion: 1.11.1     # <--= optional, stick to exactly 1.11.1 version
```
or there is another option:
```yaml
  # Option 2: or you can use the Git 'tag' to select the version, and you can have a one-liner statement,
  # but note that you can only use one of the existing tags, create a PR to add the tag you need!
  - name: Get specific version CMake, v3.25.1
    uses: lukka/get-cmake@v3.25.1     # <- this one-liner is all you need.
```
<br>

## Action reference: all input/output parameters
Please read [action.yml](./action.yml).

<br>

## Who is using `get-cmake`
[This graph](https://lukka.github.io/graph/graph.html) shows the list of public repositories with more than 25 stars using `get-cmake`.

<br>

# Developers information

## Prerequisites
[gulp 4](https://www.npmjs.com/package/gulp4) globally installed.

<br>

## Build and lint
Build with `tsc` running:

 > npm run build

Launch `lint` by:

 > npm run lint

<br>

## Generate the catalog of CMake releases
To generate the catalog of CMake releases, run a special test with this command:

 > npm run generate-catalog

Then embed the new catalog by packaging the action.

<br>

## Packaging
To build, lint validate and package the extension (and embed the release catalog) for release purpose, run:

  > npm run pack

<br>

## Testing
To build, pack and run all tests:
 
 > npm run test

 To run all tests:
 
 > npx jest

 or

 > npx jest -- -t "&lt;regex to match the describe clause&gt;"

<br>

## Contributing
The software is provided as is, there is no warranty of any kind. All users are encouraged to improve the [source code](https://github.com/lukka/get-cmake) with fixes and new features.

<br>

# License
All the content in this repository is licensed under the [MIT License](LICENSE.txt).

Copyright (c) 2020-2021-2022 Luca Cappa

