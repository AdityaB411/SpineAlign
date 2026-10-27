/* Shared, dependency-free SpineAlign telemetry parser for browser and Node tests. */
(function(root) {
  'use strict';
  const KNOWN_FIELDS = new Set(['N','B','NP','NR','BP','BR','ALERT','CAL','NS','BS','BAT','PCT','CHG','FULL']);
  const ANGLE_FIELDS = ['N','B','NP','NR','BP','BR'];
  const BOOL_FIELDS = ['ALERT','CAL','NS','BS'];
  const TRI_STATE_FIELDS = ['CHG','FULL'];
  const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function parseLine(input) {
    if (typeof input !== 'string') return null;
    const line = input.trim();
    if (!line || line.length > 256 || !line.includes(',')) return null;
    const fields = {};
    for (const token of line.split(',')) {
      const part = token.trim();
      const sep = part.indexOf(':');
      if (sep < 1) return null;
      const key = part.slice(0, sep).trim().toUpperCase();
      const raw = part.slice(sep + 1).trim();
      if (!KNOWN_FIELDS.has(key) || Object.prototype.hasOwnProperty.call(fields, key) || !NUMBER.test(raw)) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      fields[key] = value;
    }
    if (!Number.isFinite(fields.N) || !Number.isFinite(fields.B)) return null;
    for (const key of ANGLE_FIELDS) {
      if (fields[key] !== undefined && Math.abs(fields[key]) > 360) return null;
    }
    for (const key of BOOL_FIELDS) {
      if (fields[key] !== undefined && fields[key] !== 0 && fields[key] !== 1) return null;
    }
    for (const key of TRI_STATE_FIELDS) {
      if (fields[key] !== undefined && fields[key] !== -1 && fields[key] !== 0 && fields[key] !== 1) return null;
    }
    if (fields.BAT !== undefined && fields.BAT !== -1 && (fields.BAT < 0 || fields.BAT > 5)) return null;
    if (fields.PCT !== undefined && fields.PCT !== -1 && (fields.PCT < 0 || fields.PCT > 100)) return null;
    // Keep the absence of optional telemetry distinct from zero.
    return fields;
  }

  const api = Object.freeze({ parseLine, knownFields: Object.freeze(Array.from(KNOWN_FIELDS)) });
  if (root) root.SpineAlignTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
