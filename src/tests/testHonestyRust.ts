// The Rust half of testHonesty.guard.test.ts: finds `#[test]` functions whose
// bodies assert nothing. Kept apart so the guard stays under the file ceiling.

/** Rust source with comments, strings and character literals blanked in one
 *  left-to-right pass, so braces and words inside them do not count and a
 *  quote inside a comment cannot swallow code. Line breaks are kept. */
function rustCode(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i, i + 2);
    const raw = /^r(#*)"/.exec(text.slice(i, i + 40));
    if (rest === "//") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (rest === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (raw && !/\w/.test(text[i - 1] ?? "")) {
      const close = `"${raw[1]}`;
      const end = text.indexOf(close, i + raw[0].length);
      out += '""';
      i = end < 0 ? text.length : end + close.length;
    } else if (text[i] === '"') {
      let k = i + 1;
      while (k < text.length && text[k] !== '"') k += text[k] === "\\" ? 2 : 1;
      out += '""';
      i = k + 1;
    } else if (/^'(?:\\.|[^'\\])'/.test(text.slice(i, i + 4))) {
      const len = text[i + 1] === "\\" ? 4 : 3;
      out += "' '";
      i += len;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** True for a Rust file that holds only test code. */
const isRustTestFile = (rel: string): boolean => /(^|\/)tests?\.rs$|_tests\.rs$/.test(rel) || rel.includes("/tests/");

/** The spans of `#[cfg(test)]` modules in blanked Rust code. */
function cfgTestSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of code.matchAll(/#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g)) {
    const start = m.index + m[0].length;
    spans.push([start, closeBrace(code, start)]);
  }
  return spans;
}

/** The index just past the `}` that closes a block whose body starts at `start`. */
function closeBrace(code: string, start: number): number {
  let depth = 1;
  let i = start;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  return i;
}

/** Where a function's body starts, scanning its signature past brackets (an
 *  array type's `;` included), or -1 for a declaration with no body. */
function bodyStart(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === ";") return -1;
    else if (depth === 0 && c === "{") return i + 1;
  }
  return -1;
}

/** The index where an expression starting at `from` ends: its block's close,
 *  or the first `;` or unmatched closer at depth 0. */
function exprEnd(body: string, from: number): number {
  let i = from;
  while (/\s/.test(body[i] ?? "")) i++;
  if (body[i] === "{") return closeBrace(body, i + 1);
  for (let depth = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (c === ";" && depth === 0) return i;
  }
  return i;
}

/** A function body with the code it never runs blanked: nested `fn` items
 *  (a call reaches them as helpers) and closures bound by `let` that the body
 *  never names again. A closure passed straight to a call is kept, since the
 *  callee is taken to run it. */
function runsOf(body: string): string {
  let out = body;
  for (const m of [...out.matchAll(/\bfn\s+\w+/g)].reverse()) {
    const start = bodyStart(out, m.index + m[0].length);
    if (start >= 0) out = out.slice(0, m.index) + " ".repeat(closeBrace(out, start) - m.index) + out.slice(closeBrace(out, start));
  }
  for (const m of [...out.matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]*)?=\s*(?:move\s+)?\|[^|]*\|/g)].reverse()) {
    const end = exprEnd(out, m.index + m[0].length);
    const rest = out.slice(0, m.index) + out.slice(end);
    if (!new RegExp(`\\b${m[1]}\\b`).test(rest)) out = out.slice(0, m.index) + " ".repeat(end - m.index) + out.slice(end);
  }
  return out;
}

/** The spans of `impl` and `trait` blocks in blanked Rust code: a `fn` inside
 *  one is a method, called through a value or a type, never a bare helper. */
function implSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of code.matchAll(/(?:^|[;{}\]])\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:impl|trait)\b[^{;]*\{/g)) {
    const start = m.index + m[0].length;
    spans.push([start, closeBrace(code, start)]);
  }
  return spans;
}

/** A Rust file's module name: its stem, or its folder for a `mod.rs`. */
const rustModule = (file: string): string => {
  const parts = file.replace(/\.rs$/, "").split("/");
  const last = parts.pop()!;
  return last === "mod" ? parts.pop()! : last;
};

/** Every Rust `#[test]` whose body asserts nothing, as `file > name`. A body
 *  asserts when it uses an assert or panic macro, carries `#[should_panic]`, or
 *  calls a test helper that asserts. A helper is a free function in test code
 *  (a tests file or a `#[cfg(test)]` module), so a production function that
 *  happens to `debug_assert!` does not make its callers tests. A call resolves
 *  to a helper by where it can come from: the caller's own file, a shared
 *  support file (test code that holds no `#[test]`), or the module a `use` line
 *  or a call path names (`check_tests::refused` finds `sim_undo_check_tests.rs`).
 *  A method call (`x.new()`) or a type path (`Tower::new()`) never resolves to
 *  one, so a name that collides with a method or another file's helper does not
 *  count. */
export function rustAssertionFreeTests(files: ReadonlyMap<string, string>): string[] {
  type Fn = { file: string; name: string; attrs: string; body: string; free: boolean; helper: boolean };
  type Call = { module: string; name: string };
  const fns: Fn[] = [];
  const support = new Set<string>();
  /** Per file: each name a `use` line brings in, mapped to its module, and the modules it glob-imports. */
  const imports = new Map<string, { names: Map<string, string>; globs: string[] }>();
  /** Per file: the `#[path]` modules it declares, and the file that declares each child. */
  const declared = new Map<string, Map<string, string>>();
  const parentOf = new Map<string, string>();
  for (const [file, text] of files) {
    const code = rustCode(text);
    const tests = cfgTestSpans(code);
    const impls = implSpans(code);
    const inside = (spans: Array<[number, number]>, at: number) => spans.some(([a, b]) => at >= a && at < b);
    const names = new Map<string, string>();
    const globs: string[] = [];
    for (const m of code.matchAll(/\buse\s+((?:\w+::)*\w+)::(\{[^}]*\}|\*|\w+)\s*;/g)) {
      const module = m[1].split("::").pop()!;
      const list = m[2].startsWith("{") ? m[2].slice(1, -1).split(",") : [m[2]];
      for (const item of list.map((x) => x.trim()).filter(Boolean)) {
        if (item === "*") globs.push(module);
        else names.set(item.split(/\s+as\s+/).pop()!, module);
      }
    }
    imports.set(file, { names, globs });
    for (const m of text.matchAll(/#\[path\s*=\s*"([^"]+)"\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g)) {
      const child = `${file.slice(0, file.lastIndexOf("/") + 1)}${m[1]}`;
      declared.set(file, (declared.get(file) ?? new Map<string, string>()).set(m[2], child));
      parentOf.set(child, file);
    }
    let hasTest = false;
    for (const m of code.matchAll(/((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/g)) {
      const start = bodyStart(code, m.index + m[0].length);
      if (start < 0) continue;
      const testCode = isRustTestFile(file) || inside(tests, m.index);
      hasTest ||= /#\[test\]/.test(m[1]);
      const free = !inside(impls, m.index);
      fns.push({ file, name: m[2], attrs: m[1], body: runsOf(code.slice(start, closeBrace(code, start) - 1)), free, helper: testCode && free });
    }
    if (isRustTestFile(file) && !hasTest) support.add(file);
  }
  const MACROS = /\b(?:assert\w*|debug_assert\w*|prop_assert\w*|panic|unreachable|unimplemented|todo)!/;
  /** The files whose asserting helper of each name is known. */
  const asserting = new Map<string, Set<string>>();
  const mark = (f: Fn) => asserting.set(f.name, (asserting.get(f.name) ?? new Set()).add(f.file));
  const marked = (f: Fn) => asserting.get(f.name)?.has(f.file) ?? false;
  for (const f of fns) if (f.helper && MACROS.test(f.body)) mark(f);
  /** True when `module`, named from `caller`, is the file `home`: by its own
   *  name, or by a `#[path]` declaration in the caller or its parent. */
  const fromModule = (caller: string, home: string, module: string) => {
    if (rustModule(home) === module) return true;
    const parent = parentOf.get(caller);
    return (declared.get(caller)?.get(module) ?? (parent === undefined ? undefined : declared.get(parent)?.get(module))) === home;
  };
  /** The crate target a file builds into: its `src/`, or its `tests/` folder. */
  const target = (file: string) => /^(.*?\/(?:src|tests|benches|examples)\/)/.exec(file)?.[1] ?? file;
  /** The free functions each file defines, so a local one shadows any other. */
  const defines = new Map<string, Set<string>>();
  for (const f of fns) if (f.free) defines.set(f.file, (defines.get(f.file) ?? new Set()).add(f.name));
  /** True when `call`, made from `file`, can reach the helper `name` defined in `home`. */
  const reaches = (file: string, call: Call, home: string): boolean => {
    if (["", "self", "super", "crate"].includes(call.module)) {
      if (call.module !== "crate" && defines.get(file)?.has(call.name)) return home === file;
      if (home === file || (support.has(home) && target(home) === target(file))) return true;
      if (call.module !== "") return false;
      const { names, globs } = imports.get(file)!;
      const via = names.get(call.name);
      return (via !== undefined && fromModule(file, home, via)) || globs.some((g) => fromModule(file, home, g));
    }
    return fromModule(file, home, call.module);
  };
  // The free-function calls each body makes (not `.m(`, not `Type::m(`), read once.
  const called = new Map(
    fns.map((f) => {
      const list: Call[] = [];
      for (const m of f.body.matchAll(/(\.\s*)?((?:\w+::)*)(\w+)\s*(?:::<[^>]*>)?\(/g)) {
        const path = m[2].split("::");
        const module = path.length > 1 ? path[path.length - 2] : "";
        if (m[1] || /^(?:[A-Z]\w*|Self)$/.test(module)) continue;
        list.push({ module, name: m[3] });
      }
      return [f, list] as const;
    }),
  );
  const calls = (f: Fn): boolean => called.get(f)!.some((c) => [...(asserting.get(c.name) ?? [])].some((home) => reaches(f.file, c, home)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of fns) {
      if (f.helper && !marked(f) && calls(f)) {
        mark(f);
        grew = true;
      }
    }
  }
  return fns
    .filter((f) => /#\[test\]/.test(f.attrs) && !/#\[should_panic/.test(f.attrs) && !MACROS.test(f.body) && !calls(f))
    .map((f) => `${f.file} > ${f.name}`);
}
