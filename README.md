# iCKB/Core

iCKB Core utils built on top of CCC

## Dependencies

```mermaid
graph TD;
    A["@ickb/utils"] --> B["@ckb-ccc/core"];
    C["@ickb/dao"] --> A;
    C --> B;
    D["@ickb/core"] --> A;
    D --> C;

    click A "https://github.com/ickb/utils" "Go to @ickb/utils"
    click B "https://github.com/ckb-devrel/ccc/tree/master/packages/core" "Go to @ckb-ccc/core"
    click C "https://github.com/ickb/dao" "Go to @ickb/dao"
    click D "https://github.com/ickb/core" "Go to @ickb/core"
```

## Epoch Semantic Versioning

This repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). In short ESV aims to provide a more nuanced and effective way to communicate software changes, allowing for better user understanding and smoother upgrades.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/core) and it is released under the [MIT License](./LICENSE).