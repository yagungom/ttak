// 우리 기기 기록 + 랭킹 데이터 형식 통일 (온라인 응답과 같은 모양)
//  기록 1개 = 한 판의 사람 선수 1명: { team, player, mode(adult/kid), input, innings, total, best, hits, homers }
import { store, periodStart, niceStep, uid } from './util.js';

const KEY = 'ttak.records.v1';
const MAX = 1500;

export function loadLocal() {
  const arr = store.get(KEY, []);
  return Array.isArray(arr) ? arr.filter((r) => r && typeof r.total === 'number' && typeof r.best === 'number') : [];
}

export function addLocal(rec) {
  const arr = loadLocal();
  const row = { id: uid(), ts: Date.now(), ...rec };
  arr.push(row);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
  store.set(KEY, arr);
  return row;
}

export function clearLocal() { store.remove(KEY); }

// kind: 'best' = 비거리(한 방) / 'total' = 총 비거리
export function buildBoard(rows, kind, myScore = null) {
  const sc = (r) => (kind === 'best' ? r.best : r.total);
  const sorted = [...rows].sort((a, b) => sc(b) - sc(a) || a.ts - b.ts);
  const max = sorted.length ? sc(sorted[0]) : 0;
  let step = kind === 'best' ? 10 : niceStep(Math.max(max, 1) / 16); if (step < 10) step = 10;
  const binMap = new Map();
  for (const r of rows) { const b = Math.floor(sc(r) / step); binMap.set(b, (binMap.get(b) || 0) + 1); }
  const bins = [...binMap.entries()].sort((a, b) => a[0] - b[0]).map(([b, c]) => ({ b, c }));
  // 순위 = 나보다 높은 기록 수 + 1 (같은 점수는 공동 순위 — 온라인 랭킹·'내 순위'와 같은 기준)
  const top = sorted.slice(0, 10).map((r) => ({ rank: sorted.findIndex((x) => sc(x) === sc(r)) + 1, team: r.team, player: r.player, score: sc(r), total: r.total, best: r.best, hits: r.hits, homers: r.homers, innings: r.innings, at: r.ts }));
  const myRank = myScore == null ? null : sorted.filter((r) => sc(r) > myScore).length + 1;
  return { total: rows.length, step, max, top, bins, my_rank: myRank };
}

export function localBoard({ kind, mode, period, myScore = null, input = 'camera', innings = 2 }) {
  const from = periodStart(period);
  const rows = loadLocal().filter((r) => r.mode === mode && r.input === input && r.ts >= from && (kind === 'best' || r.innings === innings));
  return buildBoard(rows, kind, myScore);
}

// 온라인 응답 정규화 (시간 문자열 → ms)
export function normalizeOnline(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    total: Number(data.total) || 0,
    step: Math.max(1, Number(data.step) || 10),
    max: Number(data.max) || 0,
    top: Array.isArray(data.top) ? data.top.map((t) => ({ ...t, at: Date.parse(t.at) || Date.now() })) : [],
    bins: Array.isArray(data.bins) ? data.bins.map((x) => ({ b: Number(x.b), c: Number(x.c) })) : [],
    my_rank: data.my_rank == null ? null : Number(data.my_rank),
  };
}
