// 저장 계층. UI 코드는 이 파일의 함수만 호출한다.
//
// 왜 이렇게 나눴나:
//  - 스티커 이미지(Blob)는 localStorage 에 넣을 수 없어서 IndexedDB 를 그대로 유지한다.
//  - 발견 횟수 / 최초 발견일은 발견 기록(sightings)에서 매번 계산한다.
//    저장소를 둘로 나눠 동기화 버그를 만드는 것보다 안전하고, 예전 기록도 자동으로 도감에 반영된다.
//  - 기록에서 계산할 수 없는 값(오늘의 발견 상태)만 localStorage 에 둔다.

import { speciesForName, speciesById } from './animals.js';

const DB_NAME = 'animal-sticker-db';
const STORE = 'sightings';
const DAILY_KEY = 'asd:daily';

let dbPromise;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function getAllSightings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function addSighting({ speciesId, name, blob }) {
  const db = await openDb();
  const record = { speciesId, name, blob, ts: Date.now() };
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').clear();
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
  localStorage.removeItem(DAILY_KEY);
}

// 발견 기록 목록 -> 도감 Map(speciesId -> 도감 항목)
// speciesId 가 없는 옛 기록은 이름으로 종을 찾아 채워 넣는다(마이그레이션 불필요).
export function buildDex(sightings) {
  const dex = new Map();
  for (const s of sightings.slice().sort((a, b) => a.ts - b.ts)) {
    const species = (s.speciesId && speciesById(s.speciesId)) || speciesForName(s.name);
    const entry = dex.get(species.id);
    if (entry) {
      entry.count += 1;
      entry.lastAt = s.ts;
      entry.blob = s.blob;
    } else {
      dex.set(species.id, { species, count: 1, firstAt: s.ts, lastAt: s.ts, blob: s.blob });
    }
  }
  return dex;
}

// ---- 오늘의 발견 ----

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function getDaily() {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
    if (saved && saved.date === todayKey()) return saved;
  } catch (e) {
    console.warn('오늘의 발견 데이터를 읽지 못했습니다.', e);
  }
  return { date: todayKey(), done: false };
}

export function markDailyDone() {
  const daily = { date: todayKey(), done: true };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
  } catch (e) {
    console.warn('오늘의 발견 데이터를 저장하지 못했습니다.', e);
  }
  return daily;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
