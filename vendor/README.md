# Dependency security remediation

2026-10-12 기준 Prisma의 `@prisma/config>deepmerge-ts`를 8.0.2로, `prisma>mysql2`를 3.24.5로 고정한다. 각각 [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)의 수정 버전이다. Prisma 설정, Client 생성, 빌드 및 DB migration 호환성을 검증한다.

## braces replacement

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)에 해당하는 braces 3.0.3에는 공식 수정 릴리스가 없다. 최신 안정 버전 정책의 보안 예외로, 공개 MIT 수정판 `@dieub/braces-depth-guard@3.0.3-pn.3`를 exact version으로 사용한다. 공식 upstream 릴리스로 취급하거나 임의의 upstream 버전을 만들지 않는다. `latest`는 이전 bootstrap 릴리스를 가리키므로 사용하지 않는다.

- 원본: [registry tarball](https://registry.npmjs.org/@dieub/braces-depth-guard/-/braces-depth-guard-3.0.3-pn.3.tgz)
- 소스: [305a2e4bfe324bb53c336c1b03387ee1251c926f](https://github.com/dieub/braces-depth-guard/tree/305a2e4bfe324bb53c336c1b03387ee1251c926f)
- 검증: 배포 파일 10개를 소스 커밋과 바이트 단위로 대조하고 registry SHA-512를 확인했다.
- 보관: `braces-depth-guard-3.0.3-pn.3.tgz`는 원본 그대로이며 원본 MIT LICENSE도 포함한다. 설치는 local file tarball을 사용하므로 원격 삭제에 영향받지 않는다.
- SHA-512: `sha512-QY+Uq4s42STyIMPoRkBuUZfYyvz0uZuwuUburLwMx5N+lWqnHHaBxcKPtgKVKjTyFnS1q4ivKu9Wxi4VG7FE9Q==`

`braces-compat`은 private 프로젝트 어댑터다. 실행문은 수정판을 re-export하는 한 줄이며 exact peer dependency로 동일 모듈을 공유한다. pnpm overrides가 모든 전이 `braces` 의존성을 이 어댑터로 연결한다. 원본 수정판의 이름·버전·라이선스·tarball 무결성은 lockfile과 설치 manifest에 유지된다. install lifecycle script는 추가하지 않는다.

수정판은 입력 중괄호/괄호 및 recursive AST 깊이를 최대 100으로 제한하고 더 낮은 maxDepth를 존중한다. parent cycle도 거부한다. 추가로 `patches/braces-depth-guard.patch`는 비순환 parent chain에도 같은 깊이 제한을 적용한다. pnpm의 patchedDependencies가 설치 시 패치를 적용하고 lockfile에 patch hash를 기록한다. 일반 glob, range, quote, escape 동작은 회귀 테스트로 확인한다. 이 수정은 AST 폭이나 모든 확장 조합 수의 일반 제한을 제공하지 않는다.

## Verification and maintenance

`pnpm test:dependencies`는 보관 파일의 digest, 실제 설치 identity, 모든 소비자의 모듈 연결, 깊이/순환 방어와 일반 패턴을 검사한다. CI에서는 registry audit가 실패해도 이 검증을 실행한다. `pnpm run audit`는 production/dev/optional 전체와 low 이상의 advisory를 계속 검사하며 ignore나 실패 우회를 사용하지 않는다.

별도 이름의 수정판은 원본 braces에 대한 새로운 advisory와 자동으로 연결되지 않는다. audit 0건만으로 원본 코드의 모든 위험이 사라졌다고 판단하지 않는다. 의존성 갱신과 릴리스 전에는 [upstream advisories](https://github.com/advisories?query=ecosystem%3Anpm+affects%3Abraces), [upstream issue #70](https://github.com/micromatch/braces/issues/70)과 공식 registry 수정 릴리스를 확인한다. 관련 결함이 발견되면 수정판에도 적용 여부를 검토한다. 공식 안전 버전이 나오면 어댑터·tarball·패치를 함께 제거하고 회귀 테스트 및 전체 audit를 통과시킨 뒤 전환한다. 보관 파일이 손상되면 같은 Git 커밋의 파일을 복원하며 임의의 새 bytes로 교체하지 않는다.
