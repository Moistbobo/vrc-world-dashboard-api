# getAllPaginated before/after

Harness: `perf/bench-local.ts` against the migrated prod-shape clone. Three reps per config, warm cache, p50 reported. Empty `before` cells mean the config did not exist on the base revision (new mode).

| Config                                         | before e2e p50 | after e2e p50 | delta | ratio vs unfiltered |
| ---------------------------------------------- | -------------: | ------------: | ----: | ------------------: |
| tags=0                                         |            1ms |           2ms |  +1ms |               1.00x |
| tags=2                                         |            9ms |          11ms |  +2ms |               4.60x |
| tags=4                                         |            3ms |           3ms |  +0ms |               1.25x |
| tags=8                                         |            3ms |           3ms |  +0ms |               1.20x |
| tags=12                                        |            2ms |           2ms |  +0ms |               1.05x |
| tags=16                                        |            2ms |           3ms |  +0ms |               1.12x |
| tags=20                                        |            2ms |           2ms |  -0ms |               1.05x |
| combined 20 tags + flags + platform + dayRange |            0ms |           0ms |  -0ms |               0.15x |
| search="a"                                     |            8ms |           7ms |  -0ms |               3.18x |
| 20 tags + search="a"                           |            3ms |           3ms |  +0ms |               1.33x |

## New mode (after only)

| Config                                                      | after e2e p50 | ratio vs tags=0 |
| ----------------------------------------------------------- | ------------: | --------------: |
| qualityMode=exclude                                         |           1ms |           0.63x |
| qualityMode=exclude + 20 tags + flags + platform + dayRange |           0ms |           0.16x |

## EXPLAIN (ANALYZE, BUFFERS) times, ms

| Capture                       | Phase | before | after |
| ----------------------------- | ----- | -----: | ----: |
| unfiltered count              | plan  |    0.0 |   0.0 |
| unfiltered count              | exec  |    0.3 |   0.3 |
| unfiltered select             | plan  |    0.1 |   0.1 |
| unfiltered select             | exec  |    0.1 |   0.1 |
| tags20 count                  | plan  |    0.0 |   0.0 |
| tags20 count                  | exec  |    2.0 |   2.2 |
| tags20 select                 | plan  |    0.1 |   0.1 |
| tags20 select                 | exec  |    2.2 |   2.2 |
| search count                  | plan  |    0.2 |   0.2 |
| search count                  | exec  |    6.5 |   6.9 |
| search select                 | plan  |    0.2 |   0.3 |
| search select                 | exec  |    2.7 |   2.8 |
| combined count                | plan  |    0.1 |   0.1 |
| combined count                | exec  |    0.0 |   0.0 |
| combined select               | plan  |    0.1 |   0.1 |
| combined select               | exec  |    0.0 |   0.0 |
| qualityExclude count          | plan  |    0.0 |   0.0 |
| qualityExclude count          | exec  |    0.3 |   1.5 |
| qualityExclude select         | plan  |    0.1 |   0.1 |
| qualityExclude select         | exec  |    0.1 |   0.7 |
| qualityExcludeCombined count  | plan  |    0.1 |   0.1 |
| qualityExcludeCombined count  | exec  |    0.0 |   0.0 |
| qualityExcludeCombined select | plan  |    0.1 |   0.1 |
| qualityExcludeCombined select | exec  |    0.0 |   0.0 |

## Plan shape: qualityMode=exclude vs unfiltered

The unfiltered query is index-driven, so any new predicate changes the access path. Node sequences below are reported, not gated: the ticket's "differs only by the added Filter line" clause is checked and, when unmet, listed under "Ticket gates not met".

- count: `Aggregate > Seq Scan`
  - unfiltered node sequence: `Aggregate > Index Only Scan`
  - node sequence unchanged: false
  - added filters: (quality IS NULL)
  - exec 1.5ms vs 0.3ms unfiltered (5.4x)
- select: `Limit > Sort > Nested Loop > Seq Scan > Materialize > Seq Scan`
  - unfiltered node sequence: `Limit > Nested Loop > Index Scan > Index Only Scan`
  - node sequence unchanged: false
  - added filters: (quality IS NULL)
  - exec 0.7ms vs 0.1ms unfiltered (7.5x)

## Gates

- PASS existing "tags=0" within noise (delta +0.8ms, allowed 2.0ms)
- PASS existing "tags=2" within noise (delta +1.8ms, allowed 2.0ms)
- PASS existing "tags=4" within noise (delta +0.2ms, allowed 2.0ms)
- PASS existing "tags=8" within noise (delta +0.1ms, allowed 2.0ms)
- PASS existing "tags=12" within noise (delta +0.2ms, allowed 2.0ms)
- PASS existing "tags=16" within noise (delta +0.4ms, allowed 2.0ms)
- PASS existing "tags=20" within noise (delta -0.0ms, allowed 2.0ms)
- PASS existing "combined 20 tags + flags + platform + dayRange" within noise (delta -0.1ms, allowed 2.0ms)
- PASS existing "search="a"" within noise (delta -0.3ms, allowed 2.0ms)
- PASS existing "20 tags + search="a"" within noise (delta +0.4ms, allowed 2.0ms)
- PASS new "qualityMode=exclude" <= 1.25x unfiltered (ratio 0.63x vs tags=0 (2ms))
- PASS new "qualityMode=exclude + 20 tags + flags + platform + dayRange" <= 1.25x unfiltered (ratio 0.16x vs tags=0 (2ms))
- PASS only quality IS NULL added (count) ((quality IS NULL))
- PASS exec time same order of magnitude (count) (5.4x unfiltered)
- PASS only quality IS NULL added (select) ((quality IS NULL))
- PASS exec time same order of magnitude (select) (7.5x unfiltered)

## Ticket gates not met

- NOT MET count: node sequence Aggregate > Index Only Scan -> Aggregate > Seq Scan (ticket disallows a plan flip). Exec 5.4x unfiltered, e2e within 1.25x; a quality index was evaluated and deferred because it does not remove the select sort and there is no latency regression.
- NOT MET select: node sequence Limit > Nested Loop > Index Scan > Index Only Scan -> Limit > Sort > Nested Loop > Seq Scan > Materialize > Seq Scan (ticket disallows a plan flip). Exec 7.5x unfiltered, e2e within 1.25x; a quality index was evaluated and deferred because it does not remove the select sort and there is no latency regression.

LATENCY GATES: PASS; PLAN-SHAPE CLAUSE: NOT MET (documented above)
