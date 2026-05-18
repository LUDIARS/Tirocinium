# reservation モジュール

サーバーモードの面接枠管理。詳細フローは [`../../DESIGN.md` §5](../../DESIGN.md) と
[`../schema/README.md`](../schema/README.md) を参照。本書は実装視点。

---

## schema (再掲ポイント)

- `reservation_slots(slot_start, capacity, used)` — 30 分粒度
- `reservations(id, user_id, slot_start, status, ...)` — 同時 1 件まで
- 詳細は親 schema

---

## 主要 API

### `POST /api/v1/sessions` の挙動

```ts
async function startSession(req) {
  const user = await cernereVerify(req);
  const gate = await coordinator.tryStart(user.id);

  if (gate.kind === 'start') {
    return { session_id: gate.session_id, ws_url: ... };
  }
  if (gate.kind === 'offer') {
    return { reservation_offer: { slot_start: gate.slot_start, eta_min: ... } };
  }
  if (gate.kind === 'denied') {
    return 503, { reason: gate.reason };
  }
}
```

### `tryStart` 実装

```ts
async tryStart(userId) {
  // 1. saturation check
  if (await this.serverLoad() > 0.95) return { kind: 'denied', reason: 'saturated' };

  // 2. current slot に空きあり?
  const now = currentSlotStart();
  const slot = await db.lockSlot(now);
  if (slot.used < slot.capacity) {
    await db.incSlot(now);
    const sid = await startSessionNow(userId, /* reservation_id */ null);
    return { kind: 'start', session_id: sid };
  }

  // 3. 未来 slot を探す
  const next = await db.findFirstFreeSlot(now);
  return { kind: 'offer', slot_start: next };
}
```

---

## tick (cron / setInterval)

毎分実行:

1. `slot_start <= now` で `status='held'` の予約を走査
2. ユーザに WS push + Nuntius push (Nt) を送る (notify_sent=true へ)
3. 5 分経過しても WS connect が来ない → `status='no_show'` + `used -= 1`

15 分前 push:

- `slot_start - now between 14m and 16m` の `held` で `notify_sent=false` のもの
- Nuntius (Nt) に enqueue + notify_sent=true

---

## 並行制御

- slot の `used` increment は **行ロック** (`SELECT ... FOR UPDATE`) で守る
- もしくは Redis lock (`tirocinium:slot:<iso>`) を使う
- 同一ユーザの二重予約は `UNIQUE (user_id) WHERE status IN ('held','started')` で DB 制約に押し付ける

---

## キャパシティ調整

- `capacity` は **LLM プールのジョブ枠** とイコール。運用パラメータ。
- 動的に下げたら既存 held 予約は維持、新規受付のみ閉まる。
- `apps/server/src/admin/` に capacity 調整 API を別途用意する (admin only)。
