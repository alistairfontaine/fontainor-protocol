"""Build self-contained preview HTML from dist-preview + seed registry with data-URI covers."""
import base64, json, pathlib, re

ROOT = pathlib.Path('/work/projects/fontainor-protocol')
DP = ROOT / 'dist-preview'
html = (DP / 'index.html').read_text()

css = next((DP / 'assets').glob('*.css')).read_text()
js = next((DP / 'assets').glob('*.js')).read_text()

# seed registry with covers inlined as data URIs, audio left as-is (will fall back to sim)
seed = json.loads((ROOT / 'public' / 'registry.json').read_text())
def datauri(p):
    f = ROOT / 'public' / p.lstrip('/')
    if not f.exists(): return None
    return 'data:image/jpeg;base64,' + base64.b64encode(f.read_bytes()).decode()
items = seed['assets'] if isinstance(seed, dict) and 'assets' in seed else seed
for a in items:
    cu = a.get('coverUri')
    if cu:
        d = datauri(cu)
        if d: a['coverUri'] = d
    a['audioUri'] = None  # audio too big to inline; player falls back to simulated playback

shim = "<script>(function(){var SEED=" + json.dumps(seed) + ";var of=window.fetch;window.fetch=function(u,o){var s=String(u);if(s.indexOf('/registry')===0||s.indexOf('registry.json')!==-1){return Promise.resolve(new Response(JSON.stringify(SEED),{status:200,headers:{'Content-Type':'application/json'}}));}return of.apply(this,arguments);};})();</script>"

html = re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
html = re.sub(r'<script type="module"[^>]*></script>', '', html)
html = html.replace('</head>', shim + '<style>' + css + '</style></head>')
html = html.replace('</body>', '<script type="module">' + js.replace('</script>', '<\\/script>') + '</script></body>')

out = pathlib.Path('/work/temp/fontainor_preview.html')
out.write_text(html)
print("bytes:", out.stat().st_size)
