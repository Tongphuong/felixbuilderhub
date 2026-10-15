# json-stream-lite stringifier

Pinned MIT files from json-stream-lite1.3.1, https://github.com/jacobshirley/json-stream-lite.
Downloaded from the official npm registry without running package scripts. Only the
stringifier and its byte helpers are included; no parser or dependency installation.

Local patch: formatString uses native JSON.stringify escaping. Upstream emitted
lone surrogates without JSON escapes; the private known-bad control reproduces it.
The Read2Lead adapter carries split surrogate pairs before UTF-8 encoding, so byte
chunks and incremental hashes match native JSON.stringify exactly for snapshot data.
Only plain JSON snapshot values are used; no replacer, JSONC, custom toString,
Promises or streams inside input values.

Archive SHA256: cbf9c3321e9674992bd94a51950b1d6ed4c002cb27aa486cf9c135a2f3398f0a

Upstream stringify.js SHA256: c2c221dd6ec487a22b162b08d41153f3d4f09c3b0915f0c10b4ee32bde99ce33
Upstream utils.js SHA256: af2f10f9292a6660504e39a4dc331f475ee0368f0e58f2e22f238d9ce52bc4b7
