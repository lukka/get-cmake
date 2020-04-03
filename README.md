[![Action Status](https://github.com/lukka/get-cmake/workflows/build-test/badge.svg)](https://github.com/lukka/get-cmake/actions)

# [The **get-cmake** action for using CMake on GitHub](https://github.com/marketplace/actions/run-cmake)

Download CMake for various platform and OSes, and cache it with GitHub's [tool-cache](https://github.com/actions/toolkit/tree/master/packages/tool-cache).

 ## User Manual
 * [Quickstart](#quickstart)

 ## Developer Manual
 * [Developers information](#developers-information)
   * [Prerequisites](#prerequisites)
   * [Packaging](#packaging)
   * [Testing](#testing)
  * [Contributing](#contributing)
  * [License](#license)

## <a id='quickstart'>Quickstart</a>

```yaml
    - name: Get latest CMake
      uses: lukka/get-cmake@v0
```

### <a id='reference'>Action reference: all input/output parameters</a>

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
All the content in this repository is licensed under the [MIT License](LICENSE.txt).

Copyright (c) 2020 Luca Cappa
