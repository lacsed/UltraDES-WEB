# WASM performance improvements

Measured on 2026-10-30 with .NET SDK 8.0.427/runtime 8.0.33, UltraDES 2.2.5.1, Chromium 156.0.8078.4, Linux x64, and a CPU quota equivalent to two cores. Values are medians of three repetitions after the first round. Baseline and improved WASM publications use Release without AOT. Builds and browser UI tests were completed outside the measurement runs.

## Changes

`AutomatonJsonWriter` preserves the native UltraDES JSON schema, including IDs, initial state, markings, controllability and transition endpoints. It builds state/event dictionaries once, then streams compact JSON with `Utf8JsonWriter`. The native writer uses `Array.IndexOf` for every transition endpoint and builds a JSON object tree. Indexing removes the repeated linear searches. Output formatting/escaping differs; parsed JSON is equivalent.

Workspace models now have `WorkspaceAutomatonSnapshot` entries. They cache JSON and lazily cache state/event/transition counts. Saving a layout or adding another model reuses existing model JSON; the outer workspace envelope is still encoded and written as one revision. Removing a model also removes its snapshot. Workspace operations create new automata; future code that mutates or replaces an existing model must also replace its snapshot.

The export dialog uses the same fast writer for JSON. Background persistence errors are surfaced in the workspace instead of becoming unobserved task failures. Storage format/version and legacy loading remain unchanged.

## Results

| WASM JSON export | Before | After | Speedup |
|---|---:|---:|---:|
| 256 states / 2,048 transitions | 101.14 ms | 24.75 ms | 4.1× |
| 4,096 states / 49,152 transitions | 18,461.11 ms | 409.81 ms | 45.0× |
| FMS: 45,504 states / 200,124 transitions | Not measured | 3,539.12 ms | — |

The 4,096-state output shrank from 4,976,027 to 2,632,007 characters (47.1% reduction). Native export of this result fell from 2,240.76 ms to 38.49 ms. FMS native export now takes 273.05 ms. Its baseline serialization was omitted by the earlier harness above 10,000 states; no before/after speedup is claimed for FMS JSON.

The computation algorithms have not changed: for example, FMS synthesis remained approximately 4 seconds in WASM. The serialization measurements above do not use AOT. The deployment now additionally opts into AOT as described below; threads remain disabled. These results measure isolated C# operation/serialization stages, not full UI latency, SVG layout, download time or browser storage writes. LocalStorage quotas still apply to large workspaces; a failed save leaves an error visible and does not imply that the result was persisted.

Machine-readable stage medians and sizes are in `performance-results.json`. The benchmark harness and raw measurements are retained in `/workspace/ultrades-benchmark`; the prior baseline harness is archived separately as `benchmark-ultrades.tar.gz`.

## Validation

- 57 .NET tests passed, including JSON semantic equivalence with the native writer, native importer round trips, compound states, Unicode/escaped labels, initial state with no transitions, non-mutation and snapshot reuse.
- 6 Chromium browser tests passed: desktop/mobile exports, large-model export guard, two SVG pan/zoom cases, and save/reload of compact model JSON and cached summaries.

## Monolithic synthesis deployment

The GitHub Pages publish command now uses `-p:EnableWasmAot=true`. This project option enables `RunAOTCompilation` only when requested, so normal development builds and tests do not require the AOT workload. The deploy workflow installs `wasm-tools` before publication.

To reproduce locally:

```bash
dotnet workload install wasm-tools --skip-manifest-update
dotnet publish UltraDESWeb.csproj -c Release -p:EnableWasmAot=true -o release
```

AOT compiles the UltraDES synthesis code and supporting runtime code to WASM instead of relying on interpretation for these paths. It changes execution speed, not supervisor semantics or the default nonblocking option. Multicore remains disabled: the library creates up to 10 × `Environment.ProcessorCount` workers with shared locks, so switching it on is not automatically beneficial, and WASM threads still require a supported host/runtime configuration.

AOT increases publication time and the initial download. The complete AOT site is compiled and tested locally before reporting this change; it is not deployed by the local validation. Stage profiling and fresh synthesis-only measurements are recorded separately in `synthesis-performance-results.json`.

### Fresh synthesis-only measurements

With the same 8-plant/8-specification FMS, nonblocking enabled and Multicore disabled, fresh sequential measurements gave **4,214.92 ms without AOT → 2,042.25 ms with AOT** (2.06× speedup; 51.5% less calculation time). These are medians of three repetitions after the first round and exclude JSON, registration, counting, storage and drawing. Both controls produced 45,504 states and 200,124 transitions.

Profiling the unmodified interpreted search by replaying its stages in a diagnostic harness gave these stage medians:

| Stage | WASM without AOT | Native .NET |
|---|---:|---:|
| Compose plants/specifications | 8.57 ms | 0.59 ms |
| Prepare reverse transitions/search | 2.11 ms | 0.33 ms |
| Explore supervisor candidate states | 1,527.62 ms | 181.86 ms |
| Discard invalid candidates | 24.27 ms | 2.29 ms |
| Reachability pass | 849.29 ms | 86.87 ms |
| Nonblocking pass | 1,405.55 ms | 110.06 ms |

Exploration visited 97,620 candidate states. One reachability/nonblocking iteration remained after initial exploration. In every profiling round, the complete JSON output matched the original synthesis output within that runtime. Reflection into library internals is used only in this external diagnostic harness; no such calls are added to the application. Stage medians are not an independent end-to-end measurement and need not sum exactly to the control median.

The full application was published locally with AOT. **7 Chromium tests passed against that published static site**, including monolithic synthesis of the Small Factory (6 states, 8 transitions, one marked state), reload persistence, desktop/mobile export, large-export guards and SVG pan/zoom. This validates the actual publish configuration, beyond the isolated benchmark. A separate development-mode synthesis test also passed.

This does not reproduce an unidentified user model that takes minutes. That model is needed before attributing its slowdown to a particular search phase or choosing a deeper algorithm/library change.
