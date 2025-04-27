# iCKB/Core

iCKB Core utils built on top of CCC

## Dependencies

```mermaid
graph TD;
    A[ickb/utils] --> B[ckb-ccc/core];
    C[ickb/dao] --> A[ickb/utils];
    C --> B[ckb-ccc/core];
    D[ickb/core] --> A[ickb/utils];
    D --> C[ickb/dao];
```

## Epoch Semantic Versioning

This repository follows [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver). In short ESV aims to provide a more nuanced and effective way to communicate software changes, allowing for better user understanding and smoother upgrades.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/core) and it is released under the [MIT License](./LICENSE).
