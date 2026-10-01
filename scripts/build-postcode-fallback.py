#!/usr/bin/env python3
"""Build the emergency dataset from AllPostcodes.zip (Python standard library only)."""
import collections, csv, gzip, hashlib, io, json, pathlib, re, struct, sys, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'lib/postcodes'
rows = json.loads((root / 'api/data/emails.json').read_text())
by_name = {r['constituency'].casefold(): r['constituency'] for r in rows}
if len(by_name) != len(rows): raise ValueError('Duplicate curated constituency')
# Reviewed aliases for ZIP filename encoding damage; no runtime fuzzy matching.
aliases = {'Montgomeryshire and Glyndw╠ér': 'Montgomeryshire and Glyndŵr', 'Ynys Mo╠én': 'Ynys Môn'}
archive = pathlib.Path(sys.argv[1])
lookup = {}; stats = collections.Counter(); seen = set(); excluded = collections.Counter()
with zipfile.ZipFile(archive) as z:
    files = sorted(f for f in z.namelist() if f.endswith('.csv') and not f.startswith('__MACOSX/'))
    for f in files:
        raw = re.sub(r' postcodes 2024(?:-2)?\.csv$', '', pathlib.PurePosixPath(f).name)
        name = aliases.get(raw, raw)
        name = by_name.get(name.casefold())
        if not name: raise ValueError('Unmatched constituency filename: ' + f)
        if name in seen: raise ValueError('Duplicate constituency file')
        seen.add(name)
        for r in csv.DictReader(io.StringIO(z.read(f).decode('utf-8-sig'))):
            stats['rows'] += 1
            status = r.get('In Use?', 'Unknown').strip()
            stats[status] += 1
            if status != 'Yes': excluded[name] += 1; continue
            pc = ''.join(r['Postcode'].upper().split())
            if not re.fullmatch(r'(?:[A-Z]{1,2}[0-9][A-Z0-9]?)[0-9][A-Z]{2}|GIR0AA', pc):
                raise ValueError('Invalid active postcode shape')
            if pc in lookup: raise ValueError('Duplicate or conflicting active postcode')
            lookup[pc] = name
names = sorted(seen); ids = {n: i for i, n in enumerate(names)}
data = b''.join(p.encode('ascii').ljust(7, b' ') + struct.pack('<H', ids[n]) for p,n in sorted(lookup.items()))
# Exhaustively decode each generated record and compare with its input assignment.
for i, (p,n) in enumerate(sorted(lookup.items())):
    record = data[i*9:(i+1)*9]
    assert record[:7].decode('ascii').rstrip() == p and names[struct.unpack('<H',record[7:])[0]] == n
names_data = json.dumps(names, ensure_ascii=False, separators=(',', ':')).encode()
compressed = gzip.compress(data, compresslevel=9, mtime=0)
manifest = {'schemaVersion':1,'recordWidth':9,'recordCount':len(lookup),'constituencyCount':len(names),
            'policy':'In Use? = Yes only; exact full postcode lookup', 'sourceLabel':'2024 source filenames; source date unverified',
            'sourceSha256':hashlib.sha256(archive.read_bytes()).hexdigest(), 'dataSha256':hashlib.sha256(data).hexdigest(),
            'namesSha256':hashlib.sha256(names_data).hexdigest(), 'dataBytes':len(data), 'gzipBytes':len(compressed),
            'counts':dict(stats),'missingConstituencyFiles':sorted(set(by_name.values())-seen),
            'constituenciesWithoutActiveRecords':sorted(seen-set(lookup.values())), 'reviewedFilenameAliases':aliases}
out.mkdir(parents=True, exist_ok=True)
(out/'lookup.bin.gz').write_bytes(compressed); (out/'names.json').write_bytes(names_data)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
