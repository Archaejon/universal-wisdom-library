// The built web client embedded in the desktop executable, as
// { "/url/path": embedded-file-path }.
//
// This file is the stand-in used when running from source: it is empty, so
// the server serves ./public as usual. scripts/build-app.ts replaces this
// module at compile time with one that embeds every file in public/.
export const files: Record<string, string> = {};
