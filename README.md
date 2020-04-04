[![Action Status](https://github.com/lukka/get-cmake/workflows/build-test/badge.svg)](https://github.com/lukka/get-cmake/actions)

# [The **get-cmake** action for downloading and caching CMake on GitHub runners](https://github.com/marketplace/actions/run-cmake)

Download and **cache** CMake, it supports various Linux/macOS/Windows.

Briefly:
  1. Download CMake;
  2. **cache** it automatically for you with GitHub's [actions/cache](https://github.com/actions/cache);
  3. CMake is added to the PATH environment variable;

## <a id='quickstart'>Quickstart</a>

```yaml
    # - uses: actions/cache@v1  <-----= YOU DO NOT NEED THIS
    #   key: <key>              <-----= YOU DO NOT NEED THIS
    #   path: <path>            <-----= YOU DO NOT NEED THIS
    - name: Get latest CMake
      uses: lukka/get-cmake@v1   ⟸ THIS IS THE ONE LINER YOU NEED
```

 ## Developer Manual
 * [Developers information](#developers-information)
   * [Prerequisites](#prerequisites)
   * [Packaging](#packaging)
   * [Testing](#testing)
  * [Contributing](#contributing)
  * [License](#license)

### <a id='reference'>Action reference: all input/output parameters</a>

There are no inputs, nor outputs.

[action.yml](https://github.com/lukka/get-cmake/blob/master/action.yml)

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
All the content, except for the `actions/cache directory and its content` in this repository is licensed under the [MIT License](LICENSE.txt).

Copyright (c) 2020 Luca Cappa

<hr>

All content under [actions/cache](./actions/cache) directory is subject to this [LICENSE](./actions/cache/LICENSE)

Copyright (c) 2018 GitHub, Inc. and contributors
