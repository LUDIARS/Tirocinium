#!/usr/bin/env python3
"""npm 依存の棚卸し (移行前の数を数える)。

package-lock.json (lockfileVersion 3) を読み、指定した workspace の直接依存ごとに
推移的依存 (本番依存のみ、devDependencies は含めない) の閉包を Node の解決規則
(入れ子の node_modules を内側から探す) で数える。ネットワークには触れない。

使い方: python3 native/tools/npm_dep_inventory.py [package-lock.json] [workspace ...]
"""
import json
import sys
from pathlib import PurePosixPath


def resolve(packages, from_path, name):
    """from_path (lock の key) から見た name の解決先 key を返す。"""
    base = PurePosixPath(from_path) if from_path else PurePosixPath('')
    while True:
        cand = str(base / 'node_modules' / name) if str(base) not in ('', '.') else f'node_modules/{name}'
        if cand in packages:
            entry = packages[cand]
            if entry.get('link'):
                return entry.get('resolved')
            return cand
        if str(base) in ('', '.'):
            return None
        # node_modules/x/node_modules/y → 1 段外へ
        parts = base.parts
        if 'node_modules' in parts:
            idx = len(parts) - 1 - list(reversed(parts)).index('node_modules')
            base = PurePosixPath(*parts[:idx]) if idx > 0 else PurePosixPath('')
        else:
            base = PurePosixPath('')


def closure(packages, start_key):
    seen = set()
    stack = [start_key]
    while stack:
        key = stack.pop()
        if key is None or key in seen:
            continue
        seen.add(key)
        entry = packages.get(key, {})
        deps = dict(entry.get('dependencies', {}))
        deps.update(entry.get('optionalDependencies', {}))
        for dep in deps:
            stack.append(resolve(packages, key, dep))
    return seen


def main():
    lock_path = sys.argv[1] if len(sys.argv) > 1 else 'package-lock.json'
    workspaces = sys.argv[2:] or ['apps/server', 'packages/llm', 'packages/secrets', 'packages/training',
                                  'packages/voice', 'packages/companies', 'packages/analytics', 'packages/avatar']
    packages = json.load(open(lock_path, encoding='utf-8'))['packages']
    union = set()
    rows = []
    for ws in workspaces:
        entry = packages.get(ws, {})
        for dep in sorted(entry.get('dependencies', {})):
            key = resolve(packages, ws, dep)
            if key is None:
                rows.append((ws, dep, '(未解決: lock に無い)', 0))
                continue
            members = closure(packages, key)
            # workspace 内部パッケージ (packages/*) は外部依存として数えない
            external = {m for m in members if m.startswith('node_modules/') or '/node_modules/' in m or m.startswith('lib/')}
            union |= external
            version = packages.get(key, {}).get('version', '?')
            rows.append((ws, dep, version, len(external)))
    print('| workspace | 直接依存 | 版 | 推移的閉包 (自身を含む) |')
    print('|---|---|---|---|')
    for ws, dep, version, n in rows:
        print(f'| {ws} | {dep} | {version} | {n} |')
    print(f'\n本番依存の外部パッケージ総数 (重複除去): {len(union)}')
    for m in sorted(union):
        print('  ', m, packages.get(m, {}).get('version', ''))


if __name__ == '__main__':
    main()
