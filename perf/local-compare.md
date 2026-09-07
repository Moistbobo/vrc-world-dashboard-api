# getAllPaginated before/after (local pg 16.14, 6960 worlds, 14034 junction rows)

Harness: `perf/bench-local.ts` against the migrated prod-shape clone. Three reps per config, warm cache, p50 reported. COUNT and page SELECT timed separately in the before harness (sequential); after harness they run concurrently via Promise.all.

| Config                                         | before e2e p50 | after e2e p50 |  delta |
| ---------------------------------------------- | -------------: | ------------: | -----: |
| tags=0                                         |            2ms |           1ms |   -0ms |
| tags=2                                         |            9ms |           7ms |   -2ms |
| tags=4                                         |            8ms |           2ms |   -5ms |
| tags=8                                         |           31ms |           2ms |  -29ms |
| tags=12                                        |           48ms |           2ms |  -46ms |
| tags=16                                        |           77ms |           2ms |  -75ms |
| tags=20                                        |          119ms |           2ms | -117ms |
| combined 20 tags + flags + platform + dayRange |           96ms |           2ms |  -94ms |
| search="a"                                     |           11ms |           7ms |   -3ms |
| 20 tags + search="a"                           |          112ms |           2ms | -109ms |

## EXPLAIN (ANALYZE, BUFFERS) times, ms

| Capture         | Phase | before | after |
| --------------- | ----- | -----: | ----: |
| tags20 count    | plan  |   36.1 |   0.1 |
| tags20 count    | exec  |    0.5 |   2.3 |
| tags20 select   | plan  |   87.6 |   0.2 |
| tags20 select   | exec  |    0.4 |   2.2 |
| search count    | plan  |    0.2 |   0.2 |
| search count    | exec  |    6.3 |   6.9 |
| search select   | plan  |    0.3 |   0.2 |
| search select   | exec  |    2.6 |   2.6 |
| combined count  | plan  |   31.7 |   0.1 |
| combined count  | exec  |    0.1 |   2.2 |
| combined select | plan  |   64.5 |   0.1 |
| combined select | exec  |    0.1 |   2.3 |
