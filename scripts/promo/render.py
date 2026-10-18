"""Renders edit.py's cut in parallel parts and joins them without re-encoding.

    python scripts/promo/render.py TAKES_DIR OUT.mp4 [--jobs 6] [--still-backdrop]
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
takes, out = sys.argv[1], os.path.abspath(sys.argv[2])
jobs = int(sys.argv[sys.argv.index('--jobs') + 1]) if '--jobs' in sys.argv else 6
# Other flags (--still-backdrop) go through to edit.py.
extra = [a for i, a in enumerate(sys.argv[3:], 3) if a != '--jobs' and sys.argv[i - 1] != '--jobs']
parts = [f'{out[:-4]}.part{i}.mp4' for i in range(jobs)]
procs = [subprocess.Popen([sys.executable, os.path.join(HERE, 'edit.py'), takes, part, '--part', f'{i}/{jobs}', *extra],
                          stdout=subprocess.DEVNULL) for i, part in enumerate(parts)]
codes = [p.wait() for p in procs]
if any(codes):
    sys.exit(f'a part failed: {codes}')
listing = f'{out[:-4]}.parts.txt'
with open(listing, 'w') as f:
    f.writelines(f"file '{p}'\n" for p in parts)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listing,
                '-c', 'copy', '-movflags', '+faststart', out], check=True)
for p in parts + [listing]:
    os.remove(p)
print(f'wrote {out}')
