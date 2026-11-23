"""Build src/data/wordbank.json and src/data/dict.json.

Usage: python3 tools/build_dict.py /path/to/ecdict.csv
  ecdict.csv comes from https://github.com/skywind3000/ECDICT (MIT licence).

- primary.txt / junior.txt : hand-checked "word=meaning" lists (the meanings pupils are taught)
- phonetics, the senior list and the OCR lookup dictionary come from ECDICT
"""
import csv, json, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1]
outdir = os.path.join(here, '..', 'src', 'data')

rows = {}
for r in csv.DictReader(open(src, encoding='utf-8')):
    w = r['word']
    if re.fullmatch(r"[A-Za-z][A-Za-z\-' ]*", w):
        rows[w] = r


def phon(p):
    p = (p or '').strip()
    return p.replace("'", 'ˈ').replace(',', 'ˌ').replace('ә', 'ə').replace('ɡ', 'g')


def clean(tr):
    out = []
    for line in tr.replace('\\r', '').replace('\r', '').replace('\\n', '\n').split('\n'):
        line = line.strip()
        if not line or line.startswith('['):
            continue
        line = re.sub(r'\([^)]*\)|（[^）]*）|\[[^\]]*\]', '', line)
        m = re.match(r'^([a-z]+\.)\s*(.*)$', line)
        pos, body = (m.group(1) + ' ', m.group(2)) if m else ('', line)
        items = [x.strip() for x in re.split(r'[；;,，]', body) if x.strip()]
        items = [x for x in items if len(x) <= 10][:2]
        if items:
            out.append(pos + '，'.join(items))
        if len(out) >= 2:
            break
    return '；'.join(out)


def row_of(w):
    return rows.get(w) or rows.get(w.lower()) or rows.get(w.capitalize())


def curated(fname):
    res, seen = [], set()
    for line in open(os.path.join(here, fname), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        w, m = line.split('=', 1)
        w, m = w.strip(), m.strip()
        if w.lower() in seen:
            print('duplicate', w)
            continue
        seen.add(w.lower())
        r = row_of(w)
        res.append({'w': w, 'p': phon(r['phonetic']) if r else '', 'm': m})
        if not r:
            print('no phonetic for', w)
    return res


def frq(r):
    f = int(r['frq'] or 0)
    return f if f > 0 else 999999


prim = curated('primary.txt')
jun = curated('junior.txt')
have = {e['w'].lower() for e in prim} | {e['w'].lower() for e in jun}
sen = []
for r in sorted((r for r in rows.values() if 'gk' in r['tag'].split()), key=frq):
    w = r['word']
    if w.lower() in have or ' ' in w or len(w) < 3:
        continue
    m = clean(r['translation'])
    if m:
        sen.append({'w': w, 'p': phon(r['phonetic']), 'm': m})
        have.add(w.lower())

books = [
    {'id': 'primary', 'name': '小学核心词汇', 'level': '小学', 'icon': '🌱', 'desc': '按主题编排，释义经人工校对', 'words': prim},
    {'id': 'junior', 'name': '初中中考词汇', 'level': '初中', 'icon': '🚀', 'desc': '由常用到少用，释义经人工校对', 'words': jun},
    {'id': 'senior', 'name': '高中拓展词汇', 'level': '拓展', 'icon': '🏔️', 'desc': '学有余力再挑战，释义来自 ECDICT 词典', 'words': sen},
]
for b in books:
    print(b['name'], len(b['words']))
json.dump({'books': books}, open(os.path.join(outdir, 'wordbank.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))


# ---- lookup dictionary used to validate OCR results: word -> [phonetic, meaning, rank]
def rank(r):
    v = [x for x in (int(r['frq'] or 0), int(r['bnc'] or 0)) if x > 0]
    return min(v) if v else 0


look, lemma = {}, {}
for r in rows.values():
    w = r['word']
    if ' ' in w:
        continue
    good = r['tag'] or (r['collins'] and r['collins'] != '0') or r['oxford'] == '1' \
        or 0 < int(r['frq'] or 0) <= 25000 or 0 < int(r['bnc'] or 0) <= 25000
    if not good:
        continue
    m = clean(r['translation'])
    if m:
        look[w] = [phon(r['phonetic']), m, rank(r)]
for b in books[:2]:  # hand-checked meanings win
    for e in b['words']:
        if ' ' in e['w']:
            continue
        old = look.get(e['w'])
        look[e['w']] = [e['p'], e['m'], old[2] if old else 0]
lows = {k.lower() for k in look}
for r in rows.values():
    w = r['word']
    if w not in look:
        continue
    for part in (r['exchange'] or '').split('/'):
        if ':' not in part:
            continue
        k, v = part.split(':', 1)
        if k in 'pdi3rst' and v and ' ' not in v and v.lower() not in lows:
            lemma[v.lower()] = w
print('lookup', len(look), 'lemma', len(lemma))
json.dump({'d': look, 'l': lemma}, open(os.path.join(outdir, 'dict.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
