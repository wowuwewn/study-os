import assert from "node:assert/strict";
import {
  AUXILIARY_VISIBILITY_KEY,
  CALENDAR_VISIBILITY_KEY,
  PIP_VISIBILITY_KEY,
  PIP_MODE_KEY,
  parseAuxiliaryVisibility,
  readAuxiliaryVisibility,
  readPipMode,
  writeAuxiliaryVisibility,
  writePipMode,
} from "../src/windowVisibility.ts";

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

assert.deepEqual(parseAuxiliaryVisibility(null), { pip: false, calendar: false });
assert.deepEqual(parseAuxiliaryVisibility("not-json"), { pip: false, calendar: false });
assert.deepEqual(parseAuxiliaryVisibility('{"pip":true}'), { pip: true, calendar: false });
assert.deepEqual(parseAuxiliaryVisibility('{"pip":1,"calendar":"true"}'), { pip: false, calendar: false });

const storage = new MemoryStorage();
assert.deepEqual(readAuxiliaryVisibility(storage), { pip: false, calendar: false });
assert.deepEqual(writeAuxiliaryVisibility("pip", true, storage), { pip: true, calendar: false });
assert.deepEqual(writeAuxiliaryVisibility("calendar", true, storage), { pip: true, calendar: true });
assert.equal(storage.getItem(PIP_VISIBILITY_KEY), "true");
assert.equal(storage.getItem(CALENDAR_VISIBILITY_KEY), "true");

const interleaved = new MemoryStorage();
interleaved.setItem(AUXILIARY_VISIBILITY_KEY, '{"pip":true,"calendar":true}');
writeAuxiliaryVisibility("pip", false, interleaved);
writeAuxiliaryVisibility("calendar", false, interleaved);
assert.deepEqual(readAuxiliaryVisibility(interleaved), { pip: false, calendar: false });

assert.equal(readPipMode(storage), "compact");
storage.setItem(PIP_MODE_KEY, "invalid");
assert.equal(readPipMode(storage), "compact");
writePipMode("expanded", storage);
assert.equal(readPipMode(storage), "expanded");
writePipMode("pet", storage);
assert.equal(readPipMode(storage), "pet");

console.log("Window visibility preference validation passed.");
