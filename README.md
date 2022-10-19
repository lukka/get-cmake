[![Action Status](https://github.com/lukka/get-cmake/workflows/build-test/badge.svg)](https://github.com/lukka/get-cmake/actions)

[![Coverage Status](https://coveralls.io/repos/github/lukka/get-cmake/badge.svg?branch=main)](https://coveralls.io/github/lukka/get-cmake?branch=main)

- [The **get-cmake** action for downloading and caching CMake and ninja binaries on the GitHub agents.](#the-get-cmake-action-for-downloading-and-caching-cmake-and-ninja-binaries-on-the-github-agents)
  - [<a id='quickstart'>Quickstart</a>](#quickstart)
  - [<a id='reference'>Action reference: all input/output parameters</a>](#action-reference-all-inputoutput-parameters)
  - [Who is using `get-cmake`](#who-is-using-get-cmake)
- [Developers information](#developers-information)
  - [Prerequisites](#prerequisites)
  - [Build and lint](#build-and-lint)
  - [Packaging](#packaging)
  - [Testing](#testing)
  - [<a id='contributing'>Contributing</a>](#contributing)
- [License](#license)

<br>

# [The **get-cmake** action for downloading and caching CMake and ninja binaries](https://github.com/marketplace/actions/get-cmake) on the GitHub agents.

Restores from cache, or downloads and caches CMake **v3.24.2** and Ninja **v1.11.1**.
Works for x64 on Linux/macOS/Windows.

Flowchart of `get-cmake`:
  1. If cache hit occurs, CMake and ninja are restored from cache in less than 1 second;
  1. If cache miss occurs, the action downloads and installs CMake and ninja, then **caches both automatically** with GitHub's [@actions/cache](https://www.npmjs.com/package/@actions/cache) APIs;
  1. Adds to PATH the CMake and ninja executables;

## <a id='quickstart'>Quickstart</a>

```yaml
    # - uses: actions/cache@v1  <-----= YOU DO NOT NEED THIS
    #   key: <key>              <-----= YOU DO NOT NEED THIS
    #   path: <path>            <-----= YOU DO NOT NEED THIS

    - name: Get latest CMake and ninja
      # Using 'latest' branch, the most recent CMake and ninja are installed.
      uses: lukka/get-cmake@latest        ⟸ THIS IS THE ONE LINER YOU NEED
          
    # If you need to pin your workflow to specific CMake version you can use the 'tag' to select the version.
    - name: Get specific version CMake, v3.24.2
      uses: lukka/get-cmake@v3.24.2   ⟸ THIS IS THE ONE LINER YOU NEED
```
<br>

## <a id='reference'>Action reference: all input/output parameters</a>

There are no inputs, nor outputs.

[action.yml](https://github.com/lukka/get-cmake/blob/main/action.yml)

<br>

## Who is using `get-cmake`

[This graph](https://lukka.github.io/graph/graph.html) shows the list of public repositories with more than 25 stars using `get-cmake`.

<br>

# Developers information

## Prerequisites
[gulp 4](https://www.npmjs.com/package/gulp4) globally installed.

## Build and lint
Build with `tsc` running:

 > npm run build

Launch `lint` by:

 > npm run lint

## Packaging
To build, lint validate and package the extension for release purpose, run:

  > npm run pack

## Testing

To build, pack and test:
 
 > npm run test

 To run test directly:
 
 > jest

## <a id='contributing'>Contributing</a>

The software is provided as is, there is no warranty of any kind. All users are encouraged to improve the [source code](https://github.com/lukka/get-cmake) with fixes and new features.

# License
All the content in this repository is licensed under the [MIT License](LICENSE.txt).

Copyright (c) 2020-2021-2022 Luca Cappa

