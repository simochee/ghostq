# Changelog

## [1.1.0](https://github.com/simochee/ghostq/compare/ghostq-v1.0.0...ghostq-v1.1.0) (2026-07-18)


### Features

* add adopt command to move existing files into the overlay ([#7](https://github.com/simochee/ghostq/issues/7)) ([cee815b](https://github.com/simochee/ghostq/commit/cee815bf67cc0b10f5a88f13b79e180d77eb01f7))
* add prune command to remove dangling overlay links ([#6](https://github.com/simochee/ghostq/issues/6)) ([a3f961e](https://github.com/simochee/ghostq/commit/a3f961ee3a875e0a5d34826b678c0e5c69973202))
* **install:** install the hook via init.templateDir so hook managers coexist ([b23f474](https://github.com/simochee/ghostq/commit/b23f4748372dcf467a28b694be63e545886dbfe5))


### Bug Fixes

* **install:** migrate off a legacy core.hooksPath install ([9955d78](https://github.com/simochee/ghostq/commit/9955d7821373148c5b7499ffba4374dbed12f9ce))

## 1.0.0 (2026-07-17)


### Features

* add the ghostq CLI entry point ([3216f60](https://github.com/simochee/ghostq/commit/3216f6025fa97851a304ffa8e325e487262fd908))
* apply the overlay entry with symlink-each ([7c68cb4](https://github.com/simochee/ghostq/commit/7c68cb4282de58feb848ee6551e808508f5a3627))
* install a global post-checkout hook that chains and self-gates ([5156883](https://github.com/simochee/ghostq/commit/51568830092aa37089a867682d95e16780e18a50))
* normalize remote URLs to a host/user/repo identity ([2070042](https://github.com/simochee/ghostq/commit/207004241176404d5e2939d430890e28f563da08))
