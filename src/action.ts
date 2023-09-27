
// Copyright (c) 2020-2021-2022-2023 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as getter from './get-cmake'

// Main entry point of the task.
getter.main().catch(error => console.error("main() failed!", error));