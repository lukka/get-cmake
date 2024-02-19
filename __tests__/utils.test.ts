// Copyright (c) 2024 Luca Cappa

// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import { hashCode } from '../src/utils';
import * as catalog from '../src/releases-catalog'

test('testing hashcode returns unique values...', async () => {
    var m: Map<number, string> = new Map<number, string>();
    for (const i of getAllUniqueUrls(catalog.ninjaCatalog)) {
        const n = hashCode(i);
        expect(m.has(n)).toBeFalsy();
        m.set(n, i);
    }
    for (const i in getAllUniqueUrls(catalog.cmakeCatalog)) {
        const n = hashCode(i);
        expect(m.has(n)).toBeFalsy();
        m.set(n, i);
    }
});

function getAllUniqueUrls(catalog: any): string[] {
    let urls: string[] = [];
    for (let version in catalog) {
        // 'latest' and 'latestrc' have URLs identical to the existing versions.
        if (version === 'latest' || version === 'latestrc')
            continue;
        for (let platform in catalog[version]) {
            urls.push(catalog[version][platform].url);
        }
    }
    return urls;
}
