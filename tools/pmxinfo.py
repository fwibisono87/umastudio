#!/usr/bin/env python3
"""Dump the structure of a PMX 2.0 model: bones, weights, morphs, materials, textures, physics.

Usage: pmxinfo.py model.pmx [model2.pmx ...]
"""
import struct, sys, collections

class R:
    def __init__(s, b): s.b, s.o = b, 0
    def take(s, n):
        v = s.b[s.o:s.o+n]; s.o += n; return v
    def u(s, fmt):
        v = struct.unpack_from('<' + fmt, s.b, s.o); s.o += struct.calcsize('<' + fmt); return v
    def i(s): return s.u('i')[0]
    def byte(s): return s.u('B')[0]
    def f(s): return s.u('f')[0]
    def idx(s, n, unsigned=False):
        fmt = {1: 'b', 2: 'h', 4: 'i'}[n]
        if unsigned and n < 4: fmt = fmt.upper()
        return s.u(fmt)[0]

def parse(path):
    r = R(open(path, 'rb').read())
    assert r.take(4) == b'PMX ', 'not PMX'
    ver = r.f()
    g = list(r.take(r.byte()))
    enc = 'utf-16-le' if g[0] == 0 else 'utf-8'
    addl, vi, ti, mi, bi, mo, ri = g[1:8]
    txt = lambda: r.take(r.i()).decode(enc, 'replace')
    out = {'version': ver, 'name_jp': txt(), 'name_en': txt(), 'comment_jp': txt(), 'comment_en': txt()}

    nv = r.i(); wt = collections.Counter()
    for _ in range(nv):
        r.take(32 + 16 * addl)
        t = r.byte(); wt[t] += 1
        if t == 0: r.idx(bi)
        elif t == 1: r.idx(bi); r.idx(bi); r.f()
        elif t in (2, 4): [r.idx(bi) for _ in range(4)]; r.take(16)
        elif t == 3: r.idx(bi); r.idx(bi); r.take(40)
        r.f()
    out['vertices'] = nv
    out['weights'] = {['BDEF1', 'BDEF2', 'BDEF4', 'SDEF', 'QDEF'][k]: v for k, v in wt.items()}
    nf = r.i(); r.take(nf * vi); out['triangles'] = nf // 3
    out['textures'] = [txt() for _ in range(r.i())]

    mats = []
    for _ in range(r.i()):
        n = txt(); txt(); r.take(16 + 12 + 4 + 12 + 1 + 16 + 4)
        r.idx(ti); r.idx(ti); r.byte()
        if r.byte() == 0: r.idx(ti)
        else: r.byte()
        txt(); r.i(); mats.append(n)
    out['materials'] = mats

    bones = []; ik = 0
    for _ in range(r.i()):
        n = txt(); txt(); r.take(12); r.idx(bi); r.i()
        fl = r.u('H')[0]
        if fl & 1: r.idx(bi)
        else: r.take(12)
        if fl & 0x300: r.idx(bi); r.f()
        if fl & 0x400: r.take(12)
        if fl & 0x800: r.take(24)
        if fl & 0x2000: r.i()
        if fl & 0x20:
            ik += 1; r.idx(bi); r.i(); r.f()
            for _ in range(r.i()):
                r.idx(bi)
                if r.byte(): r.take(24)
        bones.append(n)
    out['bones'] = bones; out['ik_bones'] = ik

    morphs = collections.defaultdict(list)
    names = ['group', 'vertex', 'bone', 'uv', 'uv1', 'uv2', 'uv3', 'uv4', 'material', 'flip', 'impulse']
    sizes = {0: mo + 4, 1: vi + 12, 2: bi + 28, 3: vi + 16, 4: vi + 16, 5: vi + 16, 6: vi + 16, 7: vi + 16,
             8: mi + 113, 9: mo + 4, 10: ri + 25}
    for _ in range(r.i()):
        n = txt(); txt(); r.byte(); t = r.byte()
        r.take(r.i() * sizes[t]); morphs[names[t]].append(n)
    out['morphs'] = dict(morphs)

    for _ in range(r.i()):
        txt(); txt(); r.byte()
        for _ in range(r.i()):
            t = r.byte(); r.idx(bi if t == 0 else mo)
    out['rigid_bodies'] = r.i()
    for _ in range(out['rigid_bodies']):
        txt(); txt(); r.idx(bi); r.take(1 + 2 + 1 + 36 + 20 + 1)
    out['joints'] = r.i()
    return out

for p in sys.argv[1:]:
    d = parse(p)
    print('=' * 70); print(p)
    for k in ('version', 'name_jp', 'name_en', 'vertices', 'triangles', 'weights', 'ik_bones', 'rigid_bodies', 'joints'):
        print(f'{k}: {d[k]}')
    print('comment_jp:', d['comment_jp'][:400].replace('\r\n', ' | '))
    print('comment_en:', d['comment_en'][:400].replace('\r\n', ' | '))
    print(f"bones ({len(d['bones'])}):", ', '.join(d['bones'][:80]), '...' if len(d['bones']) > 80 else '')
    print(f"materials ({len(d['materials'])}):", ', '.join(d['materials']))
    print(f"textures ({len(d['textures'])}):", ', '.join(d['textures']))
    for t, ns in d['morphs'].items():
        print(f'morphs[{t}] ({len(ns)}):', ', '.join(ns[:40]), '...' if len(ns) > 40 else '')
