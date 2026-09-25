// ── Loop Coding Practice: live pseudocode interpreter + auto-checker ──
// Ported from Pseudocode_practice/interpreter.js (Cambridge 9618 pseudocode interpreter),
// reused here so student code is actually run and checked, not just multiple-choice.
// ← and <- are the same assignment arrow — accept either spelling everywhere (typed, pasted,
// or hand-written), same as the full Pseudocode_IDE where typing "<-" auto-converts to "←".
function normalizeArrows(src){
  let out='',inStr=false,strCh='';
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(inStr){ out+=ch; if(ch===strCh) inStr=false; continue; }
    if(ch==='"'||ch==="'"){ inStr=true; strCh=ch; out+=ch; continue; }
    if(ch==='<' && src[i+1]==='-'){ out+='←'; i++; continue; }
    out+=ch;
  }
  return out;
}
class PseudoInterpreter {
  constructor(shared = {}, opts = {}) {
    this.env = {}; this.types = {};
    for (const [k, v] of Object.entries(shared)) { this.env[k.toUpperCase()] = v.value; this.types[k.toUpperCase()] = v.type; }
    this.procedures = {}; this.functions = {}; this.output = []; this.inputValues = []; this.files = {};
    this.recordTypes = {}; this.classes = {}; this.arrayElemType = {}; this._activeClass = null; this._activeObj = null;
    this.silent = !!opts.silent;
  }
  run(src) {
    src = normalizeArrows(src);
    const lines = this.tokenize(src.split('\n').map(l => l.trimEnd()));
    try { this.execBlock(lines, 0, lines.length); }
    catch (e) {
      if (e.type === 'return') { }
      else if (e.type === 'pseudo_error') this.output.push('ERROR: ' + e.msg);
      else this.output.push('ERROR: ' + e.message);
    }
    return { output: this.output.join('\n'), env: this.env, types: this.types };
  }
  tokenize(lines) { return lines.map((raw, i) => ({ raw, src: raw.replace(/\/\/.*$/, '').trim(), ln: i + 1 })).filter(l => l.src.length > 0); }
  execBlock(lines, from, to) { let i = from; while (i < to) i = this.execLine(lines, i, to); }
  execLine(lines, i, to) {
    const s = lines[i].src;
    if (/^DECLARE\s+/i.test(s)) {
      const m = s.match(/^DECLARE\s+(\w+)\s*(?::\s*(\w+(?:\[.*?\])?)(?:\s+OF\s+(\w+))?)?/i);
      if (m) {
        const name = m[1].toUpperCase(), type = (m[2] || '').toUpperCase(), elemType = (m[3] || '').toUpperCase();
        this.types[name] = type || 'UNKNOWN';
        if (type.startsWith('ARRAY') && elemType) this.arrayElemType[name] = elemType;
        if (!(name in this.env)) {
          if (type === 'INTEGER' || type === 'REAL') this.env[name] = 0;
          else if (type === 'STRING') this.env[name] = '';
          else if (type === 'BOOLEAN') this.env[name] = false;
          else if (type.startsWith('ARRAY')) this.env[name] = {};
          else this.env[name] = null;
        }
      }
      return i + 1;
    }
    if (/^CONSTANT\s+/i.test(s)) { const m = s.match(/^CONSTANT\s+(\w+)\s*[=←]\s*(.+)/i); if (m) this.env[m[1].toUpperCase()] = this.eval(m[2].trim()); return i + 1; }
    if (/^OUTPUT\s+/i.test(s)) {
      const rest = s.replace(/^OUTPUT\s+/i, '').trim();
      const parts = this.splitTop(rest, ',');
      this.output.push(parts.map(p => String(this.eval(p.trim()))).join(''));
      return i + 1;
    }
    if (/^INPUT\s+/i.test(s)) {
      const rawName = s.replace(/^INPUT\s+/i, '').trim();
      const raw = this.inputValues.length > 0 ? this.inputValues.shift() : '';
      const adm = rawName.match(/^(\w+)\[(.+)\]\.(\w+)$/);
      const dm = !adm ? rawName.match(/^(\w+)\.(\w+)$/) : null;
      let type = '', storeKey;
      if (adm) {
        const arrNameRaw = adm[1], fieldRaw = adm[3];
        const elemType = this.arrayElemType[arrNameRaw.toUpperCase()];
        const fields = this.recordTypes[elemType];
        if (fields) type = fields[fieldRaw.toUpperCase()] || '';
        storeKey = (arrNameRaw + '[' + this.idxKey(adm[2]) + '].' + fieldRaw).toUpperCase();
      } else if (dm) {
        const baseRaw = dm[1], fieldRaw = dm[2];
        const baseType = this.types[baseRaw.toUpperCase()];
        const fields = this.recordTypes[baseType];
        if (fields) type = fields[fieldRaw.toUpperCase()] || '';
        storeKey = rawName.toUpperCase();
      } else {
        const name = rawName.toUpperCase();
        type = this.types[name] || '';
        storeKey = name;
      }
      let val = raw;
      if ((type === 'INTEGER' || type === 'REAL') && raw !== '' && !isNaN(Number(raw))) val = type === 'INTEGER' ? parseInt(raw) : parseFloat(raw);
      else if (type === 'BOOLEAN') val = String(raw).toLowerCase() === 'true';
      this.env[storeKey] = val;
      if (!this.silent) this.output.push('INPUT ' + rawName + ' → ' + val);
      return i + 1;
    }
    if (/^TYPE\s+/i.test(s)) return this.collectType(lines, i, to);
    if (/^CLASS\s+/i.test(s)) return this.collectClass(lines, i, to);
    if (/^CALL\s+SUPER\./i.test(s)) {
      const m = s.match(/^CALL\s+SUPER\.(\w+)\s*\(([^)]*)\)/i);
      if (m) {
        const methodName = m[1].toUpperCase(), argStr = m[2];
        const argStrs = argStr.trim() ? this.splitTop(argStr, ',').map(a => a.trim()) : [];
        const parentClass = this.classes[this._activeClass] ? this.classes[this._activeClass].parent : null;
        if (parentClass) this.invokeMethod(this._activeObj, methodName, argStrs, { fromClass: parentClass });
      }
      return i + 1;
    }
    if (/^CALL\s+(\w+)\.(\w+)\s*\(/i.test(s)) {
      const m = s.match(/^CALL\s+(\w+)\.(\w+)\s*\(([^)]*)\)/i);
      const objName = m[1].toUpperCase(), methodName = m[2].toUpperCase(), argStr = m[3];
      const argStrs = argStr.trim() ? this.splitTop(argStr, ',').map(a => a.trim()) : [];
      this.invokeMethod(objName, methodName, argStrs, { fromClass: this.types[objName] });
      return i + 1;
    }
    if (/^CALL\s+/i.test(s)) { this.callProc(s.replace(/^CALL\s+/i, '').trim()); return i + 1; }
    if (/^RETURN\s+/i.test(s)) throw { type: 'return', value: this.eval(s.replace(/^RETURN\s+/i, '').trim()) };
    if (/^IF\s+/i.test(s)) return this.execIf(lines, i, to);
    if (/^FOR\s+/i.test(s)) return this.execFor(lines, i, to);
    if (/^WHILE\s+/i.test(s)) return this.execWhile(lines, i, to);
    if (/^REPEAT$/i.test(s)) return this.execRepeat(lines, i, to);
    if (/^CASE\s+OF\s+/i.test(s)) return this.execCase(lines, i, to);
    if (/^PROCEDURE\s+/i.test(s)) return this.collectProc(lines, i, to);
    if (/^FUNCTION\s+/i.test(s)) return this.collectFunc(lines, i, to);
    if (/^(ENDIF|ENDWHILE|ENDCASE|NEXT|UNTIL|ELSE|THEN|ENDPROCEDURE|ENDFUNCTION|OTHERWISE|RETURNS|ENDTYPE|ENDCLASS|PRIVATE|PUBLIC)(\s|$)/i.test(s)) return i + 1;
    const am = s.match(/^([A-Za-z_]\w*(?:\[.+?\])?(?:\.\w+)?)\s*←\s*(.+)$/);
    if (am) { this.assign(am[1].trim(), am[2].trim()); return i + 1; }
    if (/^[A-Za-z_]\w*\s*\(/.test(s)) { this.callProc(s); return i + 1; }
    return i + 1;
  }
  assign(lhs, rhs) {
    const newM = rhs.match(/^NEW\s+(\w+)\s*\(([^)]*)\)$/i);
    if (newM) {
      const className = newM[1].toUpperCase();
      if (this.classes[className]) {
        const argStr = newM[2];
        const argStrs = argStr.trim() ? this.splitTop(argStr, ',').map(a => a.trim()) : [];
        const lhsKey = lhs.toUpperCase();
        this.types[lhsKey] = className;
        this.env[lhsKey] = { __class: className };
        const ctor = this.findMethod(className, 'NEW', 'procedures');
        if (ctor) this.invokeMethod(lhsKey, 'NEW', argStrs, { fromClass: className });
        return;
      }
    }
    const adm = lhs.match(/^(\w+)\[(.+)\]\.(\w+)$/);
    if (adm) { const key = (adm[1] + '[' + this.idxKey(adm[2]) + '].' + adm[3]).toUpperCase(); this.env[key] = this.eval(rhs); return; }
    const dm = lhs.match(/^(\w+)\.(\w+)$/);
    if (dm) { this.env[lhs.toUpperCase()] = this.eval(rhs); return; }
    const m = lhs.match(/^(\w+)\[(.+)\]$/);
    if (m) { const name = m[1].toUpperCase(), idx = this.idxKey(m[2]); if (typeof this.env[name] !== 'object' || this.env[name] === null) this.env[name] = {}; this.env[name][idx] = this.eval(rhs); }
    else this.env[lhs.toUpperCase()] = this.eval(rhs);
  }
  idxKey(s) { return this.splitTop(s, ',').map(p => this.eval(p.trim())).join(','); }
  execIf(lines, i, to) {
    const condStr = lines[i].src.replace(/^IF\s+/i, '').replace(/\s+THEN\s*$/i, '').trim();
    let depth = 0, thenIdx = -1, elseIdx = -1, endIdx = -1;
    for (let j = i; j < to; j++) {
      const u = lines[j].src.toUpperCase();
      if (/^IF\s+/.test(u)) depth++;
      if (depth === 1 && /\bTHEN\b/.test(u) && thenIdx < 0) thenIdx = j;
      if (depth === 1 && /^ELSE$/.test(u) && elseIdx < 0) elseIdx = j;
      if (/^ENDIF/.test(u)) { depth--; if (depth === 0) { endIdx = j; break; } }
    }
    if (endIdx < 0) this.err('Missing ENDIF');
    const tS = thenIdx >= 0 ? thenIdx + 1 : i + 1, tE = elseIdx >= 0 ? elseIdx : endIdx;
    const eS = elseIdx >= 0 ? elseIdx + 1 : endIdx, eE = endIdx;
    if (this.eval(condStr)) this.execBlock(lines, tS, tE); else this.execBlock(lines, eS, eE);
    return endIdx + 1;
  }
  execFor(lines, i, to) {
    const m = lines[i].src.match(/^FOR\s+(\w+)\s*←\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
    if (!m) this.err('Invalid FOR');
    const vn = m[1].toUpperCase(), stop = Number(this.eval(m[3])), step = m[4] ? Number(this.eval(m[4])) : 1;
    let depth = 0, nextIdx = -1;
    for (let j = i; j < to; j++) {
      if (/^FOR\s+/i.test(lines[j].src)) depth++;
      if (/^NEXT\s+/i.test(lines[j].src)) { depth--; if (depth === 0) { nextIdx = j; break; } }
    }
    if (nextIdx < 0) this.err('Missing NEXT');
    this.env[vn] = Number(this.eval(m[2])); let iter = 0;
    while ((step > 0 ? this.env[vn] <= stop : this.env[vn] >= stop) && iter++ < 10000) {
      this.execBlock(lines, i + 1, nextIdx);
      this.env[vn] = Number(this.env[vn]) + step;
    }
    if (iter >= 10000) this.output.push('⚠ FOR loop stopped after 10000 iterations (possible infinite loop — check STEP/TO values)');
    return nextIdx + 1;
  }
  execWhile(lines, i, to) {
    const condStr = lines[i].src.replace(/^WHILE\s+/i, '').replace(/\s+DO\s*$/i, '').trim();
    let depth = 0, endIdx = -1;
    for (let j = i; j < to; j++) {
      if (/^WHILE\s+/i.test(lines[j].src)) depth++;
      if (/^ENDWHILE/i.test(lines[j].src)) { depth--; if (depth === 0) { endIdx = j; break; } }
    }
    if (endIdx < 0) this.err('Missing ENDWHILE');
    let iter = 0;
    while (this.eval(condStr) && iter++ < 10000) this.execBlock(lines, i + 1, endIdx);
    if (iter >= 10000) this.output.push('⚠ WHILE loop stopped after 10000 iterations (possible infinite loop — check the condition)');
    return endIdx + 1;
  }
  execRepeat(lines, i, to) {
    let untilIdx = -1;
    for (let j = i + 1; j < to; j++) { if (/^UNTIL\s+/i.test(lines[j].src)) { untilIdx = j; break; } }
    if (untilIdx < 0) this.err('Missing UNTIL');
    const condStr = lines[untilIdx].src.replace(/^UNTIL\s+/i, '').trim();
    let iter = 0;
    do { this.execBlock(lines, i + 1, untilIdx); iter++; } while (!this.eval(condStr) && iter < 10000);
    if (iter >= 10000) this.output.push('⚠ REPEAT loop stopped after 10000 iterations (possible infinite loop — check the UNTIL condition)');
    return untilIdx + 1;
  }
  execCase(lines, i, to) {
    const val = this.eval(lines[i].src.replace(/^CASE\s+OF\s+/i, '').trim());
    let endIdx = -1;
    for (let j = i + 1; j < to; j++) { if (/^ENDCASE/i.test(lines[j].src)) { endIdx = j; break; } }
    if (endIdx < 0) this.err('Missing ENDCASE');
    const branches = [];
    for (let j = i + 1; j < endIdx; j++) {
      const s = lines[j].src;
      const otherwiseM = s.match(/^OTHERWISE\s*:\s*(.*)$/i);
      if (otherwiseM) { branches.push({ otherwise: true, startLine: j, firstStmt: otherwiseM[1] }); continue; }
      const labelM = s.match(/^(.+?)\s*:\s*(.*)$/);
      if (labelM && this.looksLikeCaseLabel(labelM[1])) branches.push({ label: labelM[1].trim(), startLine: j, firstStmt: labelM[2] });
    }
    for (let b = 0; b < branches.length; b++) {
      const bodyEnd = b + 1 < branches.length ? branches[b + 1].startLine : endIdx;
      branches[b].bodyLines = { from: branches[b].startLine + 1, to: bodyEnd, firstStmt: branches[b].firstStmt };
    }
    let matched = false;
    for (const br of branches) {
      if (matched) break;
      if (br.otherwise) {
        if (br.firstStmt.trim()) this.execLine([{ src: br.firstStmt }], 0, 1);
        this.execBlock(lines, br.bodyLines.from, br.bodyLines.to);
        matched = true; continue;
      }
      const rangeM = br.label.match(/^(.+?)\s+TO\s+(.+)$/i);
      let isMatch;
      if (rangeM) { const lo = this.eval(rangeM[1].trim()), hi = this.eval(rangeM[2].trim()); isMatch = val >= lo && val <= hi; }
      else isMatch = this.eval(br.label) == val;
      if (isMatch) {
        if (br.firstStmt.trim()) this.execLine([{ src: br.firstStmt }], 0, 1);
        this.execBlock(lines, br.bodyLines.from, br.bodyLines.to);
        matched = true;
      }
    }
    return endIdx + 1;
  }
  looksLikeCaseLabel(s) { const t = s.trim(); if (!t) return false; if (/^(IF|FOR|WHILE|REPEAT|CALL|OUTPUT|INPUT|DECLARE)\b/i.test(t)) return false; return true; }
  collectProc(lines, i, to) {
    const m = lines[i].src.match(/^PROCEDURE\s+(\w+)\s*(?:\(([^)]*)\))?/i);
    if (!m) this.err('Invalid PROCEDURE');
    const name = m[1].toUpperCase(), params = this.parseParams(m[2]);
    let depth = 0, endIdx = -1;
    for (let j = i; j < to; j++) { if (/^PROCEDURE\s+/i.test(lines[j].src)) depth++; if (/^ENDPROCEDURE/i.test(lines[j].src)) { depth--; if (depth === 0) { endIdx = j; break; } } }
    if (endIdx < 0) this.err('Missing ENDPROCEDURE');
    this.procedures[name] = { params, body: lines.slice(i + 1, endIdx) };
    if (!this.silent) this.output.push('[PROCEDURE ' + name + ' defined]');
    return endIdx + 1;
  }
  collectFunc(lines, i, to) {
    const m = lines[i].src.match(/^FUNCTION\s+(\w+)\s*(?:\(([^)]*)\))?/i);
    if (!m) this.err('Invalid FUNCTION');
    const name = m[1].toUpperCase(), params = this.parseParams(m[2]).map(p => ({ ...p, mode: 'BYVAL' }));
    let depth = 0, endIdx = -1;
    for (let j = i; j < to; j++) { if (/^FUNCTION\s+/i.test(lines[j].src)) depth++; if (/^ENDFUNCTION/i.test(lines[j].src)) { depth--; if (depth === 0) { endIdx = j; break; } } }
    if (endIdx < 0) this.err('Missing ENDFUNCTION');
    this.functions[name] = { params, body: lines.slice(i + 1, endIdx) };
    if (!this.silent) this.output.push('[FUNCTION ' + name + ' defined]');
    return endIdx + 1;
  }
  collectType(lines, i, to) {
    const m = lines[i].src.match(/^TYPE\s+(\w+)/i);
    if (!m) this.err('Invalid TYPE');
    const name = m[1].toUpperCase();
    let endIdx = -1;
    for (let j = i + 1; j < to; j++) { if (/^ENDTYPE/i.test(lines[j].src)) { endIdx = j; break; } }
    if (endIdx < 0) this.err('Missing ENDTYPE');
    const fields = {};
    for (let j = i + 1; j < endIdx; j++) {
      const fm = lines[j].src.match(/^DECLARE\s+(\w+)\s*:\s*(\w+)/i);
      if (fm) fields[fm[1].toUpperCase()] = fm[2].toUpperCase();
    }
    this.recordTypes[name] = fields;
    return endIdx + 1;
  }
  collectClass(lines, i, to) {
    const m = lines[i].src.match(/^CLASS\s+(\w+)(?:\s+INHERITS\s+(\w+))?/i);
    if (!m) this.err('Invalid CLASS');
    const name = m[1].toUpperCase(), parent = m[2] ? m[2].toUpperCase() : null;
    let depth = 0, endIdx = -1;
    for (let j = i; j < to; j++) {
      if (/^CLASS\s+/i.test(lines[j].src)) depth++;
      if (/^ENDCLASS/i.test(lines[j].src)) { depth--; if (depth === 0) { endIdx = j; break; } }
    }
    if (endIdx < 0) this.err('Missing ENDCLASS');
    const attrs = [], procedures = {}, functions = {};
    let j = i + 1;
    while (j < endIdx) {
      const s = lines[j].src;
      const procM = s.match(/^(?:PRIVATE|PUBLIC)\s+PROCEDURE\s+(\w+)\s*(?:\(([^)]*)\))?/i);
      const funcM = s.match(/^(?:PRIVATE|PUBLIC)\s+FUNCTION\s+(\w+)\s*(?:\(([^)]*)\))?/i);
      const attrM = s.match(/^(?:PRIVATE|PUBLIC)\s+(\w+)\s*:\s*(\w+)/i);
      if (procM) {
        let pd = 0, pEnd = -1;
        for (let k = j; k < endIdx; k++) { if (/^(?:PRIVATE|PUBLIC)\s+PROCEDURE\s+/i.test(lines[k].src)) pd++; if (/^ENDPROCEDURE/i.test(lines[k].src)) { pd--; if (pd === 0) { pEnd = k; break; } } }
        procedures[procM[1].toUpperCase()] = { params: this.parseParams(procM[2]), body: lines.slice(j + 1, pEnd) };
        j = pEnd + 1; continue;
      }
      if (funcM) {
        let pd = 0, pEnd = -1;
        for (let k = j; k < endIdx; k++) { if (/^(?:PRIVATE|PUBLIC)\s+FUNCTION\s+/i.test(lines[k].src)) pd++; if (/^ENDFUNCTION/i.test(lines[k].src)) { pd--; if (pd === 0) { pEnd = k; break; } } }
        functions[funcM[1].toUpperCase()] = { params: this.parseParams(funcM[2]), body: lines.slice(j + 1, pEnd) };
        j = pEnd + 1; continue;
      }
      if (attrM) { attrs.push(attrM[1].toUpperCase()); j++; continue; }
      j++;
    }
    this.classes[name] = { parent, attrs, procedures, functions };
    return endIdx + 1;
  }
  findMethod(className, methodName, kind) {
    let cur = className;
    while (cur) { const cls = this.classes[cur]; if (!cls) return null; if (cls[kind][methodName]) return cls[kind][methodName]; cur = cls.parent; }
    return null;
  }
  getAllAttributeNames(className) {
    const names = []; let cur = className;
    while (cur) { const cls = this.classes[cur]; if (!cls) break; cls.attrs.forEach(a => { if (names.indexOf(a) === -1) names.push(a); }); cur = cls.parent; }
    return names;
  }
  prefixAttrs(src, attrNames, objVar) {
    if (!attrNames.length) return src;
    let out = '', i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "'") { const q = ch; let j = i + 1; while (j < src.length && src[j] !== q) j++; out += src.slice(i, j + 1); i = j + 1; continue; }
      const m = src.slice(i).match(/^[A-Za-z_]\w*/);
      if (m) { const w = m[0]; out += (attrNames.indexOf(w.toUpperCase()) !== -1 ? objVar + '.' + w : w); i += w.length; continue; }
      out += ch; i++;
    }
    return out;
  }
  invokeMethod(objVar, methodName, argStrs, opts) {
    opts = opts || {};
    let cur = opts.fromClass || this.types[objVar];
    let found = null, owner = null;
    while (cur) {
      const cls = this.classes[cur];
      if (!cls) break;
      if (cls.procedures[methodName]) { found = cls.procedures[methodName]; owner = cur; break; }
      if (cls.functions[methodName]) { found = cls.functions[methodName]; owner = cur; break; }
      cur = cls.parent;
    }
    if (!found) this.err('Method ' + methodName + ' not found');
    const leafClass = this.types[objVar];
    const attrNames = this.getAllAttributeNames(leafClass);
    const saved = {};
    found.params.forEach((p, idx) => {
      saved[p.name] = (p.name in this.env) ? this.env[p.name] : undefined;
      this.env[p.name] = argStrs[idx] !== undefined ? this.eval(argStrs[idx]) : undefined;
    });
    const prevActiveClass = this._activeClass, prevActiveObj = this._activeObj;
    this._activeClass = owner; this._activeObj = objVar;
    const prefixedBody = found.body.map(line => ({ raw: line.raw, ln: line.ln, src: this.prefixAttrs(line.src, attrNames, objVar) }));
    let ret = null, thrown = null;
    try { this.execBlock(prefixedBody, 0, prefixedBody.length); }
    catch (e) { if (e.type === 'return') ret = e.value; else thrown = e; }
    this._activeClass = prevActiveClass; this._activeObj = prevActiveObj;
    found.params.forEach(p => { if (saved[p.name] === undefined) delete this.env[p.name]; else this.env[p.name] = saved[p.name]; });
    if (thrown) throw thrown;
    return ret;
  }
  parseParams(paramStr) {
    if (!paramStr || !paramStr.trim()) return [];
    let mode = 'BYVAL';
    return this.splitTop(paramStr, ',').map(raw => {
      let p = raw.trim();
      const modeM = p.match(/^(BYREF|BYVAL)\s+(.+)$/i);
      if (modeM) { mode = modeM[1].toUpperCase(); p = modeM[2].trim(); }
      const name = p.split(/\s*:\s*/)[0].trim().toUpperCase();
      return { name, mode };
    });
  }
  callProc(callStr) {
    const m = callStr.match(/^(\w+)\s*(?:\(([^)]*)\))?/);
    if (!m) return;
    const name = m[1].toUpperCase(), argStrs = m[2] ? this.splitTop(m[2], ',').map(s => s.trim()) : [];
    const proc = this.procedures[name];
    if (!proc) { this.output.push('[CALL ' + m[1] + ' — not defined]'); return; }
    const outerKeys = new Set(Object.keys(this.env));
    const child = this.makeChild();
    proc.params.forEach((p, idx) => { if (argStrs[idx] !== undefined) child.env[p.name] = this.eval(argStrs[idx]); });
    try { child.execBlock(proc.body, 0, proc.body.length); } catch (e) { if (e.type !== 'return') throw e; }
    this.output.push(...child.output);
    this.inputValues = child.inputValues;
    for (const k of outerKeys) if (k in child.env) this.env[k] = child.env[k];
    proc.params.forEach((p, idx) => { if (p.mode !== 'BYREF') return; const argName = argStrs[idx]; if (argName && /^[A-Za-z_]\w*$/.test(argName)) this.env[argName.toUpperCase()] = child.env[p.name]; });
  }
  callFunc(name, argStrs) {
    const key = name.toUpperCase();
    const fn = this.functions[key];
    if (!fn) this.err('Function ' + name + ' not defined');
    const child = this.makeChild();
    fn.params.forEach((p, idx) => { if (argStrs[idx] !== undefined) child.env[p.name] = this.eval(argStrs[idx]); });
    let ret = null;
    try { child.execBlock(fn.body, 0, fn.body.length); } catch (e) { if (e.type === 'return') ret = e.value; else throw e; }
    this.output.push(...child.output);
    this.inputValues = child.inputValues;
    return ret;
  }
  makeChild() { const c = new PseudoInterpreter({}, { silent: this.silent }); c.env = Object.assign({}, this.env); c.types = Object.assign({}, this.types); c.procedures = this.procedures; c.functions = this.functions; c.inputValues = this.inputValues; c.files = this.files; c.classes = this.classes; c.recordTypes = this.recordTypes; c.arrayElemType = this.arrayElemType; return c; }
  eval(raw) {
    const s = raw.trim();
    if (!s) return '';
    const amp = this.splitTop(s, '&');
    if (amp.length > 1) return amp.map(p => String(this.eval(p.trim()))).join('');
    if (s.toUpperCase() === 'TRUE') return true;
    if (s.toUpperCase() === 'FALSE') return false;
    if (/^"[^"]*"$/.test(s)) return s.slice(1, -1);
    if (/^'[^']*'$/.test(s)) return s.slice(1, -1);
    if (/^NOT\s+/i.test(s)) return !this.eval(s.replace(/^NOT\s+/i, ''));
    if (s[0] === '(' && this.matchParen(s) === s.length - 1) return this.eval(s.slice(1, -1));
    const or = this.splitTop(s, 'OR');
    if (or.length > 1) return or.reduce((a, p) => a || this.eval(p.trim()), false);
    const and = this.splitTop(s, 'AND');
    if (and.length > 1) return and.reduce((a, p) => a && this.eval(p.trim()), true);
    for (const op of ['<=', '>=', '<>', '!=', '=', '<', '>']) {
      const idx = this.findTop(s, op);
      if (idx >= 0) {
        const L = this.eval(s.slice(0, idx).trim()), R = this.eval(s.slice(idx + op.length).trim());
        if (op === '<=') return L <= R; if (op === '>=') return L >= R;
        if (op === '<>' || op === '!=') return L != R; if (op === '=') return L == R;
        if (op === '<') return L < R; if (op === '>') return L > R;
      }
    }
    const as = this.findAddSub(s);
    if (as >= 0) {
      const op = s[as], L = this.eval(s.slice(0, as).trim()), R = this.eval(s.slice(as + 1).trim());
      return op === '+' ? (typeof L === 'string' || typeof R === 'string' ? String(L) + String(R) : Number(L) + Number(R)) : Number(L) - Number(R);
    }
    const md = this.findMul(s);
    if (md) {
      const L = Number(this.eval(s.slice(0, md.idx).trim())), R = Number(this.eval(s.slice(md.idx + md.op.length).trim()));
      if (md.op === '*') return L * R; if (md.op === '/') return L / R;
      if (md.op === 'MOD') return L % R; if (md.op === 'DIV') return Math.trunc(L / R);
    }
    if (s[0] === '-') return -Number(this.eval(s.slice(1)));
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    const methCallM = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(([^)]*)\)$/);
    if (methCallM) {
      const objName = methCallM[1].toUpperCase();
      const cls = this.types[objName];
      if (cls && this.classes[cls]) {
        const argStr = methCallM[3];
        const argStrs = argStr.trim() ? this.splitTop(argStr, ',').map(a => a.trim()) : [];
        return this.invokeMethod(objName, methCallM[2].toUpperCase(), argStrs, { fromClass: cls });
      }
    }
    const arrDotM = s.match(/^(\w+)\[(.+)\]\.(\w+)$/);
    if (arrDotM) { const key = (arrDotM[1] + '[' + this.idxKey(arrDotM[2]) + '].' + arrDotM[3]).toUpperCase(); return key in this.env ? this.env[key] : 0; }
    const arrm = s.match(/^(\w+)\[(.+)\]$/);
    if (arrm) { const arrKey = arrm[1].toUpperCase(); const arr = this.env[arrKey]; return (arr && typeof arr === 'object') ? (arr[this.idxKey(arrm[2])] ?? 0) : 0; }
    const dotm = s.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
    if (dotm) { const key = s.toUpperCase(); return key in this.env ? this.env[key] : 0; }
    if (/^[A-Za-z_]\w*$/.test(s)) { const key = s.toUpperCase(); return key in this.env ? this.env[key] : 0; }
    return s;
  }
  matchParen(s) { let d = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '(') d++; if (s[i] === ')') d--; if (d === 0) return i; } return -1; }
  splitTop(s, op) {
    const isKw = /^[A-Z]+$/.test(op);
    const parts = []; let depth = 0, inStr = false, strCh = '', buf = '', i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (inStr) { buf += ch; if (ch === strCh) inStr = false; i++; continue; }
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; buf += ch; i++; continue; }
      if (ch === '(' || ch === '[') { depth++; buf += ch; i++; continue; }
      if (ch === ')' || ch === ']') { depth--; buf += ch; i++; continue; }
      if (depth === 0) {
        if (!isKw && s.startsWith(op, i)) { parts.push(buf); buf = ''; i += op.length; continue; }
        if (isKw) { const rest = s.slice(i); const m = rest.match(new RegExp('^' + op + '\\b', 'i')); if (m) { parts.push(buf); buf = ''; i += m[0].length; continue; } }
      }
      buf += ch; i++;
    }
    parts.push(buf); return parts;
  }
  findTop(s, op) {
    let depth = 0, inStr = false, strCh = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (ch === strCh) inStr = false; continue; }
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && s.startsWith(op, i)) return i;
    }
    return -1;
  }
  findAddSub(s) {
    let depth = 0, inStr = false;
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (ch === ')' || ch === ']') depth++; if (ch === '(' || ch === '[') depth--;
      if (ch === '"' || ch === "'") inStr = !inStr;
      if (!inStr && depth === 0 && (ch === '+' || ch === '-')) {
        let j = i - 1; while (j >= 0 && /\s/.test(s[j])) j--;
        if (j >= 0 && /[\w\)\]"']/.test(s[j])) return i;
      }
    }
    return -1;
  }
  findMul(s) {
    let depth = 0, inStr = false;
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (ch === ')' || ch === ']') depth++; if (ch === '(' || ch === '[') depth--;
      if (ch === '"' || ch === "'") inStr = !inStr;
      if (!inStr && depth === 0) {
        if (ch === '*' || ch === '/') return { idx: i, op: ch };
        for (const kw of ['MOD', 'DIV']) {
          const start = i - kw.length + 1;
          if (start >= 0 && s.slice(start, i + 1).toUpperCase() === kw) {
            const before = start - 1, after = i + 1;
            if (!((before < 0 || /\W/.test(s[before])) && (after >= s.length || /\W/.test(s[after])))) continue;
            let pb = before; while (pb >= 0 && /\s/.test(s[pb])) pb--;
            if (!(pb >= 0 && /[\w\)\]"']/.test(s[pb]))) continue;
            return { idx: start, op: kw };
          }
        }
      }
    }
    return null;
  }
  err(msg) { throw { type: 'pseudo_error', msg }; }
}


function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── Live syntax highlighting for the editable code boxes ──
// Same token categories/colors as the rest of the page (.kw/.type/.str/.num/.comment),
// applied to student-typed code via a transparent-text textarea over a highlighted <pre> overlay.
const PSEUDO_KEYWORDS=['DECLARE','CONSTANT','INPUT','OUTPUT','RETURN','RETURNS','CALL','IF','THEN','ELSE','ENDIF','CASE','OF','OTHERWISE','ENDCASE','FOR','TO','STEP','NEXT','WHILE','DO','ENDWHILE','REPEAT','UNTIL','PROCEDURE','ENDPROCEDURE','FUNCTION','ENDFUNCTION','BYREF','BYVAL','AND','OR','NOT','MOD','DIV','TRUE','FALSE','ARRAY','TYPE','ENDTYPE','CLASS','ENDCLASS','INHERITS','PRIVATE','PUBLIC','NEW','SUPER'];
const PSEUDO_TYPES=['INTEGER','REAL','STRING','BOOLEAN','CHAR','DATE'];
function highlightLine(line){
  let out='',i=0;
  while(i<line.length){
    const rest=line.slice(i);
    if(rest.slice(0,2)==='//'){ out+='<span class="comment">'+escapeHtml(rest)+'</span>'; break; }
    let m=rest.match(/^"[^"]*"/);
    if(m){ out+='<span class="str">'+escapeHtml(m[0])+'</span>'; i+=m[0].length; continue; }
    if(rest[0]==='←'){ out+='<span class="kw">←</span>'; i+=1; continue; }
    if(rest.slice(0,2)==='<-'){ out+='<span class="kw">&lt;-</span>'; i+=2; continue; }
    m=rest.match(/^-?\d+(\.\d+)?/);
    if(m){ out+='<span class="num">'+escapeHtml(m[0])+'</span>'; i+=m[0].length; continue; }
    m=rest.match(/^[A-Za-z_]\w*/);
    if(m){
      const w=m[0],up=w.toUpperCase();
      if(PSEUDO_KEYWORDS.indexOf(up)!==-1) out+='<span class="kw">'+escapeHtml(w)+'</span>';
      else if(PSEUDO_TYPES.indexOf(up)!==-1) out+='<span class="type">'+escapeHtml(w)+'</span>';
      else out+=escapeHtml(w);
      i+=w.length; continue;
    }
    out+=escapeHtml(rest[0]); i+=1;
  }
  return out;
}
function highlightCode(code){ return code.split('\n').map(highlightLine).join('\n'); }

// ── Autocomplete: suggests pseudocode keywords/types plus any variables the
// student has already DECLAREd in this box, positioned at the caret via a hidden
// mirror element (standard textarea-caret-position technique). ──
const ac={open:false,editorId:null,items:[],active:0,wrapEl:null};
function getCaretCoordinates(textarea,position){
  const mirror=document.createElement('div');
  const style=getComputedStyle(textarea);
  ['boxSizing','width','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing'].forEach(function(p){ mirror.style[p]=style[p]; });
  mirror.style.position='absolute';
  mirror.style.visibility='hidden';
  mirror.style.whiteSpace='pre';
  mirror.style.top='0';
  mirror.style.left='-9999px';
  document.body.appendChild(mirror);
  mirror.textContent=textarea.value.substring(0,position);
  const span=document.createElement('span');
  span.textContent=textarea.value.substring(position)||'.';
  mirror.appendChild(span);
  const coords={top:span.offsetTop,left:span.offsetLeft,height:span.offsetHeight||parseInt(style.lineHeight)||18};
  document.body.removeChild(mirror);
  return coords;
}
function getWordRangeAtCaret(editor){
  const pos=editor.selectionStart,val=editor.value;
  let start=pos;
  while(start>0 && /[A-Za-z0-9_]/.test(val[start-1])) start--;
  return {start:start,end:pos,word:val.slice(start,pos)};
}
function getDeclaredNames(code){
  const names=[],seen={};
  const re=/DECLARE\s+([A-Za-z_]\w*)/gi;
  let m;
  while((m=re.exec(code))){ if(!seen[m[1]]){ seen[m[1]]=true; names.push(m[1]); } }
  return names;
}
function updateAutocomplete(id){
  const editor=document.getElementById('editor-'+id);
  const range=getWordRangeAtCaret(editor);
  if(range.word.length<1){ hideAutocomplete(); return; }
  const upper=range.word.toUpperCase();
  const kwMatches=PSEUDO_KEYWORDS.concat(PSEUDO_TYPES).filter(function(k){ return k.indexOf(upper)===0; }).map(function(k){ return {text:k,tag:PSEUDO_TYPES.indexOf(k)!==-1?'type':'keyword'}; });
  const varMatches=getDeclaredNames(editor.value).filter(function(v){ return v.toUpperCase().indexOf(upper)===0 && v.toUpperCase()!==upper; }).map(function(v){ return {text:v,tag:'variable'}; });
  const items=kwMatches.concat(varMatches).slice(0,8);
  if(items.length===0 || (items.length===1 && items[0].text.toUpperCase()===upper)){ hideAutocomplete(); return; }
  ac.open=true; ac.editorId=id; ac.items=items; ac.active=0;
  renderAutocomplete(editor,range);
}
function renderAutocomplete(editor,range){
  let dropdown=document.getElementById('ac-dropdown');
  if(!dropdown){ dropdown=document.createElement('div'); dropdown.id='ac-dropdown'; dropdown.className='autocomplete-dropdown'; document.body.appendChild(dropdown); }
  dropdown.innerHTML=ac.items.map(function(it,i){ return '<div class="autocomplete-item'+(i===ac.active?' active':'')+'" data-idx="'+i+'">'+escapeHtml(it.text)+'<span class="ac-tag">'+it.tag+'</span></div>'; }).join('');
  const coords=getCaretCoordinates(editor,range.start);
  const wrapRect=editor.getBoundingClientRect();
  const top=wrapRect.top+window.scrollY+(coords.top-editor.scrollTop)+coords.height;
  const left=wrapRect.left+window.scrollX+(coords.left-editor.scrollLeft);
  dropdown.style.top=top+'px';
  dropdown.style.left=left+'px';
  dropdown.style.display='block';
}
function hideAutocomplete(){
  ac.open=false; ac.editorId=null; ac.items=[];
  const dropdown=document.getElementById('ac-dropdown');
  if(dropdown) dropdown.style.display='none';
}
function applyAutocomplete(idx){
  if(!ac.open || !ac.editorId) return;
  const editor=document.getElementById('editor-'+ac.editorId);
  const range=getWordRangeAtCaret(editor);
  const chosen=ac.items[idx!==undefined?idx:ac.active];
  if(!chosen) return;
  const before=editor.value.slice(0,range.start), after=editor.value.slice(range.end);
  editor.value=before+chosen.text+after;
  const newPos=before.length+chosen.text.length;
  editor.selectionStart=editor.selectionEnd=newPos;
  editor.dispatchEvent(new Event('input'));
  hideAutocomplete();
  editor.focus();
}
document.addEventListener('scroll',function(){ if(ac.open) hideAutocomplete(); },true);
document.addEventListener('click',function(e){ if(ac.open && !e.target.closest('#ac-dropdown') && !e.target.classList.contains('code-editor')) hideAutocomplete(); });

function renderLoopPractice(){
  const groupEl={forloop:document.getElementById('forloop-practice'),whileloop:document.getElementById('whileloop-practice'),repeatuntil:document.getElementById('repeatuntil-practice'),record:document.getElementById('record-practice'),class:document.getElementById('class-practice')};
  const counters={forloop:0,whileloop:0,repeatuntil:0,record:0,class:0};
  LOOP_PROBLEMS.forEach(function(p){
    counters[p.topic]++;
    const card=document.createElement('div');
    card.className='practice-card';
    card.innerHTML=
      '<div class="card-toolbar"><div class="ptitle">'+counters[p.topic]+'. '+escapeHtml(p.title)+' <span class="ptier">'+p.tier+'</span></div>'+
      '<button class="copy-btn" data-copy="'+p.id+'" type="button">📋 Copy for IDE</button></div>'+
      '<div class="task">📋 <strong>Question:</strong> '+escapeHtml(p.scenario)+'</div>'+
      '<p class="pconcept"><strong>Skill:</strong> '+escapeHtml(p.concept)+'</p>'+
      '<p class="phint">💡 <strong>Hint:</strong> '+escapeHtml(p.hint)+'</p>'+
      '<div class="editor-wrap"><pre class="code-highlight" id="highlight-'+p.id+'" aria-hidden="true"><code></code></pre><textarea class="code-editor" id="editor-'+p.id+'" spellcheck="false" wrap="off"></textarea></div>'+
      '<div><button class="run-btn" data-id="'+p.id+'" type="button">▶ Run &amp; Check</button></div>'+
      '<div class="test-result" id="result-'+p.id+'"></div>'+
      '<details class="scenario-answer"><summary>Show Sample Solution</summary><pre><code>'+highlightCode(p.solution)+'</code></pre></details>';
    groupEl[p.topic].appendChild(card);
    const editor=document.getElementById('editor-'+p.id);
    const highlightPre=document.getElementById('highlight-'+p.id);
    const highlightCodeEl=highlightPre.querySelector('code');
    editor.value=p.starter;
    function sync(){ highlightCodeEl.innerHTML=highlightCode(editor.value)+'\n'; }
    sync();
    editor.addEventListener('input',function(){ sync(); updateAutocomplete(p.id); });
    editor.addEventListener('scroll',function(){ highlightPre.scrollTop=editor.scrollTop; highlightPre.scrollLeft=editor.scrollLeft; if(ac.open && ac.editorId===p.id) hideAutocomplete(); });
    editor.addEventListener('blur',function(){ setTimeout(hideAutocomplete,150); });
    editor.addEventListener('keydown',function(e){
      if(e.key==='-' && editor.selectionStart===editor.selectionEnd && editor.value[editor.selectionStart-1]==='<'){
        e.preventDefault();
        const pos=editor.selectionStart;
        editor.value=editor.value.slice(0,pos-1)+'←'+editor.value.slice(pos);
        editor.selectionStart=editor.selectionEnd=pos;
        editor.dispatchEvent(new Event('input'));
        return;
      }
      if(ac.open && ac.editorId===p.id){
        if(e.key==='ArrowDown'){ e.preventDefault(); ac.active=(ac.active+1)%ac.items.length; renderAutocomplete(editor,getWordRangeAtCaret(editor)); return; }
        if(e.key==='ArrowUp'){ e.preventDefault(); ac.active=(ac.active-1+ac.items.length)%ac.items.length; renderAutocomplete(editor,getWordRangeAtCaret(editor)); return; }
        if(e.key==='Tab' || e.key==='Enter'){ e.preventDefault(); applyAutocomplete(); return; }
        if(e.key==='Escape'){ hideAutocomplete(); return; }
      }
      if(e.key==='Tab' && !ac.open){ e.preventDefault(); const s=editor.selectionStart,en=editor.selectionEnd; editor.value=editor.value.slice(0,s)+'  '+editor.value.slice(en); editor.selectionStart=editor.selectionEnd=s+2; editor.dispatchEvent(new Event('input')); }
    });
  });
}
document.addEventListener('click',function(e){
  const item=e.target.closest('.autocomplete-item');
  if(item){ applyAutocomplete(parseInt(item.getAttribute('data-idx'),10)); }
});
function runLoopCheck(id){
  const problem=LOOP_PROBLEMS.find(function(p){return p.id===id;});
  const code=document.getElementById('editor-'+id).value;
  const resultDiv=document.getElementById('result-'+id);
  let html='',allPass=true;
  problem.tests.forEach(function(test,i){
    const interp=new PseudoInterpreter({},{silent:true});
    interp.inputValues=test.inputs.slice();
    const out=interp.run(code).output.split('\n');
    const pass=JSON.stringify(out)===JSON.stringify(test.expectLines);
    if(!pass)allPass=false;
    const inputsLabel=test.inputs.length?' — inputs: '+test.inputs.map(escapeHtml).join(', '):'';
    html+='<div class="output-block">';
    html+='<div class="output-label">▶ Output — Test '+(i+1)+inputsLabel+'</div>';
    html+='<pre class="output-box">'+(out.join('\n').trim()?escapeHtml(out.join('\n')):'(no output)')+'</pre>';
    if(!pass){
      html+='<div class="output-label">Expected output — Test '+(i+1)+'</div>';
      html+='<pre class="output-box expected">'+escapeHtml(test.expectLines.join('\n'))+'</pre>';
    }
    html+='<div class="test-line '+(pass?'pass':'fail')+'">Test '+(i+1)+': '+(pass?'✅ Correct':'❌ Incorrect — output does not match')+'</div>';
    html+='</div>';
  });
  html+='<div class="overall-msg '+(allPass?'pass':'fail')+'">'+(allPass?'🎉 All tests passed!':'Not quite — compare your Output above to the Expected output and try again.')+'</div>';
  resultDiv.innerHTML=html;
}
function copyLoopCode(id,btn){
  const code=document.getElementById('editor-'+id).value;
  const showCopied=function(){
    const original=btn.textContent;
    btn.textContent='✅ Copied!'; btn.classList.add('copied');
    setTimeout(function(){ btn.textContent=original; btn.classList.remove('copied'); },1500);
  };
  const fallbackCopy=function(){
    const ta=document.createElement('textarea');
    ta.value=code; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try{ document.execCommand('copy'); }catch(err){}
    document.body.removeChild(ta);
    showCopied();
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(showCopied, fallbackCopy);
  } else { fallbackCopy(); }
}
document.addEventListener('click',function(e){
  if(e.target.matches('.run-btn')) runLoopCheck(e.target.getAttribute('data-id'));
  if(e.target.matches('.copy-btn')) copyLoopCode(e.target.getAttribute('data-copy'),e.target);
});
