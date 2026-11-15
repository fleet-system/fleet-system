"""Generates the dark (command-center) overrides for every hard-coded light color in app.css."""
import re, sys, colorsys
src = open(sys.argv[1], encoding='utf-8').read()
src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)

def parse(s, i=0, depth=0):
    """returns list of (prelude, body or children) blocks"""
    out = []; buf = ''
    while i < len(s):
        ch = s[i]
        if ch == '{':
            pre = buf.strip(); buf = ''
            if pre.startswith('@'):
                kids, i = parse(s, i + 1, depth + 1); out.append((pre, kids))
            else:
                j = s.index('}', i); out.append((pre, s[i + 1:j])); i = j
        elif ch == '}':
            return out, i
        else:
            buf += ch
        i += 1
    return out, i

COL = re.compile(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\([^)]*\)|\bwhite\b')
def to_rgba(t):
    if t == 'white': return (1, 1, 1, 1)
    if t.startswith('#'):
        h = t[1:]
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        return tuple(int(h[k:k + 2], 16) / 255 for k in (0, 2, 4)) + (1,)
    p = [x.strip() for x in t[t.index('(') + 1:-1].split(',')]
    return tuple(float(x) / 255 for x in p[:3]) + ((float(p[3]) if len(p) > 3 else 1),)
def fmt(r, g, b, a):
    R, G, B = (round(max(0, min(1, x)) * 255) for x in (r, g, b))
    return f'#{R:02x}{G:02x}{B:02x}' if a >= .999 else f'rgba({R}, {G}, {B}, {a:.2f})'.replace('0.', '.', 1)

def fg(c):  # text / icon colors on a dark surface
    r, g, b, a = c; h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l > .7: return fmt(r, g, b, a)
    if s > .3 and l > .18: l2 = .70; s2 = min(1, s * 1.05)   # status / brand colors: same hue, readable
    else: l2 = min(.94, max(.70, 1 - l * .55)); s2 = min(s, .25)
    return fmt(*colorsys.hls_to_rgb(h, l2, s2), a)
def bg(c):
    r, g, b, a = c; h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l < .55: return None   # already dark / saturated fill: keep
    if a < .999:  # translucent layers: heavy white = glass, faint white (made for dark surfaces) stays
        if s < .2: return 'var(--glass-strong)' if a > .5 else None
        return fmt(*colorsys.hls_to_rgb(h, .5, s), a * .25)
    if l > .985: return 'var(--glass)'
    if s > .25 and l < .97:  # tinted light (status pills): a deep tint of the same hue
        return fmt(*colorsys.hls_to_rgb(h, .17, min(.55, s)), .85)
    return fmt(*colorsys.hls_to_rgb(h, .09 + (1 - l) * .35, min(s, .3)), 1)
def border(c):
    r, g, b, a = c; h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l < .55: return None
    if s > .3 and l < .9: return fmt(*colorsys.hls_to_rgb(h, .45, s), a)
    return fmt(1, 1, 1, .12 * a if a < 1 else .11)

FG = {'color', 'fill', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color'}
BG = {'background', 'background-color', 'background-image'}
def conv(prop, val):
    kind = 'fg' if prop in FG else 'bg' if prop in BG else 'border' if ('border' in prop or prop in ('outline', 'outline-color', 'stroke')) else None
    if kind is None: return None
    changed = False
    def rep(m):
        nonlocal changed
        c = to_rgba(m.group(0)); f = {'fg': fg, 'bg': bg, 'border': border}[kind](c)
        if f is None: return m.group(0)
        changed = True; return f
    v2 = COL.sub(rep, val)
    return v2 if changed else None

def emit(blocks, ind=''):
    out = []
    for pre, body in blocks:
        if isinstance(body, list):
            if pre.startswith('@media print') or pre.startswith('@keyframes') or pre.startswith('@page'): continue
            inner = emit(body, ind + '  ')
            if inner: out.append(f'{ind}{pre} {{\n' + '\n'.join(inner) + f'\n{ind}}}')
            continue
        if pre.startswith(':root'): continue
        decls = []
        for d in body.split(';'):
            if ':' not in d: continue
            p, v = d.split(':', 1); p = p.strip().lower(); v = v.strip()
            if not COL.search(v): continue
            nv = conv(p, v)
            if nv: decls.append(f'{p}: {nv.replace(" !important", "")}{" !important" if "!important" in v else ""}')
        if decls:
            sel = ', '.join(f':root[data-theme=dark] {x.strip()}' if not x.strip().startswith(('html', 'body')) else f':root[data-theme=dark] {x.strip()}'.replace(':root[data-theme=dark] html', ':root[data-theme=dark]') for x in pre.split(','))
            out.append(f'{ind}{sel} {{ {"; ".join(decls)}; }}')
    return out
blocks, _ = parse(src)
print('/* مُولَّد آلياً من app.css (python3 -I tools/darkgen.py web/css/app.css > web/css/command-auto.css): كل لون فاتح ثابت ← مقابله الداكن. لا تعدّله يدوياً؛ التعديلات اليدوية في command.css */')
print('@media screen {\n' + '\n'.join(emit(blocks, '  ')) + '\n}')
